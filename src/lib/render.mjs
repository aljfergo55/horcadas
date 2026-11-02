// Renderizado del HTML de la página. Lo usan Astro (src/pages/index.astro) y la
// vista previa (scripts/make-preview.mjs), de modo que el contenido tiene una única fuente.
// Funciones puras: reciben datos JSON y devuelven strings. Todo el texto se escapa.

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const safeUrl = (url) => (/^https?:\/\//i.test(url) ? url : '#');
const link = (url, text) =>
  `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
const num = (n) => String(n).replace('.', ',');

const DIFFICULTY_CLASS = { Fácil: 'facil', Media: 'media', Difícil: 'dificil' };

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/* ───────────── rutas ───────────── */

export function renderRouteCards(rutas) {
  return rutas
    .map((r) => {
      const stats = [
        ['Tipo', r.tipo],
        ['Distancia', r.distanciaKm != null ? `${num(r.distanciaKm)} km` : null],
        ['Desnivel', r.desnivelM != null ? `≈ ${r.desnivelM} m` : null],
        ['Duración', r.duracion],
        ['Salida', r.salida],
        ['Época', r.epoca],
      ].filter(([, value]) => value);

      const points = r.puntos?.length
        ? `<ul class="points">${r.puntos.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
        : '';
      const sources = r.fuentes?.length
        ? `<p class="src">Fuentes: ${r.fuentes.map((f) => link(f.url, f.titulo)).join(' · ')}</p>`
        : '';
      return (
        `<article class="route-card" data-route-id="${esc(r.id)}">` +
        `<header>` +
        `<div><p class="eyebrow">${esc(r.codigo ?? 'Sin código oficial')}</p><h3>${esc(r.nombre)}</h3></div>` +
        `<span class="chip dif-${DIFFICULTY_CLASS[r.dificultad] ?? 'media'}">${esc(r.dificultad)}</span>` +
        `</header>` +
        `<dl class="mini">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` +
        `<p>${esc(r.resumen)}</p>` +
        points +
        (r.aviso ? `<p class="warn">${esc(r.aviso)}</p>` : '') +
        (r.gpx ? `<p class="gpx-note">${esc(r.gpx)}</p>` : '') +
        sources +
        `<button class="see3d" type="button" data-route="${esc(r.id)}" hidden>Ver en el relieve 3D</button>` +
        `</article>`
      );
    })
    .join('');
}

/* ───────────── tablón de anuncios ───────────── */

export function renderNotices(anuncios) {
  const order = ['Aviso', 'Eventos', 'Compraventa', 'Servicios'];
  const categories = [...new Set(anuncios.map((a) => a.categoria))].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
  const sorted = [...anuncios].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const filters =
    `<div class="filters" role="group" aria-label="Filtrar anuncios por categoría">` +
    `<button type="button" data-filter="all" aria-pressed="true">Todos</button>` +
    categories.map((c) => `<button type="button" data-filter="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('') +
    `</div>`;

  const items = sorted
    .map(
      (a) =>
        `<article class="notice" data-cat="${esc(a.categoria)}"${a.caduca ? ` data-expires="${esc(a.caduca)}"` : ''}>` +
        `<header><p class="eyebrow">${esc(a.categoria)}</p>` +
        (a.ejemplo ? `<span class="chip example">Ejemplo</span>` : '') +
        `</header>` +
        `<h3>${esc(a.titulo)}</h3>` +
        `<p>${esc(a.texto)}</p>` +
        `<p class="meta"><time datetime="${esc(a.fecha)}">${esc(formatDate(a.fecha))}</time>` +
        (a.contacto ? ` · ${esc(a.contacto)}` : '') +
        `</p></article>`,
    )
    .join('');

  return (
    filters +
    `<div class="notices">${items}</div>` +
    `<p class="empty" hidden>No hay anuncios vigentes en esta categoría.</p>`
  );
}

/* ───────────── enlaces ───────────── */

export function renderLinks(grupos) {
  return grupos
    .map(
      (g) =>
        `<div class="link-group"><h3>${esc(g.grupo)}</h3><ul>` +
        g.items
          .map((i) => `<li>${link(i.url, i.titulo)}${i.nota ? `<span>${esc(i.nota)}</span>` : ''}</li>`)
          .join('') +
        `</ul></div>`,
    )
    .join('');
}

/* ───────────── seguridad ───────────── */

export function renderSafety(s) {
  const list = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return (
    `<div class="safety">` +
    `<div><h3>Antes de salir</h3>${list(s.consejos)}</div>` +
    `<div><h3>Normas del Parque Regional</h3>${list(s.normasParque)}` +
    `<p class="src">Fuente: ${link(s.fuente.url, s.fuente.titulo)}</p></div>` +
    `<div class="emergency"><h3>Emergencias</h3>` +
    `<p class="big">${esc(s.emergencias)}</p>` +
    `<p>${esc(s.contacto.nombre)}: ${esc(s.contacto.telefono)}</p>` +
    `<p class="src">${esc(s.contacto.nota)}</p></div>` +
    `</div>`
  );
}

/* ───────────── página completa ───────────── */

export function renderBody({ rutas, enlaces, anuncios, seguridad }) {
  return `
<div id="loader" role="status" aria-live="polite">
  <p class="loader-title">Horcadas</p>
  <p id="loader-text">Cargando el relieve…</p>
  <div class="loader-track"><div id="loader-bar"></div></div>
</div>

<canvas id="scene" aria-hidden="true"></canvas>

<main>
  <div id="journey">
    <section class="chapter hero" id="inicio">
      <div class="card">
        <p class="eyebrow">Comarca de Riaño · León</p>
        <h1>Horcadas</h1>
        <p>Un pueblo de montaña. Desliza para recorrer su valle.</p>
        <p class="scroll-cue" aria-hidden="true">↓</p>
      </div>
    </section>

    <section class="chapter right" id="chapter-historia">
      <div class="card">
        <p class="eyebrow">Historia</p>
        <h2>Orígenes y memoria</h2>
        <p>Texto provisional. Aquí irá la historia de Horcadas: orígenes, hitos y personajes. Contenido pendiente de redactar.</p>
      </div>
    </section>

    <section class="chapter" id="chapter-tradiciones">
      <div class="card">
        <p class="eyebrow">Tradiciones</p>
        <h2>Fiestas y costumbres</h2>
        <p>Texto provisional. Aquí irán las fiestas, costumbres y oficios del pueblo. Contenido pendiente de redactar.</p>
      </div>
    </section>

    <section class="chapter right" id="chapter-rutas">
      <div class="card">
        <p class="eyebrow">Rutas</p>
        <h2>Caminos sobre el relieve</h2>
        <p>Las rutas se dibujan sobre el relieve. Al final del recorrido podrás explorarlo y pasar el cursor por cada una para ver su distancia, desnivel y perfil.</p>
      </div>
    </section>
  </div>

  <section class="chapter explore" id="explore">
    <div class="explore-ui">
      <div class="card">
        <p class="eyebrow">Explora</p>
        <h2>El relieve en 3D</h2>
        <p class="hint">Arrastra para girar la vista · Pasa el cursor sobre una ruta (en móvil, toca) o elígela aquí:</p>
        <ul id="route-list" class="route-list"></ul>
        <p id="placeholder-note" class="note" hidden>
          Relieve y rutas de ejemplo (datos sintéticos). Se sustituirán por el modelo digital del terreno y los tracks reales.
        </p>
      </div>
    </div>
  </section>

  <div class="content" id="contenido">
    <nav class="jump" aria-label="Secciones">
      <a href="#rutas">Rutas</a>
      <a href="#tablon">Tablón de anuncios</a>
      <a href="#seguridad">Seguridad y normas</a>
      <a href="#enlaces">Enlaces</a>
    </nav>

    <section id="rutas" class="block">
      <h2>Rutas de la zona</h2>
      <p class="lead">Rutas que salen de Horcadas o pasan por el pueblo, con los datos publicados por las fuentes que se citan en cada ficha.</p>
      <div class="route-cards">${renderRouteCards(rutas)}</div>
    </section>

    <section id="tablon" class="block">
      <h2>Tablón de anuncios</h2>
      <p class="lead">Avisos, eventos y pequeños anuncios entre vecinos. Los marcados como ejemplo son provisionales.</p>
      <div class="board">${renderNotices(anuncios)}</div>
      <p class="note">Cómo publicar un anuncio: pendiente de definir (correo del pueblo o formulario). Mientras tanto se añaden a mano.</p>
    </section>

    <section id="seguridad" class="block">
      <h2>Seguridad y normas</h2>
      ${renderSafety(seguridad)}
    </section>

    <section id="enlaces" class="block">
      <h2>Enlaces</h2>
      <div class="links">${renderLinks(enlaces)}</div>
    </section>

    <footer class="foot">
      <p>Horcadas · Comarca de Riaño, León. Web en construcción.</p>
      <p>Relieve y ortofotos: © Instituto Geográfico Nacional de España (CC BY 4.0), cuando se incorporen los datos reales.</p>
    </footer>
  </div>
</main>

<aside id="route-panel" aria-live="polite"></aside>
`;
}
