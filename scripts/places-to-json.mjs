// Convierte src/data/lugares.json en public/data/places.json (coordenadas normalizadas u,v y cota).
// Los picos se ajustan a la cota máxima del MDT dentro de `ajustar` metros.
//   node scripts/places-to-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const meta = JSON.parse(readFileSync(resolve('public/data/meta.json'), 'utf8'));
const raw = readFileSync(resolve('public/data/heightmap.bin'));
const hm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const { gridWidth: W, gridHeight: H, bounds: b } = meta;
const lugares = JSON.parse(readFileSync(resolve('src/data/lugares.json'), 'utf8'));
const mLat = 111200, mLon = 111200 * Math.cos((42.94 * Math.PI) / 180);

const out = lugares.map((p) => {
  let col = Math.round(((p.lon - b.west) / (b.east - b.west)) * (W - 1));
  let row = Math.round(((b.north - p.lat) / (b.north - b.south)) * (H - 1));
  if (p.ajustar > 0) {
    const rc = Math.ceil(p.ajustar / (meta.widthMeters / (W - 1)));
    let best = -Infinity, br = row, bc = col;
    for (let r = row - rc; r <= row + rc; r++)
      for (let c = col - rc; c <= col + rc; c++) {
        if (r < 0 || c < 0 || r >= H || c >= W) continue;
        const dm = Math.hypot((c - col) * meta.widthMeters / (W - 1), (r - row) * meta.heightMeters / (H - 1));
        if (dm > p.ajustar) continue;
        if (hm[r * W + c] > best) { best = hm[r * W + c]; br = r; bc = c; }
      }
    row = br; col = bc;
  }
  const lat = b.north - (row / (H - 1)) * (b.north - b.south);
  const lon = b.west + (col / (W - 1)) * (b.east - b.west);
  const elev = Math.round(hm[row * W + col]);
  const moved = Math.round(Math.hypot((lon - p.lon) * mLon, (lat - p.lat) * mLat));
  console.log(`${p.id}: ${elev} m, ajustado ${moved} m${p.porConfirmar ? '  (por confirmar)' : ''}`);
  return { id: p.id, name: p.nombre, kind: p.tipo, u: +(col / (W - 1)).toFixed(5), v: +(row / (H - 1)).toFixed(5), elev, unconfirmed: !!p.porConfirmar };
});
writeFileSync(resolve('public/data/places.json'), JSON.stringify(out, null, 1) + '\n');
