import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(reg => {
        console.log('[SW] Registered, scope:', reg.scope);
        // iOS aggressively HTTP-caches sw.js — force a check whenever the app
        // becomes visible so updates are picked up without a full cold launch.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(err => console.error('[SW] Registration failed:', err));
  });
}



// ─── Touch gesture handler ───────────────────────────────────────────────────
// Handles two behaviours in one unified listener set to avoid conflicts:
//
// 1. PINCH → font scale only (not viewport zoom).
//    viewport has user-scalable=no so the browser never zooms the layout.
//    We intercept the pinch and adjust --font-scale on <html> instead,
//    which scales only text (rem-based font sizes). Persisted to localStorage.
//    On first launch, html { font-size: 100% } inherits the Android system
//    font size as the 1rem baseline automatically.
//
// 2. PULL-TO-REFRESH → blocked in PWA standalone mode only.
(function () {
  const LS_KEY = 'rosterchirp_font_scale';
  const MIN_SCALE = 0.8;
  const MAX_SCALE = 2.0;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  // Restore saved font scale on launch
  const saved = parseFloat(localStorage.getItem(LS_KEY));
  let currentScale = (saved >= MIN_SCALE && saved <= MAX_SCALE) ? saved : 1.0;
  document.documentElement.style.setProperty('--font-scale', currentScale);

  let pinchStartDist = null;
  let pinchStartScale = currentScale;
  let singleStartY = 0;

  function getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  document.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      pinchStartDist = getTouchDist(e);
      pinchStartScale = currentScale;
    } else if (e.touches.length === 1) {
      singleStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && pinchStartDist !== null) {
      // Two-finger pinch: scale fonts, not viewport.
      // Skip when a lightbox is open — let the browser handle pinch natively there.
      if (document.documentElement.dataset.lightboxOpen) return;
      e.preventDefault();
      const ratio = getTouchDist(e) / pinchStartDist;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScale * ratio));
      currentScale = Math.round(newScale * 100) / 100;
      document.documentElement.style.setProperty('--font-scale', currentScale);
    } else if (e.touches.length === 1 && isStandalone) {
      // Single finger: block pull-to-refresh only when no scrollable ancestor
      // has scrolled content above the viewport.
      // Without this ancestor check, document.scrollTop is always 0 in this
      // flex layout, so the naive condition blocked ALL upward swipes (dy > 0),
      // making any scroll container impossible to scroll back up after reaching
      // the bottom — freezing the window.
      const dy = e.touches[0].clientY - singleStartY;
      if (dy > 0) {
        let el = e.target;
        let canScrollUp = false;
        while (el && el !== document.documentElement) {
          if (el.scrollTop > 0) { canScrollUp = true; break; }
          el = el.parentElement;
        }
        if (!canScrollUp) e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (e.touches.length < 2 && pinchStartDist !== null) {
      pinchStartDist = null;
      // Pinch zoom is session-only — do NOT persist to localStorage.
      // The saved (slider) scale is only written by ProfileModal.
    }
  }, { passive: true });
})();

// ─── iOS virtual keyboard layout fix ────────────────────────────────────────
// iOS Safari/PWA ignores `interactive-widget=resizes-content` and instead
// scrolls the page when the keyboard opens, causing two bugs:
//   1. The chat header scrolls off-screen ("NO MESSAGE TITLE")
//   2. env(safe-area-inset-bottom) stays at ~34px, adding extra padding below input
//
// Fix: track the Visual Viewport height and expose it as --visual-viewport-height
// so .chat-layout always fills exactly the visible area above the keyboard.
// Also toggle a `keyboard-open` class so CSS can remove the safe-area padding
// from the message input (the keyboard covers the home indicator area anyway).
if (window.visualViewport) {
  const onViewportChange = () => {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty('--visual-viewport-height', `${vv.height}px`);
    // Expose the visual viewport's vertical offset so .chat-layout can stay
    // pinned to the visible area even when iOS scrolls the page on keyboard open.
    document.documentElement.style.setProperty('--visual-viewport-offset', `${vv.offsetTop}px`);
    // window.innerHeight doesn't shrink on iOS when keyboard opens — the gap IS the keyboard.
    const keyboardVisible = (window.innerHeight - vv.height) > 150;
    document.documentElement.classList.toggle('keyboard-open', keyboardVisible);
  };
  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
  onViewportChange(); // set immediately so first render uses the correct height
}

// Clear badge count when user focuses the app
window.addEventListener('focus', () => {
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_BADGE' });
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
