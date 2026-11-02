// Genera una vista previa estática de la web SIN npm install: carga Three.js, GSAP y Lenis
// desde CDN y usa el mismo código (src/scripts/*.ts) y el mismo HTML (src/lib/render.mjs).
//
//   node scripts/make-preview.mjs --out preview
//
// Pensada para publicarla como artefacto o abrirla con un servidor estático. No sustituye a
// `npm run build`: en la vista previa el heightmap viaja como JSON (alturas en decímetros) y los
// módulos se cargan desde un import map. Requiere Node 22.13+ (usa module.stripTypeScriptTypes).

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBody } from '../src/lib/render.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const out = resolve(outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : 'preview');
mkdirSync(resolve(out, 'data'), { recursive: true });

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const readJSON = (p) => JSON.parse(read(p));

// ---------- scripts: TS -> JS, imports de librerías -> globales de los <script> ----------
const strip = (file) => stripTypeScriptTypes(read(file));

let scene = strip('src/scripts/scene.ts')
  .replace(/import gsap from 'gsap';/, 'const gsap = window.gsap;')
  .replace(/import \{ ScrollTrigger \} from 'gsap\/ScrollTrigger';/, 'const ScrollTrigger = window.ScrollTrigger;')
  .replace(/import Lenis from 'lenis';/, 'const Lenis = window.Lenis;')
  .replace(/import\.meta\.env\.BASE_URL/g, "'./'")
  .replace("from './terrain-texture.ts'", "from './terrain-texture.js'");
if (/from 'gsap|from 'lenis|import\.meta/.test(scene)) throw new Error('Quedan imports sin reemplazar en scene.ts');

// El heightmap viaja como JSON (los artefactos no sirven .bin): alturas en decímetros
const loaderStart = scene.indexOf('const buffer = await res.arrayBuffer();');
const loaderEnd = scene.indexOf('const data = new Float32Array(buffer);');
if (loaderStart < 0 || loaderEnd < 0) throw new Error('No se pudo adaptar loadHeightmap para la vista previa');
scene =
  scene.slice(0, loaderStart) +
  'const w = meta.gridWidth;\n  const h = meta.gridHeight;\n  const data = Float32Array.from(await res.json(), (v) => v / 10);' +
  scene.slice(loaderEnd + 'const data = new Float32Array(buffer);'.length);

writeFileSync(resolve(out, 'scene.js'), scene);
writeFileSync(resolve(out, 'board.js'), strip('src/scripts/board.ts'));
writeFileSync(resolve(out, 'terrain-texture.js'), strip('src/scripts/terrain-texture.ts'));

// ---------- datos ----------
const meta = readJSON('public/data/meta.json');
const bin = readFileSync(resolve(root, 'public', meta.heightmap));
const values = new Array(bin.length / 4);
for (let i = 0; i < values.length; i++) values[i] = Math.round(bin.readFloatLE(i * 4) * 10);
writeFileSync(resolve(out, 'data/heightmap.json'), JSON.stringify(values));
writeFileSync(resolve(out, 'data/meta.json'), JSON.stringify({ ...meta, heightmap: 'data/heightmap.json' }, null, 2));
cpSync(resolve(root, 'public/data/routes.json'), resolve(out, 'data/routes.json'));

// ---------- HTML ----------
const css = read('src/styles/global.css')
  .replace(':root {', ':root {\n  color-scheme: dark;')
  .replace(/padding: 0 6vw;/, 'padding-block: 0;\n  padding-left: max(16px, 6vw);\n  padding-right: max(16px, 6vw);')
  .replace(/\.chapter \{\n    padding: 0 1rem;\n  \}/, '.chapter {\n    padding-left: max(16px, 4vw);\n    padding-right: max(16px, 4vw);\n  }');

const body = renderBody({
  rutas: readJSON('src/data/rutas.json'),
  enlaces: readJSON('src/data/enlaces.json'),
  anuncios: readJSON('src/data/anuncios.json'),
  seguridad: readJSON('src/data/seguridad.json'),
});

const importMap = {
  imports: {
    three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
  },
};

const html = [
  '<title>Horcadas</title>',
  `<style>\n${css}\nbody{margin:0;background:var(--bg);color:var(--ink)}\n</style>`,
  body.trim(),
  `<script type="importmap">${JSON.stringify(importMap)}</script>`,
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>',
  '<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js"></script>',
  '<script type="module" src="scene.js"></script>',
  '<script type="module" src="board.js"></script>',
  '',
].join('\n');
writeFileSync(resolve(out, 'index.html'), html);

console.log(`OK  vista previa en ${out} (${(html.length / 1024).toFixed(1)} kB de HTML)`);
