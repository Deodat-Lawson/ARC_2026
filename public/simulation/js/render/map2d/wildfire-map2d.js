import { PRESET_VISUAL } from "../../config/presets.js";
import {
  invokeWithMap2DEnv,
  drawCommunication,
  drawRiskZones,
  drawBlockades,
  drawVictims,
  drawBase,
  drawAgents,
} from "./urban-quake.js";

function drawWildfireMeadowGrid(cols, rows, cell, ctx, canvas) {
  const c2 = PRESET_VISUAL.wildfire.canvas2d;
  const fillBg = typeof c2.solidTerrainFill === "string" ? c2.solidTerrainFill : "#140804";
  ctx.fillStyle = fillBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = c2.gridStroke || "rgba(255, 140, 72, 0.08)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= cols; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, canvas.height);
    ctx.stroke();
  }
  for (let i = 0; i <= rows; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(canvas.width, i * cell);
    ctx.stroke();
  }
}

/** 2D tactical map for meadow / WUI wildfire — no urban basemap stripes or buildings. */
export function drawWildfireMap2D(env) {
  invokeWithMap2DEnv(env, () => {
    if (!env.state) return;
    const t = env.t;
    const [cols, rows] = env.state.map.size;
    const cell = env.canvas.width / cols;
    env.ctx.clearRect(0, 0, env.canvas.width, env.canvas.height);
    drawWildfireMeadowGrid(cols, rows, cell, env.ctx, env.canvas);
    drawCommunication(cell, t);
    drawRiskZones(cell, t);
    drawBlockades(cell);
    drawVictims(cell, t);
    drawBase(cell);
    drawAgents(cell, t);
  });
}
