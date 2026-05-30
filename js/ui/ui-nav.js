// makeNavRenderer(cfg) — factory for paginated-plot navigation bars.
// cfg: { navId, prevId, nextId, note(k), getKAll(), getPage(), setPage(n), redraw(page) }
export function makeNavRenderer(cfg) {
  return function renderNav(totalPages) {
    const nav = document.getElementById(cfg.navId);
    if (!nav) return;
    if (totalPages <= 1) { nav.innerHTML = ""; return; }

    const page = cfg.getPage();
    nav.innerHTML =
      `<button id="${cfg.prevId}" ${page === 0 ? "disabled" : ""}>&#8249; Prev</button>` +
      `<span>Page ${page + 1} of ${totalPages}</span>` +
      `<button id="${cfg.nextId}" ${page >= totalPages - 1 ? "disabled" : ""}>Next &#8250;</button>` +
      `<span class="forest-nav-note">${cfg.note(cfg.getKAll())}</span>`;

    document.getElementById(cfg.prevId)?.addEventListener("click", () => {
      if (cfg.getPage() > 0) {
        cfg.setPage(cfg.getPage() - 1);
        const { totalPages: tp } = cfg.redraw(cfg.getPage());
        renderNav(tp);
      }
    });

    document.getElementById(cfg.nextId)?.addEventListener("click", () => {
      if (cfg.getPage() < totalPages - 1) {
        cfg.setPage(cfg.getPage() + 1);
        const { totalPages: tp } = cfg.redraw(cfg.getPage());
        renderNav(tp);
      }
    });
  };
}
