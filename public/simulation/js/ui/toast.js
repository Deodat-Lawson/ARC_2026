import { simBridge } from "../sim/bridge.js";

export const TOAST_CFG = {
  rescued: { icon: "✅", color: "#5dffb4", bg: "rgba(14,60,30,0.92)" },
  victim_dead: { icon: "💔", color: "#ff5d6c", bg: "rgba(60,10,20,0.92)" },
  blockade_cleared: { icon: "🚧", color: "#ffd95d", bg: "rgba(60,50,0,0.9)" },
  relay_deployed: { icon: "📡", color: "#c8b4ff", bg: "rgba(40,20,80,0.9)" },
  default: { icon: "ℹ️", color: "#82c8ff", bg: "rgba(14,16,20,0.92)" },
};

const MAX_EVENT_LOG = 20;

export function emitToast(type, description) {
  const cfg = TOAST_CFG[type] || TOAST_CFG.default;
  const layer = document.getElementById("toastLayer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.style.background = cfg.bg;
  el.style.borderLeftColor = cfg.color;
  el.style.color = cfg.color;
  el.textContent = `${cfg.icon} ${description}`;
  layer.appendChild(el);
  el.animate(
    [
      { opacity: 0, transform: "translateX(20px)" },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: 280, fill: "forwards" },
  );
  setTimeout(() => {
    const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, fill: "forwards" });
    fade.onfinish = () => el.remove();
  }, 2600);
  pushEventLog(type, description);
}

export function pushEventLog(type, description) {
  const log = document.getElementById("eventLog");
  if (!log) return;
  const cfg = TOAST_CFG[type] || TOAST_CFG.default;
  const row = document.createElement("div");
  row.className = "event-row";
  row.style.borderLeftColor = cfg.color;
  row.style.color = cfg.color;
  const t = simBridge.state ? simBridge.state.timestep : 0;
  row.textContent = `${cfg.icon} [T${String(t).padStart(3, "0")}] ${description}`;
  log.prepend(row);
  while (log.children.length > MAX_EVENT_LOG) log.lastChild.remove();
}
