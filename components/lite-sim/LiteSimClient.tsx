"use client";

import { useEffect, useRef } from "react";
import { initLiteSim } from "@/lib/lite-sim/liteSimRuntime";

export function LiteSimClient() {
  const minimapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dispose = initLiteSim();
    return dispose;
  }, []);

  useEffect(() => {
    const el = minimapRef.current;
    const handle = el?.querySelector<HTMLElement>(".panel-head");
    if (!el || !handle) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const parent = el.parentElement;
      if (!parent) return;
      const rect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      originX = rect.left - parentRect.left;
      originY = rect.top - parentRect.top;
      el.style.left = `${originX}px`;
      el.style.top = `${originY}px`;
      el.style.right = "auto";
      el.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const parent = el.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const maxX = parentRect.width - rect.width;
      const maxY = parentRect.height - rect.height;
      const nextX = Math.max(0, Math.min(maxX, originX + e.clientX - startX));
      const nextY = Math.max(0, Math.min(maxY, originY + e.clientY - startY));
      el.style.left = `${nextX}px`;
      el.style.top = `${nextY}px`;
    };

    const onUp = (e: PointerEvent) => {
      dragging = false;
      el.classList.remove("dragging");
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    return () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1 className="logo">A · R · C</h1>
          <p>Gemma-powered Rescue Triage and Mission Planning Simulator</p>
        </div>
        <div className="controls" aria-label="simulation controls">
          <button id="stepBtn" type="button" title="Advance one timestep">
            Step
          </button>
          <button id="autoBtn" type="button" title="Run or pause simulation">
            Run
          </button>
          <button id="resetBtn" type="button" title="Reset scenario">
            Reset
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="map-panel">
          <div className="map-grid">
            <div className="map-col map-2d-col" ref={minimapRef} aria-label="2D mini-map (drag to move)">
              <div className="panel-head" title="Drag to reposition">
                <div>
                  <h2>2D Disaster Map</h2>
                  <p id="tickLabel">Timestep 0</p>
                </div>
                <div className="score">
                  <span id="rescuedCount">0</span>
                  <small>rescued</small>
                </div>
              </div>
              <div id="toastLayer" />
              <canvas id="simCanvas" width={720} height={720} aria-label="2D rescue simulation map" />
              <div className="legend" aria-label="map legend">
                <span>
                  <i className="road" />
                  road
                </span>
                <span>
                  <i className="blockade" />
                  blockade
                </span>
                <span>
                  <i className="fire" />
                  fire
                </span>
                <span>
                  <i className="collapse" />
                  collapse
                </span>
                <span>
                  <i className="victim" />
                  victim
                </span>
                <span>
                  <i className="drone" />
                  drone
                </span>
                <span>
                  <i className="ugv" />
                  UGV
                </span>
              </div>
            </div>

            <div className="map-col map-pov-col" data-pov-index={0}>
              <div className="panel-head">
                <div>
                  <h2 data-pov-heading>FPV · Drone-1</h2>
                  <p data-pov-sub className="pov-sub-meta">
                    scout · battery —
                  </p>
                </div>
              </div>

              <div id="agentSelector" className="agent-selector" role="tablist" aria-label="Switch first-person feed" />
              <p className="agent-selector-hint">
                <kbd>1</kbd>–<kbd>4</kbd> select · <kbd>←</kbd> <kbd>→</kbd> cycle
              </p>

              <div className="pov-frame">
                <canvas className="pov-canvas" data-pov-canvas aria-label="FPV feed" />
                <div className="pov-reticle">
                  <div className="reticle-ring" />
                  <div className="reticle-cross h" />
                  <div className="reticle-cross v" />
                </div>
                <div className="pov-telemetry">
                  <div>
                    <span>ALT</span>
                    <b data-hud="alt">1.5</b>
                  </div>
                  <div>
                    <span>HDG</span>
                    <b data-hud="hdg">000</b>
                  </div>
                  <div>
                    <span>VEL</span>
                    <b data-hud="vel">0.0</b>
                  </div>
                  <div>
                    <span>PWR</span>
                    <b data-hud="pwr">--</b>
                  </div>
                </div>
                <div className="pov-corner tl">REC ●</div>
                <div className="pov-corner tr" data-hud="target">
                  TGT —
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="side-panel">
          <section>
            <h2>Victim Priority</h2>
            <div id="priorityList" className="priority-list" />
          </section>
          <section>
            <h2>Agent Status</h2>
            <div id="agentList" className="agent-list" />
          </section>
          <section>
            <h2>Event Log</h2>
            <div id="eventLog" className="event-log" />
          </section>
        </aside>
      </section>

      <section className="briefing-grid">
        <article className="briefing">
          <h2>Gemma Commander Brief</h2>
          <p id="briefText" />
        </article>
        <article className="briefing">
          <h2>Survival Trend</h2>
          <canvas id="survivalChart" width={380} height={160} />
        </article>
        <article className="briefing">
          <h2>Mission Plan JSON</h2>
          <pre id="missionJson" />
        </article>
      </section>
    </main>
  );
}
