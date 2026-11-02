// Escena 3D de Horcadas: relieve, rutas con hover y cámara guiada por scroll.
//
// Flujo:
//   1. Carga meta.json + heightmap.bin + routes.json (public/data)
//   2. Construye el terreno (malla desplazada por el heightmap) y las rutas (tubos sobre el relieve)
//   3. GSAP ScrollTrigger convierte el scroll en un progreso 0..1 que mueve la cámara por un camino
//   4. Al final de la página se activa OrbitControls y el hover/click sobre las rutas

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { paintTerrainTexture } from './terrain-texture.ts';

gsap.registerPlugin(ScrollTrigger);

/* ───────────────────────── tipos ───────────────────────── */

type Difficulty = 'Fácil' | 'Media' | 'Difícil';

interface Meta {
  placeholder: boolean;
  heightmap: string;
  gridWidth: number;
  gridHeight: number;
  ortho: string | null;
  widthMeters: number;
  heightMeters: number;
  minElev: number;
  maxElev: number;
}

interface RouteProps {
  id: string;
  name: string;
  difficulty: Difficulty;
  color: string;
  description: string;
}

interface RouteCollection {
  features: { properties: RouteProps; geometry: { coordinates: [number, number][] } }[];
}

interface Heightmap {
  sample(u: number, v: number): number;
}

interface RouteStats {
  distanceM: number;
  ascentM: number;
  descentM: number;
  minElev: number;
  maxElev: number;
  profile: number[];
  minutes: number;
}

interface RouteRuntime {
  props: RouteProps;
  stats: RouteStats;
  material: THREE.MeshBasicMaterial;
  line: THREE.Mesh;
  hit: THREE.Mesh;
  center: THREE.Vector3;
  tubular: number;
  indicesPerSegment: number;
}

/* ───────────────────────── constantes y utilidades ───────────────────────── */

const WORLD_W = 100; // ancho del terreno en unidades de escena
const EXAGGERATION = 1.6; // exageración vertical
const ROUTE_LIFT = 0.55; // las rutas flotan un poco sobre el suelo
const TUBE_RADIUS = 0.2;
const HIT_RADIUS = 1.1; // tubo invisible, más grueso, para que el hover sea fácil

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = matchMedia('(pointer: coarse)').matches;
const lowPower = coarsePointer || matchMedia('(max-width: 700px)').matches;

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const baseUrl = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const asset = (path: string): string => baseUrl + path.replace(/^\//, '');

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

/* ───────────────────────── carga de datos ───────────────────────── */

async function loadJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url} (${res.status})`);
  return (await res.json()) as T;
}

async function loadHeightmap(meta: Meta): Promise<Heightmap> {
  const res = await fetch(asset(meta.heightmap));
  if (!res.ok) throw new Error(`No se pudo cargar ${meta.heightmap} (${res.status})`);
  const buffer = await res.arrayBuffer();
  const w = meta.gridWidth;
  const h = meta.gridHeight;
  if (buffer.byteLength !== w * h * 4) {
    throw new Error('heightmap.bin no coincide con las dimensiones de meta.json');
  }
  const data = new Float32Array(buffer);
  return {
    // Interpolación bilineal; (u, v) en 0..1, v = 0 es el norte
    sample(u: number, v: number): number {
      const x = clamp(u, 0, 1) * (w - 1);
      const y = clamp(v, 0, 1) * (h - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, h - 1);
      const fx = x - x0;
      const fy = y - y0;
      const a = data[y0 * w + x0] as number;
      const b = data[y0 * w + x1] as number;
      const c = data[y1 * w + x0] as number;
      const d = data[y1 * w + x1] as number;
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    },
  };
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

/* ───────────────────────── ambiente (hora del día) ───────────────────────── */

interface EnvKey {
  p: number;
  sky: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  azimuth: number;
  elevation: number;
}

const env = (p: number, sky: string, sun: string, sunIntensity: number, azimuth: number, elevation: number): EnvKey => ({
  p,
  sky: new THREE.Color(sky),
  sun: new THREE.Color(sun),
  sunIntensity,
  azimuth,
  elevation,
});

// Amanecer -> mediodía -> tarde -> atardecer frío, según el progreso del scroll
const ENV_KEYS: EnvKey[] = [
  env(0.0, '#e9b98f', '#ffb47a', 1.6, -1.0, 0.35),
  env(0.35, '#bcd4e3', '#fff1d9', 2.6, -0.3, 0.9),
  env(0.7, '#d7c6b2', '#ffe2b8', 2.2, 0.5, 0.6),
  env(1.0, '#8ea6bb', '#ffd2a0', 1.9, 0.9, 0.4),
];

/* ───────────────────────── terreno ───────────────────────── */

function buildTerrainTexture(hm: Heightmap, meta: Meta): THREE.CanvasTexture {
  const n = lowPower ? 1024 : 2048;
  const elev = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) elev[y * n + x] = hm.sample(x / (n - 1), y / (n - 1));
  }
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const pixels = paintTerrainTexture(elev, n, meta);
  ctx.putImageData(new ImageData(pixels, n, n), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildTerrain(
  hm: Heightmap,
  meta: Meta,
  k: number,
  worldD: number,
  map: THREE.Texture,
): THREE.Mesh {
  const segX = lowPower ? 160 : 320;
  const segZ = clamp(Math.round(segX * (meta.heightMeters / meta.widthMeters)), 32, 640);
  const geo = new THREE.PlaneGeometry(WORLD_W, worldD, segX, segZ);
  geo.rotateX(-Math.PI / 2); // tras girar, v = 0 (norte) queda en -Z

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / WORLD_W + 0.5;
    const v = pos.getZ(i) / worldD + 0.5;
    const elev = hm.sample(u, v);
    // Los bordes se hunden en la niebla: la isla de relieve no acaba en un corte seco
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const drop = Math.pow(smoothstep(0.07, 0, edge), 2) * 28;
    pos.setY(i, (elev - meta.minElev) * k * EXAGGERATION - drop);
  }
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = !lowPower;
  mesh.receiveShadow = !lowPower;
  return mesh;
}

/* ───────────────────────── estadísticas de ruta ───────────────────────── */

function computeStats(coords: [number, number][], hm: Heightmap, meta: Meta): RouteStats {
  const raw = coords.map(([u, v]) => hm.sample(u, v));
  // Media móvil para no inflar el desnivel con el ruido del MDT
  const profile = raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(raw.length - 1, i + 4); j++) {
      sum += raw[j] as number;
      n++;
    }
    return sum / n;
  });
  let distanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  for (let i = 1; i < coords.length; i++) {
    const [u0, v0] = coords[i - 1] as [number, number];
    const [u1, v1] = coords[i] as [number, number];
    distanceM += Math.hypot((u1 - u0) * meta.widthMeters, (v1 - v0) * meta.heightMeters);
    const dh = (profile[i] as number) - (profile[i - 1] as number);
    if (dh > 0) ascentM += dh;
    else descentM -= dh;
  }
  const hours = distanceM / 5000 + ascentM / 600; // regla sencilla: 5 km/h + 600 m de subida/h
  return {
    distanceM,
    ascentM,
    descentM,
    minElev: Math.min(...profile),
    maxElev: Math.max(...profile),
    profile,
    minutes: Math.round((hours * 60) / 5) * 5,
  };
}

const formatKm = (m: number): string => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const formatDuration = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m > 0 ? `${m} min` : ''}`.trim() : `${m} min`;
};

function profileSvg(stats: RouteStats, color: string): string {
  const W = 260;
  const H = 56;
  const n = stats.profile.length;
  const step = Math.max(1, Math.floor(n / 80));
  const span = Math.max(1, stats.maxElev - stats.minElev);
  const point = (i: number): string => {
    const x = (i / (n - 1)) * W;
    const y = H - 4 - (((stats.profile[i] as number) - stats.minElev) / span) * (H - 10);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  let line = '';
  for (let i = 0; i < n; i += step) line += `${line ? 'L' : 'M'}${point(i)}`;
  line += `L${point(n - 1)}`;
  const c = esc(color);
  return (
    `<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Perfil de elevación">` +
    `<path d="${line}L${W} ${H}L0 ${H}Z" fill="${c}" fill-opacity=".18"/>` +
    `<path d="${line}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`
  );
}

/* ───────────────────────── principal ───────────────────────── */

function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  } catch {
    return null; // sin WebGL: la web sigue funcionando como página de texto
  }
}

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('#scene');
  const loader = $('#loader');
  const loaderBar = $('#loader-bar');
  const loaderText = $('#loader-text');
  const panel = $('#route-panel');
  const routeList = $('#route-list');
  if (!canvas || !panel) return;

  const hideLoader = (): void => {
    loader?.classList.add('done');
    window.setTimeout(() => loader?.remove(), 900);
  };
  const progress = (f: number): void => {
    if (loaderBar) loaderBar.style.transform = `scaleX(${f})`;
  };

  const renderer = createRenderer(canvas);
  if (!renderer) {
    document.documentElement.classList.add('no-webgl');
    hideLoader();
    return;
  }

  try {
    /* ── datos ── */
    const meta = await loadJSON<Meta>(asset('data/meta.json'));
    progress(0.15);
    const [hm, routeData, ortho] = await Promise.all([
      loadHeightmap(meta),
      loadJSON<RouteCollection>(asset('data/routes.json')),
      meta.ortho ? loadTexture(asset(meta.ortho)) : Promise.resolve(null),
    ]);
    progress(0.6);
    if (ortho) ortho.colorSpace = THREE.SRGBColorSpace;
    if (meta.placeholder) $('#placeholder-note')?.removeAttribute('hidden');

    /* ── escena ── */
    const k = WORLD_W / meta.widthMeters; // metros -> unidades de escena
    const worldD = meta.heightMeters * k;
    const groundY = (u: number, v: number): number =>
      (hm.sample(clamp(u, 0, 1), clamp(v, 0, 1)) - meta.minElev) * k * EXAGGERATION;
    const groundAt = (x: number, z: number): number => groundY(x / WORLD_W + 0.5, z / worldD + 0.5);
    const at = (u: number, v: number, lift: number): THREE.Vector3 =>
      new THREE.Vector3((u - 0.5) * WORLD_W, groundY(u, v) + lift, (v - 0.5) * worldD);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = !lowPower;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(ENV_KEYS[0]?.sky ?? '#bcd4e3');
    scene.background = skyColor.clone();
    scene.fog = new THREE.Fog(skyColor.clone(), 60, 260);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 600);

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x3b3f2f, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.castShadow = !lowPower;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.6;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(0, 10, 0);
    scene.add(sun, sun.target);

    const groundTexture = ortho ?? buildTerrainTexture(hm, meta);
    groundTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const terrain = buildTerrain(hm, meta, k, worldD, groundTexture);
    scene.add(terrain);

    /* ── rutas ── */
    const routes: RouteRuntime[] = routeData.features.map((feature) => {
      const coords = feature.geometry.coordinates;
      const points = coords.map(([u, v]) => at(u, v, ROUTE_LIFT));
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const tubular = Math.min(points.length * 2, 800);
      const radial = 6;

      const material = new THREE.MeshBasicMaterial({
        color: feature.properties.color,
        fog: false,
        transparent: true,
      });
      const lineGeo = new THREE.TubeGeometry(curve, tubular, TUBE_RADIUS, radial, false);
      lineGeo.setDrawRange(0, 0); // se dibuja al llegar al capítulo de rutas
      const line = new THREE.Mesh(lineGeo, material);

      const hit = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.ceil(tubular / 2), HIT_RADIUS, 4, false),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false, side: THREE.DoubleSide }),
      );

      const center = new THREE.Vector3();
      points.forEach((p) => center.add(p));
      center.divideScalar(points.length);

      const runtime: RouteRuntime = {
        props: feature.properties,
        stats: computeStats(coords, hm, meta),
        material,
        line,
        hit,
        center,
        tubular,
        indicesPerSegment: radial * 6,
      };
      hit.userData.route = runtime;
      scene.add(line, hit);
      return runtime;
    });
    const hitMeshes = routes.map((r) => r.hit);

    /* ── camino de cámara ── */
    const posCurve = new THREE.CatmullRomCurve3(
      [
        at(0.5, 1.25, 60),
        at(0.4, 0.95, 30),
        at(0.2, 0.62, 16),
        at(0.45, 0.5, 14),
        at(0.75, 0.55, 18),
        at(0.9, 0.9, 40),
      ],
      false,
      'centripetal',
    );
    const lookCurve = new THREE.CatmullRomCurve3(
      [at(0.5, 0.5, 0), at(0.45, 0.6, 6), at(0.45, 0.5, 6), at(0.75, 0.5, 6), at(0.5, 0.35, 8), at(0.5, 0.5, 6)],
      false,
      'centripetal',
    );
    const lookTarget = lookCurve.getPoint(0);
    camera.position.copy(posCurve.getPoint(0));
    camera.lookAt(lookTarget);

    const controls = new OrbitControls(camera, canvas);
    controls.enabled = false;
    controls.enableZoom = false; // la rueda sigue siendo scroll de página
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 10;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.47;
    canvas.style.touchAction = 'pan-y'; // OrbitControls lo pone a 'none'; así el scroll táctil sigue funcionando

    /* ── hora del día según progreso ── */
    const applyEnvironment = (p: number): void => {
      let i = 0;
      while (i < ENV_KEYS.length - 2 && p > (ENV_KEYS[i + 1] as EnvKey).p) i++;
      const a = ENV_KEYS[i] as EnvKey;
      const b = ENV_KEYS[i + 1] as EnvKey;
      const t = smoothstep(0, 1, (p - a.p) / (b.p - a.p));
      skyColor.lerpColors(a.sky, b.sky, t);
      (scene.background as THREE.Color).copy(skyColor);
      (scene.fog as THREE.Fog).color.copy(skyColor);
      sun.color.lerpColors(a.sun, b.sun, t);
      sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t);
      const az = lerp(a.azimuth, b.azimuth, t);
      const el = lerp(a.elevation, b.elevation, t);
      sun.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(120);
    };

    /* ── selección / hover de rutas ── */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const white = new THREE.Color('#ffffff');
    let routesRevealed = false;
    let hoverId: string | null = null;
    let pinnedId: string | null = null;
    let shownId: string | null = null;
    let pointer: { x: number; y: number } | null = null;
    let exploring = false;

    const pick = (x: number, y: number): RouteRuntime | null => {
      ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(hitMeshes, false)[0];
      if (!hit) return null;
      const ground = raycaster.intersectObject(terrain, false)[0];
      if (ground && ground.distance < hit.distance - 0.6) return null; // tapada por una loma
      return (hit.object.userData.route as RouteRuntime) ?? null;
    };

    const renderPanel = (r: RouteRuntime): void => {
      const s = r.stats;
      panel.innerHTML =
        `<button class="close" type="button" aria-label="Cerrar">×</button>` +
        `<p class="badge" style="--c:${esc(r.props.color)}">${esc(r.props.difficulty)}</p>` +
        `<h3>${esc(r.props.name)}</h3>` +
        `<dl class="stats">` +
        `<div><dt>Distancia</dt><dd>${formatKm(s.distanceM)}</dd></div>` +
        `<div><dt>Desnivel +</dt><dd>${Math.round(s.ascentM)} m</dd></div>` +
        `<div><dt>Desnivel −</dt><dd>${Math.round(s.descentM)} m</dd></div>` +
        `<div><dt>Cota máx.</dt><dd>${Math.round(s.maxElev)} m</dd></div></dl>` +
        profileSvg(s, r.props.color) +
        `<p class="time">Tiempo estimado: ${formatDuration(s.minutes)}</p>` +
        `<p class="desc">${esc(r.props.description)}</p>`;
    };

    const positionPanel = (): void => {
      const docked = pinnedId !== null || coarsePointer;
      panel.classList.toggle('docked', docked);
      if (docked || !pointer) {
        panel.style.left = '';
        panel.style.top = '';
        return;
      }
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      panel.style.left = `${clamp(pointer.x + 18, 8, window.innerWidth - w - 8)}px`;
      panel.style.top = `${clamp(pointer.y + 18, 8, window.innerHeight - h - 8)}px`;
    };

    const applyActive = (): void => {
      const activeId = pinnedId ?? hoverId;
      for (const r of routes) {
        const on = r.props.id === activeId;
        r.material.opacity = activeId && !on ? 0.3 : 1;
        r.material.color.set(r.props.color);
        if (on) r.material.color.lerp(white, 0.45);
      }
      routeList?.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.id === activeId);
      });
      const active = routes.find((r) => r.props.id === activeId);
      if (!active) {
        shownId = null;
        panel.classList.remove('visible');
        document.body.style.cursor = '';
        return;
      }
      if (shownId !== activeId) {
        renderPanel(active);
        shownId = activeId;
      }
      positionPanel();
      panel.classList.add('visible');
      document.body.style.cursor = hoverId ? 'pointer' : '';
    };

    const select = (id: string | null): void => {
      pinnedId = id;
      if (id) {
        revealRoutes();
        const r = routes.find((x) => x.props.id === id);
        if (r && exploring) {
          gsap.to(controls.target, { x: r.center.x, y: r.center.y, z: r.center.z, duration: 1.2, ease: 'power2.inOut', overwrite: true });
        }
      }
      applyActive();
    };

    panel.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.close')) select(null);
    });

    if (routeList) {
      for (const r of routes) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.id = r.props.id;
        button.innerHTML =
          `<span class="dot" style="background:${esc(r.props.color)}"></span>` +
          `<span class="name">${esc(r.props.name)}</span><span class="diff">${esc(r.props.difficulty)}</span>`;
        button.addEventListener('click', () => select(pinnedId === r.props.id ? null : r.props.id));
        li.append(button);
        routeList.append(li);
      }
    }

    const clearHover = (): void => {
      pointer = null;
      if (hoverId !== null) {
        hoverId = null;
        applyActive();
      }
    };

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.target !== canvas) {
        clearHover();
        return;
      }
      pointer = { x: e.clientX, y: e.clientY };
    });
    document.documentElement.addEventListener('pointerleave', clearHover);

    let down: { x: number; y: number } | null = null;
    window.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('click', (e) => {
      if (e.target !== canvas || !routesRevealed) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // era un arrastre de cámara
      const r = pick(e.clientX, e.clientY);
      select(r && r.props.id !== pinnedId ? r.props.id : null);
    });

    /* ── aparición de las rutas ── */
    function revealRoutes(): void {
      if (routesRevealed) return;
      routesRevealed = true;
      routes.forEach((r, i) => {
        const full = (): void => r.line.geometry.setDrawRange(0, Infinity);
        if (reduceMotion) {
          full();
          return;
        }
        const state = { t: 0 };
        gsap.to(state, {
          t: 1,
          duration: 2.4,
          delay: i * 0.35,
          ease: 'power2.inOut',
          onUpdate: () => r.line.geometry.setDrawRange(0, Math.floor(state.t * r.tubular) * r.indicesPerSegment),
          onComplete: full,
        });
      });
    }

    /* ── scroll: Lenis (suavizado) + ScrollTrigger (progreso) ── */
    const lenis = reduceMotion ? null : new Lenis();
    lenis?.on('scroll', ScrollTrigger.update);

    let targetProgress = 0;
    let smoothProgress = 0;
    ScrollTrigger.create({
      trigger: '#journey',
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        targetProgress = self.progress;
      },
    });
    ScrollTrigger.create({ trigger: '#chapter-rutas', start: 'top 70%', once: true, onEnter: revealRoutes });
    ScrollTrigger.create({
      trigger: '#explore',
      start: 'top 55%',
      onEnter: () => setExploring(true),
      onLeaveBack: () => setExploring(false),
    });

    // Cuando el contenido de texto tapa por completo el canvas, no hace falta renderizar
    let paused = false;
    ScrollTrigger.create({
      trigger: '#contenido',
      start: 'top top',
      end: 'max',
      onToggle: (self) => {
        paused = self.isActive;
      },
    });

    // Botones "Ver en el relieve 3D" de las fichas: solo aparecen si esa ruta tiene track dibujado
    document.querySelectorAll<HTMLButtonElement>('.see3d').forEach((button) => {
      const id = button.dataset.route ?? null;
      if (!id || !routes.some((r) => r.props.id === id)) return;
      button.hidden = false;
      button.addEventListener('click', () => {
        if (lenis) lenis.scrollTo('#explore');
        else document.getElementById('explore')?.scrollIntoView();
        window.setTimeout(() => select(id), reduceMotion ? 0 : 1200);
      });
    });

    function setExploring(value: boolean): void {
      exploring = value;
      controls.enabled = value && !coarsePointer;
      document.body.classList.toggle('exploring', value);
      if (value) {
        revealRoutes();
        controls.target.copy(lookTarget);
      } else {
        pinnedId = null;
        clearHover();
        applyActive();
      }
    }

    if (!reduceMotion) {
      gsap.utils.toArray<HTMLElement>('.card').forEach((card) => {
        gsap.from(card, {
          opacity: 0,
          y: 48,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: { trigger: card, start: 'top 85%', toggleActions: 'play none none reverse' },
        });
      });
    }

    /* ── bucle de render ── */
    const clock = new THREE.Clock();
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();

    const frame = (): void => {
      const dt = Math.min(clock.getDelta(), 0.1);
      if (paused) return;

      smoothProgress += (targetProgress - smoothProgress) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 3.5));
      applyEnvironment(smoothProgress);

      if (!exploring) {
        const follow = reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
        posCurve.getPoint(smoothProgress, desiredPos);
        lookCurve.getPoint(smoothProgress, desiredLook);
        camera.position.lerp(desiredPos, follow);
        lookTarget.lerp(desiredLook, follow);
        controls.target.copy(lookTarget);
        camera.lookAt(lookTarget);
      } else if (controls.enabled) {
        controls.update();
      } else {
        camera.lookAt(controls.target);
      }
      // La cámara nunca atraviesa el relieve
      camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 3);

      if (pointer && routesRevealed) {
        const r = pick(pointer.x, pointer.y);
        const id = r ? r.props.id : null;
        if (id !== hoverId) {
          hoverId = id;
          applyActive();
        } else if (id && pinnedId === null) {
          positionPanel();
        }
      }

      renderer.render(scene, camera);
    };

    gsap.ticker.add((time) => {
      lenis?.raf(time * 1000);
      frame();
    });
    gsap.ticker.lagSmoothing(0);

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      ScrollTrigger.refresh();
    });

    progress(1);
    applyEnvironment(0);
    ScrollTrigger.refresh();
    hideLoader();
  } catch (error) {
    console.error(error);
    if (loaderText) loaderText.textContent = 'No se pudo cargar el relieve. Recarga la página.';
    loaderBar?.classList.add('error');
  }
}

void main();
