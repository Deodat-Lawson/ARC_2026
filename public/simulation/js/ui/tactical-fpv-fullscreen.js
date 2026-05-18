/**
 * Fullscreen toggle for the tactical FPV column (`.map-pov-col`) — all scene presets.
 */

const FS_ICON_EXPAND = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10V4h6M14 4h6v6M20 14v6h-6M10 20H4v-6"/></svg>`;
const FS_ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v6H4M14 4v6h6M14 20v-6h6M10 20v-6H4"/></svg>`;

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function requestFullscreenEl(el) {
  const req =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.webkitEnterFullscreen ||
    el.msRequestFullscreen;
  if (!req) return Promise.reject(new Error("Fullscreen not supported"));
  return Promise.resolve(req.call(el));
}

function exitFullscreenDoc() {
  const d = document;
  const exit =
    d.exitFullscreen ||
    d.webkitExitFullscreen ||
    d.webkitCancelFullScreen ||
    d.msExitFullscreen;
  if (!exit) return Promise.reject(new Error("Exit fullscreen not supported"));
  return Promise.resolve(exit.call(d));
}

export function wireTacticalFpvFullscreen() {
  const btn = document.getElementById("tacticalFpvFullscreenBtn");
  const col = document.querySelector(".map-pov-col");
  if (!btn || !col) return;

  const sync = () => {
    const on = getFullscreenElement() === col;
    btn.innerHTML = on ? FS_ICON_COLLAPSE : FS_ICON_EXPAND;
    btn.title = on ? "Exit full screen (Esc)" : "Full screen";
    btn.setAttribute("aria-label", on ? "Exit full screen" : "Open tactical FPV full screen");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };

  btn.addEventListener("click", () => {
    const on = getFullscreenElement() === col;
    const p = on ? exitFullscreenDoc() : requestFullscreenEl(col);
    p.catch((err) => console.warn("[tactical FPV] fullscreen", err));
  });

  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  document.addEventListener("mozfullscreenchange", sync);
  document.addEventListener("MSFullscreenChange", sync);
  sync();
}

export function exitTacticalFpvFullscreenIfActive() {
  const col = document.querySelector(".map-pov-col");
  if (!col) return;
  if (getFullscreenElement() === col) {
    void exitFullscreenDoc().catch(() => {});
  }
}
