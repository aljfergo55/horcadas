// Tablón de anuncios: oculta los caducados y filtra por categoría.
// El HTML llega ya renderizado (src/lib/render.mjs); aquí solo hay comportamiento.

const board = document.querySelector<HTMLElement>('.board');

if (board) {
  const notices = Array.from(board.querySelectorAll<HTMLElement>('.notice'));
  const buttons = Array.from(board.querySelectorAll<HTMLButtonElement>('[data-filter]'));
  const empty = board.querySelector<HTMLElement>('.empty');

  // Fecha local en formato AAAA-MM-DD (comparable como texto con data-expires)
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  let current = 'all';

  const apply = (): void => {
    let visible = 0;
    for (const n of notices) {
      const expired = Boolean(n.dataset.expires) && (n.dataset.expires as string) < today;
      const hidden = expired || (current !== 'all' && n.dataset.cat !== current);
      n.hidden = hidden;
      if (!hidden) visible++;
    }
    if (empty) empty.hidden = visible > 0;
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      current = button.dataset.filter ?? 'all';
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      apply();
    });
  }
  apply();
}
