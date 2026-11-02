// Textura procedural del relieve para cuando todavía no hay ortofoto real.
// Función pura (sin Three.js ni DOM): recibe la rejilla de alturas remuestreada a n×n
// (fila 0 = norte) y devuelve píxeles RGBA. Combina:
//   · vegetación por cota (prado -> bosque -> pasto de altura -> roca -> nieve)
//   · roca en las pendientes fuertes
//   · ruido en tres escalas (manchas, matas y grano) para que no se vea plano
//   · sombreado suave desde el noroeste y curvas de nivel cada 25 m (índice cada 100 m)

export interface TerrainMeta {
  widthMeters: number;
  heightMeters: number;
  minElev: number;
  maxElev: number;
}

type RGB = [number, number, number];

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

const PRADO_A: RGB = [128, 152, 78];
const PRADO_B: RGB = [98, 128, 62];
const HENO: RGB = [158, 160, 92];
const BOSQUE_A: RGB = [46, 72, 42];
const BOSQUE_B: RGB = [66, 92, 50];
const PASTO_A: RGB = [140, 138, 90];
const PASTO_B: RGB = [160, 150, 110];
const ROCA_A: RGB = [128, 122, 114];
const ROCA_B: RGB = [170, 162, 150];
const NIEVE: RGB = [238, 236, 230];
const AGUA: RGB = [40, 92, 116];
const ORILLA: RGB = [156, 142, 112];

// Los embalses aparecen en el MDT como una superficie perfectamente plana a una cota fija.
// Busca el nivel plano más frecuente; si ocupa una parte apreciable del mapa, es agua.
function detectWaterLevel(elev: Float32Array, n: number): number | null {
  const bins = new Map<number, number>();
  let flat = 0;
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      const e = elev[i] as number;
      if (Math.abs((elev[i + 1] as number) - e) < 0.02 && Math.abs((elev[i + n] as number) - e) < 0.02) {
        const key = Math.round(e * 2) / 2;
        bins.set(key, (bins.get(key) ?? 0) + 1);
        flat++;
      }
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [key, count] of bins) {
    // Une el bin vecino (el nivel puede caer entre dos medias alturas)
    const total = count + (bins.get(key + 0.5) ?? 0);
    if (total > bestCount) {
      bestCount = total;
      best = key + ((bins.get(key + 0.5) ?? 0) > count ? 0.25 : 0);
    }
  }
  return best !== null && bestCount > n * n * 0.004 && flat > 0 ? best : null;
}

// Dirección hacia la luz (noroeste, elevada). El eje y de la imagen apunta al sur.
const LIGHT = (() => {
  const v: RGB = [-0.5, -0.5, 0.72];
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len] as RGB;
})();

export function paintTerrainTexture(elev: Float32Array, n: number, meta: TerrainMeta): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * n * 4);
  const mx = meta.widthMeters / (n - 1); // metros por píxel en x
  const my = meta.heightMeters / (n - 1); // metros por píxel en y
  const range = Math.max(1, meta.maxElev - meta.minElev);
  const water = detectWaterLevel(elev, n);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const e = elev[i] as number;

      // Gradiente por diferencias centrales (en el borde, unilateral)
      const xl = x > 0 ? i - 1 : i;
      const xr = x < n - 1 ? i + 1 : i;
      const yu = y > 0 ? i - n : i;
      const yd = y < n - 1 ? i + n : i;
      const gx = ((elev[xr] as number) - (elev[xl] as number)) / (x > 0 && x < n - 1 ? 2 : 1); // m por píxel
      const gy = ((elev[yd] as number) - (elev[yu] as number)) / (y > 0 && y < n - 1 ? 2 : 1);
      const dzdx = gx / mx;
      const dzdy = gy / my;
      const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);

      // Sombreado (normalizado para que una superficie plana valga 1)
      const nl = Math.hypot(dzdx, dzdy, 1);
      const lambert = (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) / nl;
      const shade = clamp(lambert / LIGHT[2], 0, 1.35);
      const light = 1 + (shade - 1) * 0.5;

      // Ruido en tres escalas
      const patch = vnoise(x * 0.012 + 5.3, y * 0.012 + 9.1); // manchas grandes
      const clump = vnoise(x * 0.07, y * 0.07); // matas
      const speck = vnoise(x * 0.55 + 3.1, y * 0.55 + 7.7); // textura de arbolado
      const grain = hash(x, y); // grano

      // Piso altitudinal con el límite perturbado por el ruido
      const t = clamp((e - meta.minElev) / range + (patch - 0.5) * 0.09, 0, 1);

      // Fondo de valle: mosaico suave de prados y cultivos, con tonos que cambian por zonas
      let c: RGB = mix(PRADO_A, PRADO_B, smooth(0.3, 0.7, clump) * 0.5);
      c = mix(c, HENO, smooth(0.55, 0.8, patch) * 0.55);
      c = mix(c, mix(BOSQUE_A, BOSQUE_B, speck), smooth(0.08, 0.17, t));
      c = mix(c, mix(PASTO_A, PASTO_B, clump), smooth(0.4, 0.56, t));
      c = mix(c, mix(ROCA_A, ROCA_B, speck), smooth(0.72, 0.86, t));
      c = mix(c, NIEVE, smooth(0.9, 0.98, t) * 0.75);

      // Roca desnuda en pendientes fuertes
      const rock = smooth(26, 42, slopeDeg + (speck - 0.5) * 6);
      c = mix(c, mix(ROCA_A, ROCA_B, speck), rock);

      // Brillo: variación natural + sombreado
      let brightness = (0.86 + 0.2 * clump + 0.12 * (speck - 0.5) + 0.06 * (grain - 0.5)) * light;

      // Agua (embalse) y franja de orilla descubierta
      let isWater = false;
      if (water !== null) {
        const dz = e - water;
        const g0 = Math.hypot(gx, gy);
        if (g0 < 0.12 && Math.abs(dz) < 0.9) {
          isWater = true;
          c = mix(AGUA, [58, 112, 136], smooth(0.4, 0.75, patch) * 0.6);
          brightness = 0.92 + 0.18 * clump;
        } else if (dz >= 0 && dz < 4) {
          c = mix(c, ORILLA, (1 - smooth(0, 4, dz)) * 0.8 * (1 - rock));
        }
      }

      // Curvas de nivel: finas cada 25 m, más marcadas cada 100 m
      const g = Math.hypot(gx, gy);
      let contour = 0;
      // Si las curvas quedan a menos de ~1 píxel (laderas muy empinadas) se apelmazan: se desvanecen
      const crowd = 1 - smooth(1.5, 4, g);
      if (!isWater && g > 0.08 && crowd > 0) {
        const r25 = ((e % 25) + 25) % 25;
        const r100 = ((e % 100) + 100) % 100;
        const minor = 1 - smooth(0.3, 0.9, Math.min(r25, 25 - r25) / g);
        const index = 1 - smooth(0.4, 1.1, Math.min(r100, 100 - r100) / g);
        contour = (0.07 * minor + 0.16 * index) * crowd;
      }
      const k = brightness * (1 - contour);

      const o = i * 4;
      out[o] = c[0] * k;
      out[o + 1] = c[1] * k;
      out[o + 2] = c[2] * k;
      out[o + 3] = 255;
    }
  }
  return out;
}
