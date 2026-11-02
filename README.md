# Horcadas · web inmersiva

Web del pueblo de **Horcadas** (comarca de Riaño, León): relieve 3D de la montaña, rutas dibujadas sobre el terreno con información al pasar el cursor, y scroll cinematográfico con la cámara recorriendo el valle.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | [Astro](https://astro.build) (HTML estático + una isla de JS) |
| 3D | [Three.js](https://threejs.org) (terreno por heightmap, rutas como tubos, raycaster para el hover) |
| Scroll cinematográfico | [GSAP](https://gsap.com) ScrollTrigger + [Lenis](https://lenis.darkroom.engineering) |
| Datos | MDT y ortofoto PNOA del CNIG/IGN; rutas en GPX |

## Arrancar

```bash
npm install
npm run data:placeholder   # relieve y rutas de ejemplo (solo la primera vez)
npm run dev                # http://localhost:4321
npm run build              # genera dist/ (estático, listo para Cloudflare Pages / Vercel / Netlify)
```

Requiere Node 20 o superior. Tras el primer `npm install`, **commitea `package-lock.json`** (las dependencias están en `latest` hasta que se fije esa versión).

## Estructura

```
src/pages/index.astro        contenido HTML (portada, capítulos, panel de rutas)
src/scripts/scene.ts         escena 3D, rutas, hover, cámara y scroll
src/styles/global.css        estilos
public/data/                 heightmap.bin, meta.json, routes.json (se sirven tal cual)
scripts/                     pipeline de datos (Node, sin dependencias)
docs/datos.md                cómo pasar de los datos del CNIG y tus GPX a public/data
```

## Cómo funciona

- **Terreno:** `heightmap.bin` (alturas en metros, Float32) desplaza una malla `PlaneGeometry`. Con `ortho` en `meta.json` se texturiza con la ortofoto (`npm run data:ortho`). Sin ella, `src/scripts/terrain-texture.ts` genera una textura procedural de 2048 px (1024 en móvil): vegetación por cota, roca por pendiente, ruido en tres escalas, sombreado y curvas de nivel cada 25 m.
- **Rutas:** `routes.json` guarda cada ruta en coordenadas normalizadas del terreno. Se muestrea la altura en cada punto y se dibuja un tubo sobre el relieve. Un segundo tubo invisible y más grueso hace de zona de hover para el `Raycaster`.
- **Hover / clic / tap:** al pasar el cursor se resalta la ruta y aparece un panel con distancia, desnivel, cota máxima, tiempo estimado y perfil de elevación (calculados desde la geometría y el MDT). Un clic o tap la fija. Hay además una lista HTML de rutas, utilizable con teclado.
- **Cámara:** la posición y el punto de mira siguen dos curvas `CatmullRomCurve3` según el progreso del scroll; el ambiente (niebla, luz del sol) cambia de amanecer a atardecer. Al llegar a "Explora el relieve" se activa `OrbitControls` (solo en dispositivos con puntero preciso).
- **Accesibilidad / rendimiento:** respeta `prefers-reduced-motion`, reduce malla y sombras en móvil y degrada a página de texto si no hay WebGL. El contenido importante está en HTML real, no dentro del canvas.

## Contenido editable

Todo el texto de las secciones sale de ficheros JSON en `src/data/`; el HTML se genera en `src/lib/render.mjs`.

| Fichero | Qué contiene |
|---|---|
| `rutas.json` | Catálogo de rutas: datos, puntos de interés, avisos y fuentes de cada una |
| `anuncios.json` | Tablón de anuncios: `fecha`, `categoria`, `titulo`, `texto`, `contacto`, `caduca` (AAAA-MM-DD) y `ejemplo` |
| `enlaces.json` | Enlaces agrupados, con una nota breve por enlace |
| `seguridad.json` | Consejos, normas del Parque Regional y teléfonos |

- Los anuncios caducados se ocultan solos en el navegador a partir de `caduca`. Quita `"ejemplo": true` de los anuncios reales.
- Una ficha de `rutas.json` muestra el botón **Ver en el relieve 3D** cuando existe un track con el mismo `id` en `public/data/routes.json`. Para dibujar `puerto-de-horcadas` o `collado-el-baile`, graba el GPX tú mismo (o confirma la licencia del de Terranostrum) y ejecuta `npm run data:routes -- rutas/puerto-de-horcadas.gpx`: el `id` sale del nombre del fichero.
- Las distancias y tiempos de `rutas.json` proceden de las fuentes citadas en cada ficha. Revísalos con tu propio track antes de darlos por definitivos.
- **Vista previa sin `npm install`:** `npm run preview:build` crea `preview/` con una versión que carga las librerías desde CDN (Node 22.13+).

## Estado

- [x] Esqueleto, escena de terreno, rutas con hover, panel, scroll con cámara
- [x] Pipeline de datos (MDT → heightmap, GPX → rutas) probado con datos sintéticos
- [x] Catálogo de rutas con fuentes, tablón de anuncios, enlaces y sección de seguridad
- [ ] Tracks reales dibujados en 3D (necesitan GPX propio o con licencia clara)
- [ ] Canal para que los vecinos publiquen anuncios (formulario, correo o CMS)
- [ ] **Pendiente de verificar visualmente en navegador** (el código está comprobado a nivel de sintaxis, pero aún no se ha compilado ni renderizado)
- [ ] Datos reales de Horcadas (MDT + ortofoto + tus GPX)
- [ ] Contenido real (historia, tradiciones, fiestas) y fotos
- [ ] Postprocesado (bloom, profundidad de campo), texturas KTX2, LOD
- [ ] CMS sencillo para que otros vecinos puedan actualizar la web
