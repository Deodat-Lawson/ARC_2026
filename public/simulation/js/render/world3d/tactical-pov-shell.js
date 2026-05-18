/**
 * Shared tactical POV shell: multi-feed registry (`povs`), fleet agent selector UI, mission-target helpers.
 * Presets (Urban, Industrial, …) push render entries onto `povs` and call `buildAgentSelector`.
 *
 * @module tactical-pov-shell
 */
import { simBridge } from "../../sim/bridge.js";

/** FP agent strip DOM — filled by app via `bindWorld3dUi()`. */
export const ui3d = {
  agentSelectorHost: null,
  agentCardEls: null,
  povSubEl: null,
  DEFAULT_POV_AGENTS: ["Drone-1"],
};

export function bindWorld3dUi(partial) {
  Object.assign(ui3d, partial);
}

/** Live POV columns — Urban FPV, Industrial GLB feeds, etc. */
export const povs = [];

function agentIcon(type) {
  const wrap = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  if (type === "drone") {
    return wrap(`
      <circle cx="6" cy="6" r="2.6"/>
      <circle cx="18" cy="6" r="2.6"/>
      <circle cx="6" cy="18" r="2.6"/>
      <circle cx="18" cy="18" r="2.6"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
      <line x1="18" y1="6" x2="6" y2="18"/>
      <circle cx="12" cy="12" r="2.4" fill="currentColor"/>
    `);
  }

  if (type === "balloon") {
    return wrap(`
      <ellipse cx="12" cy="9" rx="5.5" ry="6"/>
      <path d="M12 9 m-5.5 0 a5.5 4 0 0 0 11 0" fill="currentColor" fill-opacity="0.18" stroke="none"/>
      <line x1="9" y1="14.5" x2="10.5" y2="17"/>
      <line x1="15" y1="14.5" x2="13.5" y2="17"/>
      <rect x="9.5" y="17" width="5" height="3" rx="0.5"/>
      <circle cx="12" cy="9" r="1.4" fill="currentColor"/>
    `);
  }

  if (type === "ground_rescue") {
    return wrap(`
      <rect x="4" y="11" width="16" height="8" rx="1.5"/>
      <rect x="2.5" y="13" width="2" height="4" rx="0.6" fill="currentColor"/>
      <rect x="19.5" y="13" width="2" height="4" rx="0.6" fill="currentColor"/>
      <path d="M11 4 L13 4 L13 6 L15 6 L15 8 L13 8 L13 10 L11 10 L11 8 L9 8 L9 6 L11 6 Z" fill="currentColor" stroke="none"/>
    `);
  }

  if (type === "ground_clear") {
    return wrap(`
      <rect x="7" y="10" width="13" height="8" rx="1.2"/>
      <rect x="6" y="12" width="2" height="4" rx="0.6" fill="currentColor"/>
      <rect x="19.5" y="12" width="2" height="4" rx="0.6" fill="currentColor"/>
      <path d="M3 8 L3 20" stroke-width="2.4"/>
      <path d="M3 8 L7 11" />
      <path d="M3 20 L7 17" />
      <rect x="11" y="6" width="6" height="4" rx="0.6"/>
    `);
  }

  if (type === "ground_armored") {
    return wrap(`
      <path d="M3 13 L6 9 L18 9 L21 13 L21 17 L18 21 L6 21 L3 17 Z"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
      <line x1="3" y1="17" x2="21" y2="17"/>
      <rect x="10" y="4" width="4" height="5" rx="0.5"/>
      <circle cx="12" cy="6.5" r="0.9" fill="currentColor"/>
      <circle cx="8" cy="15" r="0.9" fill="currentColor"/>
      <circle cx="16" cy="15" r="0.9" fill="currentColor"/>
    `);
  }

  return wrap(`
    <rect x="4" y="9" width="16" height="9" rx="1.5"/>
    <rect x="2.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <rect x="19.5" y="11" width="2" height="5" rx="0.8" fill="currentColor"/>
    <circle cx="12" cy="13.5" r="1.4" fill="currentColor"/>
  `);
}

export function teardownAgentSelector() {
  document.removeEventListener("keydown", handleGlobalSelectorKey);
}

export function buildAgentSelector(agents) {
  teardownAgentSelector();
  if (!ui3d.agentSelectorHost || !ui3d.agentCardEls) return;
  ui3d.agentSelectorHost.innerHTML = "";
  ui3d.agentCardEls.clear();
  agents.forEach((a, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "agent-card";
    card.dataset.agentId = a.id;
    card.dataset.kind = a.type;
    card.setAttribute("role", "tab");
    card.setAttribute("aria-controls", "povCanvas");
    card.setAttribute("aria-selected", "false");
    card.setAttribute("aria-label", `View ${a.id} first-person feed`);
    card.title = `${a.id} — ${a.role}. Press ${idx + 1} to select.`;
    card.tabIndex = idx === 0 ? 0 : -1;
    card.innerHTML = `
      <div class="agent-card-head">
        <span class="agent-icon">${agentIcon(a.type)}</span>
        <span class="agent-id">${a.id}</span>
      </div>
      <span class="agent-role">${a.role.replace("_", " ")}</span>
      <div class="agent-card-body">
        <span class="agent-task" data-task>idle</span>
        <div class="agent-battery">
          <div class="bar" style="--value: ${a.battery}%"><i></i></div>
          <span class="agent-battery-pct" data-battery-pct>${Math.round(a.battery)}%</span>
        </div>
      </div>
      <div class="agent-card-foot">
        <span></span>
        <kbd>${idx + 1}</kbd>
      </div>
    `;
    card.addEventListener("click", () => selectAgent(a.id));
    card.addEventListener("keydown", handleSelectorKey);
    ui3d.agentSelectorHost.appendChild(card);
    ui3d.agentCardEls.set(a.id, card);
  });

  document.addEventListener("keydown", handleGlobalSelectorKey);

  const firstId = ui3d.DEFAULT_POV_AGENTS[0] || agents[0]?.id;
  if (firstId) selectAgent(firstId);
}

function selectAgent(id) {
  const entry = povs[0];
  if (!entry) return;
  entry.selectedId = id;
  if (entry.hud.heading) entry.hud.heading.textContent = `FPV · ${id}`;
  for (const [aid, el] of ui3d.agentCardEls) {
    const active = aid === id;
    el.setAttribute("aria-selected", active ? "true" : "false");
    el.tabIndex = active ? 0 : -1;
    if (active) el.focus({ preventScroll: true });
  }
  if (ui3d.povSubEl && simBridge.state) {
    const ag = simBridge.state.agents.find((a) => a.id === id);
    if (ag) ui3d.povSubEl.textContent = `${ag.role.replace("_", " ")} · battery ${Math.round(ag.battery)}%`;
  }
}

function cycleSelection(direction) {
  const entry = povs[0];
  if (!entry || !ui3d.agentCardEls || ui3d.agentCardEls.size === 0) return;
  const order = Array.from(ui3d.agentCardEls.keys());
  const cur = order.indexOf(entry.selectedId);
  const next = order[(cur + direction + order.length) % order.length];
  selectAgent(next);
}

function handleSelectorKey(e) {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    cycleSelection(1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    cycleSelection(-1);
  } else if (e.key === "Home") {
    e.preventDefault();
    const first = Array.from(ui3d.agentCardEls.keys())[0];
    if (first) selectAgent(first);
  } else if (e.key === "End") {
    e.preventDefault();
    const keys = Array.from(ui3d.agentCardEls.keys());
    if (keys.length) selectAgent(keys[keys.length - 1]);
  }
}

function handleGlobalSelectorKey(e) {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!ui3d.agentCardEls) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= ui3d.agentCardEls.size) {
    const id = Array.from(ui3d.agentCardEls.keys())[n - 1];
    if (id) {
      e.preventDefault();
      selectAgent(id);
    }
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const active = document.activeElement;
    if (!active || !active.classList || !active.classList.contains("agent-card")) {
      e.preventDefault();
      cycleSelection(e.key === "ArrowRight" ? 1 : -1);
    }
  }
}

/** Grid cell `[x,y]` for mission-plan target, if resolvable. */
export function currentTargetFor(agent, state, plan) {
  if (!plan || !plan.mission_plan) return null;
  const action = plan.mission_plan.find((m) => m.agent === agent.id);
  if (!action) return null;
  if (!action.target) return null;
  if (action.target.startsWith("V")) {
    const v = state.victims.find((vv) => vv.id === action.target);
    return v ? v.location : null;
  }
  if (action.target.startsWith("K")) {
    const b = state.map.blocked_cells.find((bb) => bb.id === action.target);
    return b ? b.location : null;
  }
  if (action.target === "Relay-R1") return [14, 7];
  return null;
}

export function currentTargetIdFor(agent, plan) {
  if (!plan || !plan.mission_plan) return null;
  const action = plan.mission_plan.find((m) => m.agent === agent.id);
  return action ? action.target : null;
}
