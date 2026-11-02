// Descarga la ortofoto PNOA del IGN de la zona del relieve y la deja lista para la web.
//
//   node scripts/fetch-ortho.mjs                          usa los `bounds` de public/data/meta.json
//   node scripts/fetch-ortho.mjs --bbox O,S,E,N           rectángulo en grados (oeste,sur,este,norte)
//   node scripts/fetch-ortho.mjs --size 4096              lado en píxeles (por defecto 4096)
//
// Escribe public/data/ortho.jpg y pone "ortho": "data/ortho.jpg" en public/data/meta.json.
// Hay que ejecutarlo en un equipo con acceso a internet (no se ha podido probar desde el
// entorno de desarrollo, donde ign.es está bloqueado). Sin dependencias externas.
//
// Fuente: servicio WMS "PNOA máxima actualidad" del IGN. Los datos del IGN/CNIG se publican
// con licencia CC BY 4.0: la web debe citar "© Instituto Geográfico Nacional de España".
//
// La imagen cubre exactamente el mismo rectángulo (en grados) que el MDT, así que encaja
// con el relieve sin más ajustes. Si el servidor rechaza el tamaño, prueba con --size 2048.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const metaPath = resolve(flag('meta', 'public/data/meta.json'));
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;

let west;
let south;
let east;
let north;
const bbox = flag('bbox');
if (bbox) {
  [west, south, east, north] = bbox.split(',').map(Number);
} else if (meta?.bounds) {
  ({ west, south, east, north } = meta.bounds);
}
if ([west, south, east, north].some((n) => typeof n !== 'number' || Number.isNaN(n))) {
  console.error('Faltan coordenadas. Ejecuta antes `npm run data:dem` (crea los bounds) o pasa --bbox O,S,E,N.');
  process.exit(1);
}
if (!(west < east && south < north)) {
  console.error('bbox no válido: se espera oeste < este y sur < norte.');
  process.exit(1);
}

const size = Number(flag('size', '4096'));
const url = new URL('https://www.ign.es/wms-inspire/pnoa-ma');
url.search = new URLSearchParams({
  SERVICE: 'WMS',
  VERSION: '1.3.0',
  REQUEST: 'GetMap',
  LAYERS: 'OI.OrthoimageCoverage',
  STYLES: '',
  CRS: 'EPSG:4326',
  // En WMS 1.3.0 con EPSG:4326 el orden de ejes es latitud,longitud
  BBOX: `${south},${west},${north},${east}`,
  WIDTH: String(size),
  HEIGHT: String(size),
  FORMAT: 'image/jpeg',
}).toString();

console.log(`Descargando ortofoto ${size}x${size} de [${west}, ${south}, ${east}, ${north}] …`);
const res = await fetch(url);
const type = res.headers.get('content-type') ?? '';
if (!res.ok || !type.startsWith('image/')) {
  const text = (await res.text()).slice(0, 400);
  console.error(`El servidor no devolvió una imagen (${res.status}, ${type}).\n${text}`);
  process.exit(1);
}
const buffer = Buffer.from(await res.arrayBuffer());

const outDir = resolve('public/data');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'ortho.jpg'), buffer);

if (meta) {
  meta.ortho = 'data/ortho.jpg';
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
}
console.log(`OK  public/data/ortho.jpg (${(buffer.length / 1e6).toFixed(1)} MB)` + (meta ? ' y meta.json actualizado' : ''));
console.log('Recuerda citar: © Instituto Geográfico Nacional de España (CC BY 4.0).');
