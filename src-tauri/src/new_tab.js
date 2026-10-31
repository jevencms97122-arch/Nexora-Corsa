// Injecté dans tous les cadres du Garage. WebView2 ne signale pas à l'application les liens
// <a target="_blank"> cliqués dans un cadre, alors que window.open() lui parvient : on convertit donc
// ces clics (ainsi que Ctrl+clic et clic molette) en window.open(), que l'application transforme en onglet intégré.
(() => {
  if (window === window.top) return;
  const handler = (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const target = (link.getAttribute("target") || "").toLowerCase();
    const opensNewTab = target === "_blank" || target === "_new" || event.ctrlKey || event.metaKey || event.button === 1;
    if (!opensNewTab || !/^https?:/i.test(link.href)) return;
    event.preventDefault();
    event.stopPropagation();
    window.open(link.href, "_blank");
  };
  document.addEventListener("click", handler, true);
  document.addEventListener("auxclick", handler, true);
})();
