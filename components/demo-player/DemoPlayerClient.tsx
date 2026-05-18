"use client";

import { useEffect } from "react";
import { initDemoPlayer } from "@/lib/demo-player/playerRuntime";

export function DemoPlayerClient() {
  useEffect(() => {
    const dispose = initDemoPlayer("/demo-player/timeline.json");
    return dispose;
  }, []);

  return (
    <div id="app">
      <header id="hud-header">
        <span className="logo">A · R · C</span>
        <span id="step-counter">Step 0 / —</span>
        <span id="geo-badge">300M GEO GRID</span>
        <span id="mode-badge">EDGE_ONLY</span>
      </header>

      <div id="map-container">
        <div id="basemap" aria-hidden="true" />
        <canvas id="map-canvas" />
        <div id="toast-layer" />
      </div>

      <aside id="side-panel">
        <div id="thinking-panel">
          <div className="panel-title">🧠 Decision Hub</div>
          <div id="thinking-text">Awaiting simulation data…</div>
        </div>
        <div id="agent-legend">
          <div className="panel-title">Fleet</div>
          <div className="legend-row">
            <div
              className="legend-dot"
              style={{ background: "#00bfff", boxShadow: "0 0 6px #00bfff" }}
            />
            <span style={{ color: "#00bfff" }}>UAV — aerial recon</span>
          </div>
          <div className="legend-row">
            <div
              className="legend-dot"
              style={{ background: "#39ff14", boxShadow: "0 0 6px #39ff14" }}
            />
            <span style={{ color: "#39ff14" }}>UGV — ground rescue</span>
          </div>
          <div className="legend-row">
            <div
              className="legend-dot"
              style={{ background: "#c8b4ff", boxShadow: "0 0 6px #c8b4ff" }}
            />
            <span style={{ color: "#c8b4ff" }}>Balloon — comm relay</span>
          </div>
          <div className="legend-row">
            <div className="legend-dot" style={{ background: "#ff6666" }} />
            <span style={{ color: "#ff6666" }}>Survivors</span>
          </div>
        </div>
        <div id="event-log" />
      </aside>

      <footer id="dashboard">
        <div className="dash-cell">
          <div className="dash-title">Survival probability</div>
          <canvas id="chart-canvas" height={90} />
        </div>
        <div className="dash-cell">
          <div className="dash-title">Commander brief</div>
          <div id="briefing-text" />
        </div>
        <div className="dash-cell" id="stats-box">
          <div className="stat-row">
            <span className="stat-label">RESCUED</span>
            <span className="stat-val" id="stat-rescued" style={{ color: "#39ff14" }}>
              0
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">SACRIFICED</span>
            <span className="stat-val" id="stat-sacrificed" style={{ color: "#ff8c00" }}>
              0
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">COMM COV.</span>
            <span className="stat-val" id="stat-coverage" style={{ color: "#c8b4ff", fontSize: 16 }}>
              —
            </span>
          </div>
        </div>
      </footer>

      <nav id="controls">
        <button id="btn-first" type="button" title="Jump to start">
          |◁
        </button>
        <button id="btn-back" type="button" title="Step back">
          ◁
        </button>
        <button id="btn-play" type="button" title="Play / pause">
          ▶
        </button>
        <button id="btn-fwd" type="button" title="Step forward">
          ▷
        </button>
        <button id="btn-last" type="button" title="Jump to end">
          ▷|
        </button>
        <input id="scrubber" type="range" min={0} defaultValue={0} step={1} />
        <span id="ctrl-label">Speed</span>
        <button className="speed-btn" type="button" data-speed="0.5">
          0.5×
        </button>
        <button className="speed-btn active" type="button" data-speed="1">
          1×
        </button>
        <button className="speed-btn" type="button" data-speed="2">
          2×
        </button>
        <button className="speed-btn" type="button" data-speed="4">
          4×
        </button>
      </nav>
    </div>
  );
}
