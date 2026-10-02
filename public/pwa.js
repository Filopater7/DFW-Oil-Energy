/* ============================================================
   pwa.js — PWA install prompt (shared across all pages)
   ============================================================ */

// Capture the event as early as possible — before any script runs
// Store it on window so pwa.js can access it whenever it loads
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window._pwaPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.hidden = false;
});

window.addEventListener('appinstalled', () => {
  window._pwaPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.hidden = true;
  localStorage.setItem('pwa-installed', '1');
});

(() => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Hide button if already installed as PWA
  if (window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      localStorage.getItem('pwa-installed') === '1') {
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.hidden = true;
    return;
  }

  const btn = document.getElementById('pwa-install-btn');
  if (!btn) return;

  // Always show the button
  btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (window._pwaPrompt) {
      // Browser supports native install prompt — use it
      try {
        window._pwaPrompt.prompt();
        const { outcome } = await window._pwaPrompt.userChoice;
        if (outcome === 'accepted') {
          btn.hidden = true;
          localStorage.setItem('pwa-installed', '1');
        }
        window._pwaPrompt = null;
      } catch (err) {
        showInstallGuide();
      }
    } else {
      // Fallback: show manual install instructions
      showInstallGuide();
    }
  });

  function showInstallGuide() {
    const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isAndroid = /android/i.test(navigator.userAgent);
    const isSafari  = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    let msg = '';
    if (isIOS && isSafari) {
      msg = 'To install:\n1. Tap the Share button (□↑) at the bottom\n2. Tap "Add to Home Screen"\n3. Tap "Add"';
    } else if (isIOS) {
      msg = 'To install on iPhone:\nOpen this page in Safari, then tap Share → Add to Home Screen.';
    } else if (isAndroid) {
      msg = 'To install:\nTap the menu (⋮) in your browser, then tap "Add to Home screen" or "Install app".';
    } else {
      msg = 'To install on desktop:\nLook for the install icon (⊕) in your browser address bar, or go to browser menu → "Install Payless Fuel App".';
    }
    alert(msg);
  }
})();
