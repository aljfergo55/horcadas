// Convierte un MDT recortado (ESRI ASCII Grid, EPSG:4326) en los ficheros que
// consume la web: heightmap.bin (Float32 LE, metros) + meta.json.
//
//   node scripts/dem-to-heightmap.mjs data-raw/horcadas.asc
//   node scripts/dem-to-heightmap.mjs data-raw/horcadas.asc --out public/data
//
// El .asc se genera con GDAL (ver docs/datos.md):
//   gdal_translate -of AAIGrid recorte.tif data-raw/horcadas.asc
//
// Sin dependencias externas.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const input = positional[0];
if (!input) {
  console.error('Uso: node scripts/dem-to-heightmap.mjs <modelo.asc> [--out public/data]');
  process.exit(1);
}
const outDir = resolve(flag('out', 'public/data'));
mkdirSync(outDir, { recursive: true });

// ---------- leer cabecera ----------
const lines = readFileSync(resolve(input), 'utf8').split(/\r?\n/);
const header = {};
let cursor = 0;
for (; cursor < lines.length; cursor++) {
  const m = lines[cursor].trim().match(/^([A-Za-z_]+)\s+(\S+)$/);
  if (!m) break;
  header[m[1].toLowerCase()] = m[2];
}
const ncols = Number(header.ncols);
const nrows = Number(header.nrows);
const dx = Number(header.cellsize ?? header.dx);
const dy = Number(header.cellsize ?? header.dy);
const nodata = header.nodata_value !== undefined ? Number(header.nodata_value) : -9999;
if (!ncols || !nrows || !dx || !dy) {
  console.error('Cabecera ASCII Grid no válida (faltan ncols/nrows/cellsize).');
  process.exit(1);
}
if (dx > 0.1) {
  console.error(
    `cellsize=${dx}: parece que el MDT NO está en EPSG:4326 (grados). Reproyecta con gdalwarp -t_srs EPSG:4326 (ver docs/datos.md).`,
  );
  process.exit(1);
}
const west =
  header.xllcorner !== undefined ? Number(header.xllcorner) : Number(header.xllcenter) - dx / 2;
const south =
  header.yllcorner !== undefined ? Number(header.yllcorner) : Number(header.yllcenter) - dy / 2;
const east = west + ncols * dx;
const north = south + nrows * dy;

// ---------- leer datos (primera fila = norte) ----------
const values = new Float32Array(ncols * nrows);
let n = 0;
for (let r = 0; r < nrows; r++) {
  const row = lines[cursor + r];
  if (row === undefined) break;
  for (const tok of row.trim().split(/\s+/)) {
    if (n < values.length && tok !== '') values[n++] = Number(tok);
  }
}
if (n !== values.length) {
  console.error(`Se esperaban ${values.length} valores y se han leído ${n}.`);
  process.exit(1);
}

let min = Infinity;
let max = -Infinity;
let holes = 0;
for (const v of values) {
  if (v === nodata || Number.isNaN(v)) continue;
  if (v < min) min = v;
  if (v > max) max = v;
}
for (let i = 0; i < values.length; i++) {
  if (values[i] === nodata || Number.isNaN(values[i])) {
    values[i] = min;
    holes++;
  }
}

// ---------- escribir heightmap.bin ----------
const buf = Buffer.alloc(values.length * 4);
for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
writeFileSync(resolve(outDir, 'heightmap.bin'), buf);

// ---------- meta.json ----------
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
  gridWidth: ncols,
  gridHeight: nrows,
  // Se conserva la ortofoto si ya había una real configurada
  ortho: previous.placeholder === false ? (previous.ortho ?? null) : null,
  widthMeters: Math.round((east - west) * 111320 * Math.cos(midLat)),
  heightMeters: Math.round((north - south) * 110574),
  minElev: Math.round(min),
  maxElev: Math.round(max),
  bounds: { west, south, east, north },
};
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

console.log(
  `OK  ${ncols}x${nrows}, cotas ${meta.minElev}-${meta.maxElev} m, ${meta.widthMeters}x${meta.heightMeters} m` +
    (holes ? `, ${holes} huecos rellenados` : '') +
    ` -> ${outDir}`,
);
