// Genera datos SINTÉTICOS de relieve y rutas para poder desarrollar la web
// sin depender aún del MDT real del CNIG. No necesita dependencias.
//
//   npm run data:placeholder
//
// Salida (public/data):
//   heightmap.bin  -> rejilla de alturas en metros, Float32 little-endian, fila a fila (norte -> sur)
//   meta.json      -> dimensiones de la rejilla, tamaño real en metros, rango de alturas, flags
//   routes.json    -> GeoJSON con coordenadas normalizadas [u, v] (0..1) sobre el terreno
//
// Cuando tengas datos reales, `npm run data:dem` y `npm run data:routes`
// sobrescriben estos ficheros (ver docs/datos.md).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/data');
mkdirSync(outDir, { recursive: true });

const GRID = 513;
const WIDTH_METERS = 8000;
const HEIGHT_METERS = 8000;

// ---------- ruido ----------
function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function fbm(x, y, oct = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}
function ridged(x, y, oct = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(2 * vnoise(x * f, y * f) - 1);
    s += a * n * n;
    f *= 2;
    a *= 0.5;
  }
  return s;
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---------- relieve: un valle sinuoso (O-E) flanqueado por crestas ----------
const valleyV = (u) => 0.52 + 0.1 * Math.sin(u * 5.5 + 0.8);

function elevation(u, v) {
  const d = Math.abs(v - valleyV(u));
  const wall = smoothstep(0.03, 0.42, d);
  const rugged = ridged(u * 3.2 + 10, v * 3.2 + 4);
  const soft = fbm(u * 6, v * 6);
  return 950 + wall * (350 + 1500 * rugged) + (1 - wall) * 80 * soft;
}

const elev = Buffer.alloc(GRID * GRID * 4);
let minE = Infinity;
let maxE = -Infinity;
for (let y = 0; y < GRID; y++) {
  for (let x = 0; x < GRID; x++) {
    const e = elevation(x / (GRID - 1), y / (GRID - 1));
    elev.writeFloatLE(e, (y * GRID + x) * 4);
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
  }
}
writeFileSync(resolve(outDir, 'heightmap.bin'), elev);

const meta = {
  placeholder: true,
  encoding: 'float32-le',
  heightmap: 'data/heightmap.bin',
  gridWidth: GRID,
  gridHeight: GRID,
  ortho: null,
  widthMeters: WIDTH_METERS,
  heightMeters: HEIGHT_METERS,
  minElev: Math.round(minE),
  maxElev: Math.round(maxE),
};
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

// ---------- rutas de ejemplo (coordenadas normalizadas u,v) ----------
function chaikin(pts, iters = 3) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      q.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function densify(pts, maxStep = 0.004) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  return out;
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const shape = (pts) => densify(chaikin(pts)).map(([u, v]) => [round5(u), round5(v)]);

const valleyPts = [];
for (let u = 0.12; u <= 0.881; u += 0.1) valleyPts.push([u, valleyV(u) + 0.015]);

const routes = [
  {
    id: 'valle',
    name: 'Ruta del valle',
    difficulty: 'Fácil',
    color: '#ffd166',
    description:
      'Ruta de ejemplo. Aquí irá la descripción real: punto de salida, puntos de interés y recomendaciones.',
    pts: valleyPts,
  },
  {
    id: 'cresta',
    name: 'Subida a la cresta',
    difficulty: 'Difícil',
    color: '#ef476f',
    description:
      'Ruta de ejemplo. Ascenso desde el fondo del valle hasta la línea de cumbres, con tramos exigentes.',
    pts: [
      [0.45, valleyV(0.45) - 0.02],
      [0.5, 0.4],
      [0.47, 0.32],
      [0.56, 0.25],
      [0.62, 0.17],
    ],
  },
  {
    id: 'collado',
    name: 'Circular del collado',
    difficulty: 'Media',
    color: '#06d6a0',
    description:
      'Ruta de ejemplo. Recorrido circular de dificultad media que vuelve al punto de partida.',
    pts: [
      [0.3, 0.57],
      [0.25, 0.7],
      [0.33, 0.82],
      [0.45, 0.78],
      [0.4, 0.66],
      [0.3, 0.57],
    ],
  },
];

const collection = {
  type: 'FeatureCollection',
  coordinateSpace: 'terrain-normalized-uv',
  features: routes.map(({ pts, ...properties }) => ({
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: shape(pts) },
  })),
};
writeFileSync(resolve(outDir, 'routes.json'), JSON.stringify(collection) + '\n');

console.log(
  `OK  rejilla ${GRID}x${GRID}, cotas ${meta.minElev}-${meta.maxElev} m, ${routes.length} rutas -> public/data`,
);
