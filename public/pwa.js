/* ============================================================
   pwa.js — PWA install prompt (shared across all pages)
   ============================================================ */
(() => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Install button logic
  let deferredPrompt = null;
  const btn = document.getElementById('pwa-install-btn');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
  });

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
      deferredPrompt = null;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (btn) btn.hidden = true;
    deferredPrompt = null;
  });
})();
