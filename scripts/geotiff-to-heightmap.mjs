// Convierte hojas del MDT del CNIG (GeoTIFF float32, en UTM ETRS89 o en grados) en los ficheros
// que consume la web: public/data/heightmap.bin (Float32 LE, metros) + meta.json. No necesita GDAL
// ni dependencias: lee el TIFF, recorta el recuadro pedido y lo remuestrea a una rejilla en grados.
//
//   node scripts/geotiff-to-heightmap.mjs etc/PNOA_MDT05_ETRS89_HU30_0105_LID.tif
//   node scripts/geotiff-to-heightmap.mjs hoja1.tif hoja2.tif --bbox -5.104586,42.896826,-4.984586,42.986826 --size 1025
//
// Opciones:
//   --bbox O,S,E,N   recuadro en grados (por defecto, el de Horcadas, ver docs/datos.md)
//   --size N         lado de la rejilla de salida (por defecto 1025)
//   --out carpeta    destino (por defecto public/data)
//
// Admite TIFF clásico y BigTIFF, little-endian, float32, sin compresión o Deflate (el formato de las hojas
// MDT05 del CNIG), con tiles o tiras, y sistemas EPSG:258xx (UTM ETRS89), 4258 y 4326.
// Si se pasan varias hojas, cada punto se toma de la primera que lo contenga.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

/* ───────────── argumentos ───────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (files.length === 0) {
  console.error('Uso: node scripts/geotiff-to-heightmap.mjs <hoja.tif> [...] [--bbox O,S,E,N] [--size 1025] [--out public/data]');
  process.exit(1);
}
const [west, south, east, north] = flag('bbox', '-5.104586,42.896826,-4.984586,42.986826').split(',').map(Number);
const size = Number(flag('size', '1025'));
const outDir = resolve(flag('out', 'public/data'));
if ([west, south, east, north, size].some((n) => Number.isNaN(n)) || !(west < east && south < north)) {
  console.error('--bbox debe ser O,S,E,N en grados (oeste < este, sur < norte) y --size un número.');
  process.exit(1);
}

/* ───────────── lector de GeoTIFF ───────────── */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

function readGeoTiff(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 2) !== 'II') throw new Error(`${path}: solo se admite TIFF little-endian`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint16(2, true);
  if (magic !== 42 && magic !== 43) throw new Error(`${path}: no es un TIFF`);
  const big = magic === 43; // BigTIFF: offsets de 8 bytes (las hojas MDT05 del CNIG lo usan)
  const u64 = (o) => Number(dv.getBigUint64(o, true));

  const tags = {};
  const ifd = big ? u64(8) : dv.getUint32(4, true);
  const entries = big ? u64(ifd) : dv.getUint16(ifd, true);
  const entrySize = big ? 20 : 12;
  const first = ifd + (big ? 8 : 2);
  for (let i = 0; i < entries; i++) {
    const e = first + i * entrySize;
    const tag = dv.getUint16(e, true);
    const type = dv.getUint16(e + 2, true);
    const count = big ? u64(e + 4) : dv.getUint32(e + 4, true);
    const bytes = (TYPE_SIZE[type] ?? 1) * count;
    const valueAt = e + (big ? 12 : 8);
    const off = bytes <= (big ? 8 : 4) ? valueAt : big ? u64(valueAt) : dv.getUint32(valueAt, true);
    const values = [];
    for (let k = 0; k < count; k++) {
      if (type === 3) values.push(dv.getUint16(off + 2 * k, true));
      else if (type === 4) values.push(dv.getUint32(off + 4 * k, true));
      else if (type === 16) values.push(u64(off + 8 * k));
      else if (type === 12) values.push(dv.getFloat64(off + 8 * k, true));
      else if (type === 11) values.push(dv.getFloat32(off + 4 * k, true));
      else if (type === 2) {
        values.push(buf.toString('latin1', off, off + count));
        break;
      } else values.push(dv.getUint8(off + k));
    }
    tags[tag] = values;
  }

  const width = tags[256][0];
  const height = tags[257][0];
  const compression = tags[259]?.[0] ?? 1;
  const predictor = tags[317]?.[0] ?? 1;
  if ((tags[258]?.[0] ?? 0) !== 32 || (tags[339]?.[0] ?? 1) !== 3) throw new Error(`${path}: se esperaba float32`);
  if (compression !== 1 && compression !== 8 && compression !== 32946) {
    throw new Error(`${path}: compresión ${compression} no soportada (solo ninguna o Deflate). Exporta el MDT sin LZW.`);
  }
  if (predictor !== 1) throw new Error(`${path}: predictor ${predictor} no soportado`);

  // Bloques: tiles (322/323) o tiras (278)
  const tiled = Boolean(tags[322]);
  const blockW = tiled ? tags[322][0] : width;
  const blockH = tiled ? tags[323][0] : (tags[278]?.[0] ?? height);
  const offsets = tags[tiled ? 324 : 273];
  const counts = tags[tiled ? 325 : 279];
  const across = Math.ceil(width / blockW);

  const data = new Float32Array(width * height);
  for (let b = 0; b < offsets.length; b++) {
    const raw = buf.subarray(offsets[b], offsets[b] + counts[b]);
    const block = compression === 1 ? raw : inflateSync(raw);
    const aligned = new ArrayBuffer(block.length - (block.length % 4));
    new Uint8Array(aligned).set(block.subarray(0, aligned.byteLength));
    const px = new Float32Array(aligned);
    const x0 = (b % across) * blockW;
    const y0 = Math.floor(b / across) * blockH;
    for (let y = 0; y < blockH && y0 + y < height; y++) {
      for (let x = 0; x < blockW && x0 + x < width; x++) {
        data[(y0 + y) * width + x0 + x] = px[y * blockW + x] ?? -32767;
      }
    }
  }

  // Georreferenciación
  const scale = tags[33550];
  const tie = tags[33922];
  const keys = tags[34735] ?? [];
  const geokey = (id) => {
    for (let i = 4; i + 3 < keys.length; i += 4) if (keys[i] === id) return keys[i + 3];
    return undefined;
  };
  const epsg = geokey(3072) ?? geokey(2048);
  const pixelIsPoint = geokey(1025) === 2;
  if (!scale || !tie || !epsg) throw new Error(`${path}: sin georreferenciación`);
  const half = pixelIsPoint ? 0 : 0.5; // los valores del MDT están en el centro del píxel
  return {
    path,
    width,
    height,
    data,
    epsg,
    nodata: tags[42113] ? Number(tags[42113][0]) : -32767,
    // coordenadas del centro del píxel (col, fila)
    x0: tie[3] + (half - tie[0]) * scale[0],
    y0: tie[4] - (half - tie[1]) * scale[1],
    sx: scale[0],
    sy: scale[1],
  };
}

/* ───────────── proyección: grados -> coordenadas del TIFF ───────────── */

const A = 6378137;
const F = 1 / 298.257222101; // GRS80 (ETRS89)
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const N_ = F / (2 - F);
const AA = (A / (1 + N_)) * (1 + (N_ * N_) / 4 + N_ ** 4 / 64);
const ALPHA = [
  N_ / 2 - (2 * N_ ** 2) / 3 + (5 * N_ ** 3) / 16,
  (13 * N_ ** 2) / 48 - (3 * N_ ** 3) / 5,
  (61 * N_ ** 3) / 240,
];

function makeProjector(epsg) {
  if (epsg === 4258 || epsg === 4326) return (lon, lat) => [lon, lat];
  if (epsg >= 25828 && epsg <= 25838) {
    const lon0 = ((epsg - 25800) * 6 - 183) * (Math.PI / 180);
    return (lonDeg, latDeg) => {
      const phi = latDeg * (Math.PI / 180);
      const dl = lonDeg * (Math.PI / 180) - lon0;
      const s = Math.sin(phi);
      const t = Math.sinh(Math.atanh(s) - E * Math.atanh(E * s));
      const xi = Math.atan2(t, Math.cos(dl));
      const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
      let x = xi;
      let y = eta;
      for (let j = 1; j <= 3; j++) {
        x += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        y += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      return [500000 + 0.9996 * AA * y, 0.9996 * AA * x];
    };
  }
  throw new Error(`EPSG:${epsg} no soportado (se admiten 258xx, 4258 y 4326)`);
}

/* ───────────── remuestreo ───────────── */

console.log(`Leyendo ${files.length} hoja(s)…`);
const sources = files.map((f) => {
  const t = readGeoTiff(resolve(f));
  console.log(`  ${f}: ${t.width}x${t.height}, EPSG:${t.epsg}, píxel ${t.sx} m`);
  return { ...t, project: makeProjector(t.epsg) };
});

const grid = new Float32Array(size * size);
let min = Infinity;
let max = -Infinity;
let misses = 0;
const missIdx = [];

function sampleSource(s, X, Y) {
  const c = (X - s.x0) / s.sx;
  const r = (s.y0 - Y) / s.sy;
  if (c < 0 || r < 0 || c > s.width - 1 || r > s.height - 1) return null;
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const c1 = Math.min(c0 + 1, s.width - 1);
  const r1 = Math.min(r0 + 1, s.height - 1);
  const fx = c - c0;
  const fy = r - r0;
  const v = [s.data[r0 * s.width + c0], s.data[r0 * s.width + c1], s.data[r1 * s.width + c0], s.data[r1 * s.width + c1]];
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < 4; k++) {
    if (v[k] <= -1000 || v[k] === s.nodata || Number.isNaN(v[k])) continue; // huecos
    sum += v[k] * w[k];
    wsum += w[k];
  }
  return wsum > 0 ? sum / wsum : null;
}

for (let j = 0; j < size; j++) {
  const lat = north - ((north - south) * j) / (size - 1);
  for (let i = 0; i < size; i++) {
    const lon = west + ((east - west) * i) / (size - 1);
    let value = null;
    for (const s of sources) {
      const [X, Y] = s.project(lon, lat);
      value = sampleSource(s, X, Y);
      if (value !== null) break;
    }
    if (value === null) {
      misses++;
      missIdx.push(j * size + i);
      continue;
    }
    grid[j * size + i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
}
if (misses === size * size) {
  console.error('Ningún punto del recuadro cae dentro de las hojas dadas. Revisa --bbox y las hojas.');
  process.exit(1);
}
for (const idx of missIdx) grid[idx] = min;
if (misses) {
  console.warn(`!! ${misses} puntos (${((100 * misses) / (size * size)).toFixed(1)} %) quedan fuera de las hojas o sin dato; se rellenan con la cota mínima. Falta alguna hoja?`);
}

/* ───────────── salida ───────────── */

mkdirSync(outDir, { recursive: true });
const out = Buffer.alloc(grid.length * 4);
for (let i = 0; i < grid.length; i++) out.writeFloatLE(grid[i], i * 4);
writeFileSync(resolve(outDir, 'heightmap.bin'), out);

const midLat = ((north + south) / 2) * (Math.PI / 180);
const metaPath = resolve(outDir, 'meta.json');
let previous = {};
if (existsSync(metaPath)) {
  try {
    previous = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    previous = {};
  }
}
const meta = {
  placeholder: false,
  encoding: 'float32-le',
  heightmap: 'data/heightmap.bin',
  gridWidth: size,
  gridHeight: size,
  ortho: previous.placeholder === false ? (previous.ortho ?? null) : null,
  widthMeters: Math.round((east - west) * 111320 * Math.cos(midLat)),
  heightMeters: Math.round((north - south) * 110574),
  minElev: Math.round(min),
  maxElev: Math.round(max),
  bounds: { west, south, east, north },
  source: 'MDT05 PNOA-LiDAR © Instituto Geográfico Nacional de España (CC BY 4.0)',
};
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

console.log(
  `OK  ${size}x${size}, cotas ${meta.minElev}-${meta.maxElev} m, ${meta.widthMeters}x${meta.heightMeters} m -> ${outDir}`,
);
