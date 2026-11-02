// Convierte tracks GPX en routes.json (GeoJSON con coordenadas normalizadas
// [u, v] sobre el terreno). Requiere haber ejecutado antes `npm run data:dem`,
// porque necesita los `bounds` (WGS84) de public/data/meta.json.
//
//   node scripts/gpx-to-routes.mjs rutas/valle.gpx rutas/cresta.gpx
//   node scripts/gpx-to-routes.mjs rutas/*.gpx --meta public/data/meta.json --out public/data/routes.json
//
// El id de cada ruta sale del nombre del fichero. Nombre, dificultad y descripción se toman,
// por este orden, de routes.json (si ya existía), del catálogo src/data/rutas.json (mismo id) y
// del propio GPX. Así los ficheros deben llamarse como el id del catálogo, p. ej. puerto-de-horcadas.gpx.
//
// Sin dependencias externas.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (files.length === 0) {
  console.error('Uso: node scripts/gpx-to-routes.mjs <ruta.gpx> [...] [--meta ...] [--out ...]');
  process.exit(1);
}

const metaPath = resolve(flag('meta', 'public/data/meta.json'));
const outPath = resolve(flag('out', 'public/data/routes.json'));

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
if (!meta.bounds) {
  console.error(
    'meta.json no tiene "bounds". Genera primero el relieve real con `npm run data:dem` (ver docs/datos.md).',
  );
  process.exit(1);
}
const { west, south, east, north } = meta.bounds;

let previous = new Map();
if (existsSync(outPath)) {
  try {
    const old = JSON.parse(readFileSync(outPath, 'utf8'));
    previous = new Map(old.features.map((f) => [f.properties.id, f.properties]));
  } catch {
    previous = new Map();
  }
}

let catalog = new Map();
const catalogPath = resolve(flag('catalog', 'src/data/rutas.json'));
if (existsSync(catalogPath)) {
  try {
    catalog = new Map(JSON.parse(readFileSync(catalogPath, 'utf8')).map((r) => [r.id, r]));
  } catch {
    catalog = new Map();
  }
}

const PALETTE = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff'];
const MIN_STEP = 0.0015; // separación mínima entre puntos (en unidades normalizadas)
const round5 = (n) => Math.round(n * 1e5) / 1e5;
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

const features = [];
files.forEach((file, index) => {
  const xml = readFileSync(resolve(file), 'utf8');
  const id = slug(basename(file).replace(/\.gpx$/i, '')) || `ruta-${index + 1}`;
  const nameMatch = xml.match(/<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  const name = nameMatch ? decode(nameMatch[1]) : basename(file).replace(/\.gpx$/i, '');

  const coords = [];
  let outside = 0;
  for (const m of xml.matchAll(/<trkpt\b([^>]*)>/g)) {
    const lat = Number(/lat="([^"]+)"/.exec(m[1])?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(m[1])?.[1]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const u = (lon - west) / (east - west);
    const v = (north - lat) / (north - south);
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      outside++;
      continue;
    }
    const last = coords[coords.length - 1];
    if (!last || Math.hypot(u - last[0], v - last[1]) >= MIN_STEP) coords.push([round5(u), round5(v)]);
  }
  if (coords.length < 2) {
    console.error(`!! ${file}: menos de 2 puntos dentro de la zona del relieve, se omite.`);
    return;
  }
  if (outside) console.warn(`!! ${file}: ${outside} puntos fuera del relieve descartados.`);

  const old = previous.get(id);
  const cat = catalog.get(id);
  features.push({
    type: 'Feature',
    properties: {
      id,
      name: old?.name ?? cat?.nombre ?? name,
      difficulty: old?.difficulty ?? cat?.dificultad ?? 'Media',
      color: old?.color ?? PALETTE[index % PALETTE.length],
      description: old?.description ?? cat?.resumen ?? 'Descripción pendiente.',
    },
    geometry: { type: 'LineString', coordinates: coords },
  });
  console.log(`OK  ${id}: ${coords.length} puntos`);
});

writeFileSync(
  outPath,
  JSON.stringify({ type: 'FeatureCollection', coordinateSpace: 'terrain-normalized-uv', features }) +
    '\n',
);
console.log(`-> ${outPath} (${features.length} rutas)`);
