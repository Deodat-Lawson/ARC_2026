import { $ } from "../config/presets.js";

const TOUR_KEY = "arc-sim-tour-v1";
const TOUR_STEPS = [
  {
    selector: ".cc-top-c",
    title: "Mission status",
    body: "Live T+ clock, rescued / total, agents online, survival rate. Watch SURVIVAL drop — that's your scoreboard.",
  },
  {
    selector: ".vp-2d .canvas-frame",
    title: "Tactical map",
    body: "Top-down view of the disaster zone. Red pulse = victim. Yellow box = base. Orange = blockade. Translucent zones = fire / collapse.",
  },
  {
    selector: ".vp-3d",
    title: "FPV feed",
    body: "First-person from the active agent. Press 1–4 to switch, or arrow keys to cycle.",
  },
  {
    selector: ".cc-rail-r .rail-section:nth-of-type(1)",
    title: "Threat board",
    body: "Gemma-4 re-ranks every victim each tick by survival window × signal strength × access cost. The top of this list is your next move.",
  },
  {
    selector: ".cc-rail-r .rail-section:nth-of-type(2)",
    title: "Fleet status",
    body: "Battery and current task per agent. Yellow text = actively assigned.",
  },
  {
    selector: ".vp-brief",
    title: "Commander brief",
    body: "Plain-language explanation of why the planner chose what it chose.",
  },
  {
    selector: "#cfgRail",
    title: "Scenario config",
    body: "Tune the disaster: presets, fleet counts, hazards, comms. Hit Apply & Reset to rebuild the scene.",
  },
  {
    selector: ".cc-top-r .cc-controls",
    title: "Transport",
    body: "Space = play/pause, period = step, R = reset. Use the speed selector to scrub fast through long missions.",
  },
];

const tourState = {
  index: 0,
  active: false,
  phase: null,
  resizeHandler: null,
  keyHandler: null,
};

function startTourSteps() {
  const root = $("tourRoot");
  if (!root) return;
  const welcomeEl = root.querySelector('[data-tour-phase="welcome"]');
  const stepEl = root.querySelector('[data-tour-phase="step"]');
  if (welcomeEl) welcomeEl.hidden = true;
  if (stepEl) stepEl.hidden = false;
  tourState.phase = "step";
  tourState.index = 0;

  if (!tourState.resizeHandler) {
    tourState.resizeHandler = () => {
      if (tourState.active && tourState.phase === "step") renderTourStep();
    };
    window.addEventListener("resize", tourState.resizeHandler);
  }
  renderTourStep();
}

function tourNext() {
  tourState.index += 1;
  if (tourState.index >= TOUR_STEPS.length) {
    endTour();
    return;
  }
  renderTourStep();
}

function tourBack() {
  if (tourState.index <= 0) return;
  tourState.index -= 1;
  renderTourStep();
}

function endTour() {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  tourState.active = false;
  tourState.phase = null;
  if (tourState.keyHandler) {
    window.removeEventListener("keydown", tourState.keyHandler, true);
    tourState.keyHandler = null;
  }
  if (tourState.resizeHandler) {
    window.removeEventListener("resize", tourState.resizeHandler);
    tourState.resizeHandler = null;
  }
  try {
    window.localStorage.setItem(TOUR_KEY, "done");
  } catch {
    /* ignore */
  }
}

function renderTourStep() {
  const step = TOUR_STEPS[tourState.index];
  if (!step) return;

  const target = document.querySelector(step.selector);
  if (!target) {
    tourState.index = Math.min(TOUR_STEPS.length - 1, tourState.index + 1);
    renderTourStep();
    return;
  }

  if (step.selector === "#cfgRail") {
    const grid = $("ccGrid");
    if (grid && grid.classList.contains("cfg-collapsed")) grid.classList.remove("cfg-collapsed");
  }

  const rect = target.getBoundingClientRect();
  const pad = 8;
  const x = Math.max(4, rect.left - pad);
  const y = Math.max(4, rect.top - pad);
  const w = Math.min(window.innerWidth - x - 4, rect.width + pad * 2);
  const h = Math.min(window.innerHeight - y - 4, rect.height + pad * 2);

  const hole = document.getElementById("tourHole");
  const stroke = document.getElementById("tourHoleStroke");
  if (hole) {
    hole.setAttribute("x", x);
    hole.setAttribute("y", y);
    hole.setAttribute("width", w);
    hole.setAttribute("height", h);
  }
  if (stroke) {
    stroke.setAttribute("x", x);
    stroke.setAttribute("y", y);
    stroke.setAttribute("width", w);
    stroke.setAttribute("height", h);
  }

  const caption = $("tourCaption");
  const numEl = $("tourStepNum");
  const titleEl = $("tourStepTitle");
  const bodyEl = $("tourStepBody");
  const dots = $("tourDots");
  if (numEl) numEl.textContent = String(tourState.index + 1).padStart(2, "0");
  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.textContent = step.body;
  if (dots) {
    [...dots.children].forEach((dot, i) => {
      dot.classList.toggle("done", i < tourState.index);
      dot.classList.toggle("current", i === tourState.index);
    });
  }

  if (caption) {
    caption.classList.add("entering");
    requestAnimationFrame(() => {
      const captionW = 380;
      const captionH = caption.offsetHeight || 220;
      const margin = 18;
      let cx = x + w + margin;
      if (cx + captionW > window.innerWidth - 8) cx = Math.max(8, x - captionW - margin);
      if (cx < 8) cx = Math.max(8, (window.innerWidth - captionW) / 2);
      let cy = y + (h - captionH) / 2;
      cy = Math.max(8, Math.min(window.innerHeight - captionH - 8, cy));
      caption.style.left = `${cx}px`;
      caption.style.top = `${cy}px`;
      requestAnimationFrame(() => caption.classList.remove("entering"));
    });
  }

  const backBtn = document.querySelector('[data-tour-action="back"]');
  const nextBtn = document.querySelector('[data-tour-action="next"]');
  if (backBtn) backBtn.disabled = tourState.index === 0;
  if (nextBtn) nextBtn.textContent = tourState.index === TOUR_STEPS.length - 1 ? "Finish ✓" : "Next →";
}

function openTour({ welcome = true } = {}) {
  const root = $("tourRoot");
  if (!root) return;
  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  tourState.active = true;
  tourState.index = 0;

  const welcomeEl = root.querySelector('[data-tour-phase="welcome"]');
  const stepEl = root.querySelector('[data-tour-phase="step"]');
  if (welcome) {
    if (welcomeEl) welcomeEl.hidden = false;
    if (stepEl) stepEl.hidden = true;
    tourState.phase = "welcome";
  } else {
    if (welcomeEl) welcomeEl.hidden = true;
    startTourSteps();
  }

  if (!tourState.keyHandler) {
    tourState.keyHandler = (e) => {
      if (!tourState.active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (tourState.phase === "step") {
        if (e.key === "ArrowRight" || e.key === "Enter") {
          e.preventDefault();
          tourNext();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          tourBack();
        }
      } else if (tourState.phase === "welcome") {
        if (e.key === "Enter" || e.key === "ArrowRight") {
          e.preventDefault();
          startTourSteps();
        }
      }
    };
    window.addEventListener("keydown", tourState.keyHandler, true);
  }
}

export function setupTour() {
  const root = $("tourRoot");
  if (!root) return;

  root.querySelectorAll("[data-tour-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.tourAction;
      if (action === "start") startTourSteps();
      else if (action === "skip") endTour();
      else if (action === "next") tourNext();
      else if (action === "back") tourBack();
    });
  });

  const replay = $("tourReplay");
  if (replay) replay.addEventListener("click", () => openTour());

  const dotsEl = $("tourDots");
  if (dotsEl) {
    dotsEl.innerHTML = TOUR_STEPS.map(() => "<i></i>").join("");
  }
  const totalEl = $("tourStepTotal");
  if (totalEl) totalEl.textContent = String(TOUR_STEPS.length).padStart(2, "0");

  let seen = false;
  try {
    seen = window.localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    /* ignore */
  }
  if (!seen) {
    setTimeout(() => openTour({ welcome: true }), 350);
  }
}
