/* ==========================================================================
   A.R.C. Demo Player — player.js
   Tasks 4 / 5 / 6: Playback engine + rendering + UI panels
   ========================================================================== */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
let CELL     = 20;          // pixels per grid cell, recalculated from viewport
let MAP_COLS = 30;
let MAP_ROWS = 30;
const MS_PER_STEP_BASE = 800; // at 1× speed
const PMTILES_URL = 'https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles';
const GEO_BOUNDS_1KM = {
  label: 'Firenze Centro 1km x 1km',
  // [south, west], [north, east]. Center: 43.7696, 11.2558.
  // Approx 1km square at this latitude: 0.00898 deg lat x 0.01244 deg lon.
  southWest: [43.76511, 11.24958],
  northEast: [43.77409, 11.26202],
};

const COLORS = {
  uav:     '#00bfff',
  ugv:     '#39ff14',
  balloon: '#c8b4ff',
  victim:  '#ff6666',
  rescued: '#39ff14',
  dead:    '#555',
  risk:    '#ff3c00',
  block:   '#8b4513',
  deadzone:'#334466',
  base:    '#ffe44d',
};

const TOAST_CFG = {
  hub_formed:       { icon: '🔗', color: '#00bfff', bg: 'rgba(0,30,80,0.9)' },
  rescued:          { icon: '✅', color: '#39ff14', bg: 'rgba(0,60,0,0.9)' },
  sacrifice:        { icon: '💀', color: '#ff8c00', bg: 'rgba(80,30,0,0.9)' },
  energy_transfer:  { icon: '⚡', color: '#ffe44d', bg: 'rgba(60,55,0,0.9)' },
  blockade_cleared: { icon: '🚧', color: '#ffe44d', bg: 'rgba(60,50,0,0.9)' },
  dynamic_obstacle: { icon: '⚠️', color: '#ff8c00', bg: 'rgba(85,35,0,0.92)' },
  balloon_deployed: { icon: '🎈', color: '#c8b4ff', bg: 'rgba(40,20,80,0.9)' },
  comm_restored:    { icon: '📡', color: '#c8b4ff', bg: 'rgba(20,10,60,0.9)' },
  alert:            { icon: '🚨', color: '#ff4444', bg: 'rgba(80,0,0,0.9)' },
  victim_dead:      { icon: '💔', color: '#ff4444', bg: 'rgba(60,0,0,0.9)' },
  default:          { icon: 'ℹ️',  color: '#c0d8f0', bg: 'rgba(10,20,40,0.9)' },
};

let baseMap = null;
let baseMapReady = false;
let pmtilesProtocolInstalled = false;

function gridToLngLat(col, row) {
  const west = GEO_BOUNDS_1KM.southWest[1];
  const south = GEO_BOUNDS_1KM.southWest[0];
  const east = GEO_BOUNDS_1KM.northEast[1];
  const north = GEO_BOUNDS_1KM.northEast[0];
  const x = Math.min(1, Math.max(0, col / Math.max(1, MAP_COLS)));
  const y = Math.min(1, Math.max(0, row / Math.max(1, MAP_ROWS)));
  return [
    west + x * (east - west),
    north - y * (north - south),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
function cx(col) { return col * CELL + CELL / 2; }   // center x of grid column
function cy(row) { return row * CELL + CELL / 2; }   // center y of grid row

// Canvas retina fix
function setupCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  canvas.width  = safeW * dpr;
  canvas.height = safeH * dpr;
  canvas.style.width  = safeW + 'px';
  canvas.style.height = safeH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function cssCanvasWidth(canvas) {
  return canvas.width / (window.devicePixelRatio || 1);
}

function resizeBasemap(w, h) {
  const el = document.getElementById('basemap');
  if (!el) return;
  el.style.width = `${Math.max(1, Math.floor(w))}px`;
  el.style.height = `${Math.max(1, Math.floor(h))}px`;
  if (baseMap) {
    baseMap.resize();
    baseMap.fitBounds(
      [
        [GEO_BOUNDS_1KM.southWest[1], GEO_BOUNDS_1KM.southWest[0]],
        [GEO_BOUNDS_1KM.northEast[1], GEO_BOUNDS_1KM.northEast[0]],
      ],
      { padding: 0, duration: 0 },
    );
  }
}

function makeFallbackBasemapStyle() {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${PMTILES_URL}`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: 'pm-mask',
        source: 'protomaps',
        'source-layer': 'mask',
        type: 'fill',
        paint: { 'fill-color': '#0f1726' },
      },
      {
        id: 'pm-earth',
        source: 'protomaps',
        'source-layer': 'earth',
        type: 'fill',
        paint: { 'fill-color': '#121d2e' },
      },
      {
        id: 'pm-water',
        source: 'protomaps',
        'source-layer': 'water',
        type: 'fill',
        paint: { 'fill-color': '#164969', 'fill-opacity': 0.85 },
      },
      {
        id: 'pm-landuse',
        source: 'protomaps',
        'source-layer': 'landuse',
        type: 'fill',
        paint: { 'fill-color': '#1b2940', 'fill-opacity': 0.72 },
      },
      {
        id: 'pm-buildings',
        source: 'protomaps',
        'source-layer': 'buildings',
        type: 'fill',
        paint: {
          'fill-color': '#445873',
          'fill-opacity': 0.68,
          'fill-outline-color': '#6d86a8',
        },
      },
      {
        id: 'pm-roads',
        source: 'protomaps',
        'source-layer': 'roads',
        type: 'line',
        paint: {
          'line-color': '#a9bdd5',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 3.2, 18, 5.6],
          'line-opacity': 0.82,
        },
      },
      {
        id: 'pm-road-labels',
        source: 'protomaps',
        'source-layer': 'roads',
        type: 'symbol',
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 11, 18, 13],
          'text-padding': 2,
        },
        paint: {
          'text-color': '#c9d6e7',
          'text-halo-color': '#07101d',
          'text-halo-width': 1.2,
          'text-opacity': 0.76,
        },
      },
    ],
  };
}

function initBasemap() {
  if (baseMap || !window.maplibregl || !window.pmtiles) return;

  try {
    if (!pmtilesProtocolInstalled) {
      const protocol = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', protocol.tile);
      const archive = new pmtiles.PMTiles(PMTILES_URL);
      protocol.add(archive);
      pmtilesProtocolInstalled = true;
    }

    const style = makeFallbackBasemapStyle();

    baseMap = new maplibregl.Map({
      container: 'basemap',
      style,
      bounds: [
        [GEO_BOUNDS_1KM.southWest[1], GEO_BOUNDS_1KM.southWest[0]],
        [GEO_BOUNDS_1KM.northEast[1], GEO_BOUNDS_1KM.northEast[0]],
      ],
      fitBoundsOptions: { padding: 0, duration: 0 },
      interactive: false,
      attributionControl: false,
    });
    baseMap.on('load', () => {
      baseMapReady = true;
      baseMap.fitBounds(
        [
          [GEO_BOUNDS_1KM.southWest[1], GEO_BOUNDS_1KM.southWest[0]],
          [GEO_BOUNDS_1KM.northEast[1], GEO_BOUNDS_1KM.northEast[0]],
        ],
        { padding: 0, duration: 0 },
      );
    });
  } catch (err) {
    console.warn('[basemap] PMTiles initialization failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Typewriter
// ---------------------------------------------------------------------------
let _twTimer = null;
function typewriter(el, text, speed = 22) {
  clearInterval(_twTimer);
  el.textContent = '';
  let i = 0;
  _twTimer = setInterval(() => {
    el.textContent += text[i++] || '';
    el.scrollTop = el.scrollHeight;
    if (i >= text.length) clearInterval(_twTimer);
  }, speed);
}

let _brTimer = null;
function typewriterBriefing(el, text, speed = 18) {
  clearInterval(_brTimer);
  el.textContent = '';
  let i = 0;
  _brTimer = setInterval(() => {
    el.textContent += text[i++] || '';
    el.scrollTop = el.scrollHeight;
    if (i >= text.length) clearInterval(_brTimer);
  }, speed);
}

// ---------------------------------------------------------------------------
// Stat counter animation
// ---------------------------------------------------------------------------
function popCounter(el, val) {
  el.textContent = val;
  el.classList.remove('pop');
  void el.offsetWidth; // reflow
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 250);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(event) {
  const cfg = TOAST_CFG[event.type] || TOAST_CFG.default;
  const el  = document.createElement('div');
  el.className = 'toast';
  el.style.cssText = (
    `background:${cfg.bg};border-left-color:${cfg.color};color:${cfg.color};`
  );
  el.textContent = `${cfg.icon} ${event.description}`;
  document.getElementById('toast-layer').appendChild(el);

  el.animate(
    [{ opacity: 0, transform: 'translateX(20px)' },
     { opacity: 1, transform: 'translateX(0)' }],
    { duration: 300, fill: 'forwards' }
  );
  setTimeout(() => {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' })
      .onfinish = () => el.remove();
  }, 3200);
}

// ---------------------------------------------------------------------------
// Survival chart (Task 6)
// ---------------------------------------------------------------------------
let chartCtx = null;
function renderSurvivalChart(frame) {
  if (!chartCtx) return;
  const victims = frame.victims;
  const W = cssCanvasWidth(chartCtx.canvas);
  const H = 90;
  chartCtx.clearRect(0, 0, W, H);

  const barW = Math.max(2, Math.min(40, W / (victims.length + 1)));
  const gap  = barW * 0.2;

  victims.forEach((v, i) => {
    const pct   = (v.survival_pct || 0) / 100;
    const barH  = Math.max(2, (H - 22) * pct);
    const x     = i * (barW + gap) + gap;
    const y     = H - barH - 16;

    const r = Math.round(255 * (1 - pct));
    const g = Math.round(200 * pct);
    const color = v.status === 'rescued' ? '#39ff14'
                : v.status === 'dead'    ? '#555'
                : `rgb(${r},${g},0)`;

    chartCtx.fillStyle = color;
    chartCtx.shadowBlur = 6;
    chartCtx.shadowColor = color;
    chartCtx.fillRect(x, y, barW - gap, barH);
    chartCtx.shadowBlur = 0;

    chartCtx.fillStyle = '#607090';
    chartCtx.font = '9px Courier New';
    chartCtx.fillText(v.id, x, H - 4);
    if (v.status !== 'rescued' && v.status !== 'dead') {
      chartCtx.fillStyle = color;
      chartCtx.fillText(v.survival_pct + '%', x, y - 2);
    }
  });
}

// ---------------------------------------------------------------------------
// Map rendering (Task 5)
// ---------------------------------------------------------------------------
let mapCtx = null;
let scenario = null; // original scenario raw fields cached from first frame

// Agent trail history: { agentId: [{x,y}] }
const TRAIL_LEN = 10;
const trails = {};

function agentColor(type) {
  return { uav: COLORS.uav, ugv: COLORS.ugv, balloon: COLORS.balloon }[type] || COLORS.uav;
}

function drawGrid(ctx) {
  ctx.strokeStyle = 'rgba(0,120,200,0.12)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= MAP_COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, MAP_ROWS * CELL); ctx.stroke();
  }
  for (let r = 0; r <= MAP_ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(MAP_COLS * CELL, r * CELL); ctx.stroke();
  }
}

function drawRiskZones(ctx, zones, t) {
  zones.forEach(z => {
    const px = cx(z.center[0]);
    const py = cy(z.center[1]);
    const r  = z.radius * CELL;
    const alpha = 0.12 + Math.sin(t * 0.003) * 0.06;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(255,60,0,${alpha * 2})`);
    grad.addColorStop(1, `rgba(255,60,0,0)`);
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = `rgba(255,60,0,${alpha * 3})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,80,0,0.7)';
    ctx.font = '9px Courier New';
    ctx.fillText(z.type.toUpperCase(), px - 14, py + 3);
  });
}

function drawDeadZones(ctx, zones) {
  zones.forEach(z => {
    const px = cx(z.center[0]);
    const py = cy(z.center[1]);
    const r  = z.radius * CELL;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#334466';
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    // noise dots
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#88aacc';
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      ctx.fillRect(px + d * Math.cos(a) - 0.5, py + d * Math.sin(a) - 0.5, 1.5, 1.5);
    }
    ctx.restore();
  });
}

function drawBlockedCells(ctx, cells) {
  cells.forEach(b => {
    const [col, row] = b.location;
    if (b.status === 'blocked') {
      ctx.fillStyle = b.dynamic ? 'rgba(255,140,0,0.58)' : 'rgba(139,69,19,0.5)';
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
      ctx.strokeStyle = b.dynamic ? '#ff8c00' : '#8b4513';
      ctx.lineWidth = 1;
      ctx.strokeRect(col * CELL + 0.5, row * CELL + 0.5, CELL - 1, CELL - 1);
      ctx.fillStyle = b.dynamic ? '#ffd27a' : '#a0522d';
      ctx.font = '9px Courier New';
      ctx.fillText(b.dynamic ? 'NEW' : 'BLK', col * CELL + 2, row * CELL + CELL / 2 + 3);
    } else {
      ctx.fillStyle = 'rgba(57,255,20,0.07)';
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  });
}

function drawBase(ctx, base) {
  const [col, row] = base;
  const x = cx(col), y = cy(row);
  ctx.strokeStyle = COLORS.base;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(col * CELL + 2, row * CELL + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = COLORS.base;
  ctx.font = 'bold 9px Courier New';
  ctx.fillText('BASE', col * CELL + 1, row * CELL + CELL / 2 + 3);
}

// ── Victim rendering ────────────────────────────────────────────────────────
function drawVictims(ctx, victims) {
  victims.forEach(v => {
    const [col, row] = v.location;
    const x = cx(col), y = cy(row);
    const color = v.status === 'rescued' ? COLORS.rescued
                : v.status === 'dead'    ? COLORS.dead
                : COLORS.victim;
    ctx.shadowBlur  = v.status === 'trapped' ? 8 : 3;
    ctx.shadowColor = color;
    ctx.fillStyle   = color;
    ctx.beginPath();
    // Cross marker
    ctx.fillRect(x - 1, y - 5, 2, 10);
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.shadowBlur = 0;

    // ID label
    ctx.fillStyle = color;
    ctx.font = '9px Courier New';
    ctx.fillText(v.id, x - 8, y - 8);

    // Survival bar
    if (v.status === 'trapped') {
      const barW = 16;
      const pct  = (v.survival_pct || 0) / 100;
      const r    = Math.round(255 * (1 - pct));
      const g    = Math.round(180 * pct);
      ctx.fillStyle = '#222';
      ctx.fillRect(x - barW / 2, y + 7, barW, 3);
      ctx.fillStyle = `rgb(${r},${g},0)`;
      ctx.fillRect(x - barW / 2, y + 7, barW * pct, 3);
    }
  });
}

// ── UAV rendering ───────────────────────────────────────────────────────────
function drawUAV(ctx, x, y, battery, scanRange, t, trail) {
  const color = COLORS.uav;
  // Trail
  if (trail && trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const alpha = (i / trail.length) * 0.5;
      ctx.strokeStyle = color.replace(')', `,${alpha})`).replace('rgb', 'rgba');
      ctx.lineWidth = lerp(0.5, 2, i / trail.length);
      ctx.beginPath();
      ctx.moveTo(trail[i-1].x * CELL + CELL/2, trail[i-1].y * CELL + CELL/2);
      ctx.lineTo(trail[i].x  * CELL + CELL/2, trail[i].y  * CELL + CELL/2);
      ctx.stroke();
    }
  }
  // Scan circle
  ctx.beginPath();
  ctx.arc(x, y, scanRange * CELL, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,191,255,0.25)`;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(0,191,255,0.04)`;
  ctx.fill();

  // Rotor icon
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.008);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.shadowBlur  = 8;
  ctx.shadowColor = color;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(7, 0); ctx.stroke();
    ctx.beginPath();
    ctx.arc(9, 0, 2.5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();

  // Battery label
  ctx.fillStyle = battery < 0.15 ? '#ff4444' : battery < 0.3 ? '#ff8c00' : color;
  ctx.font = '9px Courier New';
  ctx.fillText(`${Math.round(battery * 100)}%`, x + 10, y - 10);
}

// ── UGV rendering ───────────────────────────────────────────────────────────
function drawUGV(ctx, x, y, battery, task, trail, chargingTarget) {
  const color = COLORS.ugv;
  // Trail (dashed)
  if (trail && trail.length > 1) {
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = `rgba(57,255,20,0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const px = p.x * CELL + CELL / 2;
      const py = p.y * CELL + CELL / 2;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.shadowBlur  = 8;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  // Body
  ctx.strokeRect(-7, -5, 14, 10);
  // Tracks
  ctx.fillStyle = color;
  ctx.fillRect(-9, -7, 3, 14);
  ctx.fillRect( 6, -7, 3, 14);
  // Turret dot
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Charging energy line
  if (task === 'charge' && chargingTarget) {
    const t2 = performance.now();
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -(t2 / 60) % 8;
    ctx.strokeStyle = '#ffe44d';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur  = 6;
    ctx.shadowColor = '#ffe44d';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(chargingTarget.x, chargingTarget.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  ctx.fillStyle = battery < 0.15 ? '#ff4444' : battery < 0.3 ? '#ff8c00' : color;
  ctx.font = '9px Courier New';
  ctx.fillText(`${Math.round(battery * 100)}%`, x + 10, y - 10);
}

// ── Balloon rendering ────────────────────────────────────────────────────────
function drawBalloon(ctx, x, y, battery, t) {
  const color  = COLORS.balloon;
  const commR  = 12 * CELL;
  const drift  = Math.sin(t * 0.0008) * 4;
  const by     = y + drift;
  const pulse  = 1 + Math.sin(t * 0.0006) * 0.04;

  // Comm coverage circle
  ctx.beginPath();
  ctx.arc(x, by, commR * pulse, 0, Math.PI * 2);
  ctx.fillStyle   = `rgba(200,180,255,0.05)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(200,180,255,0.2)`;
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  // Balloon body
  ctx.save();
  ctx.translate(x, by);
  ctx.shadowBlur  = 14;
  ctx.shadowColor = color;
  // Balloon sphere
  ctx.beginPath(); ctx.arc(0, -5, 8, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(200,180,255,0.7)`; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  // Gondola
  ctx.fillStyle = color;
  ctx.fillRect(-4, 4, 8, 5);
  // Rope
  ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(-4, 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( 3, 3); ctx.lineTo( 4, 4); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.fillStyle = color;
  ctx.font = '9px Courier New';
  ctx.fillText(`${Math.round(battery * 100)}%`, x + 10, y - 12);
}

// ── Interpolated agent positions ─────────────────────────────────────────────
let prevFrame = null;

function getInterpPos(agent, t) {
  if (!prevFrame) return { x: agent.location[0], y: agent.location[1] };
  const prev = prevFrame.agents.find(a => a.id === agent.id);
  if (!prev) return { x: agent.location[0], y: agent.location[1] };
  return {
    x: lerp(prev.location[0], agent.location[0], t),
    y: lerp(prev.location[1], agent.location[1], t),
  };
}

// ── Master render ─────────────────────────────────────────────────────────────
function renderFrame(frame, interpT, ts) {
  if (!mapCtx) return;
  const W = MAP_COLS * CELL;
  const H = MAP_ROWS * CELL;
  mapCtx.clearRect(0, 0, W, H);

  // Background
  mapCtx.fillStyle = baseMapReady ? 'rgba(5,13,26,0.16)' : '#050d1a';
  mapCtx.fillRect(0, 0, W, H);

  drawGrid(mapCtx);

  // Map features from first frame or scenario
  const riskZones = frame._risk_zones  || [];
  const deadZones = frame._dead_zones  || [];
  const blockedCells = frame.blocked_cells || [];
  const base = frame._base || [2, 2];

  drawDeadZones(mapCtx, deadZones);
  drawRiskZones(mapCtx, riskZones, ts);
  drawBlockedCells(mapCtx, blockedCells);
  drawBase(mapCtx, base);
  drawVictims(mapCtx, frame.victims);

  // Agents
  frame.agents.forEach(agent => {
    const pos   = getInterpPos(agent, interpT);
    const px    = pos.x * CELL + CELL / 2;
    const py    = pos.y * CELL + CELL / 2;
    const type  = agent.type;
    const trail = trails[agent.id] || [];

    if (agent.health === 'offline') {
      // Faded X marker for offline/sacrificed agents
      mapCtx.strokeStyle = '#555';
      mapCtx.lineWidth = 1.5;
      mapCtx.beginPath();
      mapCtx.moveTo(px-5, py-5); mapCtx.lineTo(px+5, py+5); mapCtx.stroke();
      mapCtx.beginPath();
      mapCtx.moveTo(px+5, py-5); mapCtx.lineTo(px-5, py+5); mapCtx.stroke();
      return;
    }

    if (type === 'uav') {
      drawUAV(mapCtx, px, py, agent.battery, 6, ts, trail);
    } else if (type === 'ugv') {
      // Check if being charged
      const chargerTarget = null; // future: find energy transfer in events
      drawUGV(mapCtx, px, py, agent.battery, agent.task, trail, chargerTarget);
    } else if (type === 'balloon') {
      drawBalloon(mapCtx, px, py, agent.battery, ts);
    }

    // Agent ID label
    mapCtx.fillStyle = agentColor(type);
    mapCtx.font = 'bold 9px Courier New';
    mapCtx.fillText(agent.id, px - 12, py + 18);
  });
}

// Update trail history
function updateTrails(frame) {
  frame.agents.forEach(agent => {
    if (!trails[agent.id]) trails[agent.id] = [];
    trails[agent.id].push({ x: agent.location[0], y: agent.location[1] });
    if (trails[agent.id].length > TRAIL_LEN) trails[agent.id].shift();
  });
}

// ---------------------------------------------------------------------------
// ARCPlayer class
// ---------------------------------------------------------------------------
class ARCPlayer {
  constructor(timeline) {
    this.frames     = timeline.frames;
    this.total      = timeline.total_steps;
    this.step       = 0;
    this.playing    = false;
    this.speed      = 1.0;
    this.elapsed    = 0;
    this.lastTs     = null;
    this.interpT    = 0;

    // Cached stats for pop animation
    this._lastRescued    = 0;
    this._lastSacrificed = 0;

    // Bind static scenario data into every frame for renderer access
    const firstFrame = this.frames[0];
    this._injectMapData(firstFrame, timeline);

    this._setupCanvases();
    this._bindControls();
    this._bindResize();
    this._onStepChange(false);
    requestAnimationFrame(ts => this._loop(ts));
  }

  _injectMapData(firstFrame, timeline) {
    const allLocations = [];
    this.frames.forEach(f => {
      (f.agents || []).forEach(a => allLocations.push(a.location));
      (f.victims || []).forEach(v => allLocations.push(v.location));
      (f.blocked_cells || []).forEach(c => allLocations.push(c));
    });
    const maxX = Math.max(29, ...allLocations.map(p => Number(p?.[0]) || 0));
    const maxY = Math.max(29, ...allLocations.map(p => Number(p?.[1]) || 0));
    const isLargeScenario = timeline.scenario_id === 'mega_disaster_001' || maxX > 30 || maxY > 30;
    MAP_COLS = isLargeScenario ? 100 : Math.ceil(maxX) + 1;
    MAP_ROWS = isLargeScenario ? 100 : Math.ceil(maxY) + 1;

    // Extract from raw scenario embedded in timeline (if available)
    // or default to standard scenario_001 values
    const rz = [
      { center: [18, 5],  radius: 3, type: 'collapse' },
      { center: [15, 17], radius: 2, type: 'fire'     },
    ];
    const dz = [
      { center: [18, 5], radius: 4 },
    ];
    this.frames.forEach(f => {
      f._risk_zones = rz;
      f._dead_zones = dz;
      f._base       = [2, 2];
    });
  }

  _setupCanvases() {
    const mapCanvas   = document.getElementById('map-canvas');
    const chartCanvas = document.getElementById('chart-canvas');
    const mapContainer = document.getElementById('map-container');
    const mapW = Math.max(320, mapContainer.clientWidth);
    const mapH = Math.max(320, mapContainer.clientHeight);
    CELL = Math.max(8, Math.floor(Math.min(mapW / MAP_COLS, mapH / MAP_ROWS)));
    mapCtx = setupCanvas(mapCanvas, MAP_COLS * CELL, MAP_ROWS * CELL);
    resizeBasemap(MAP_COLS * CELL, MAP_ROWS * CELL);
    initBasemap();

    const chartCell = chartCanvas.closest('.dash-cell');
    const chartW = Math.max(160, chartCell ? chartCell.clientWidth - 24 : 240);
    chartCtx = setupCanvas(chartCanvas, chartW, 90);
    document.getElementById('scrubber').max = this.total - 1;
  }

  _bindResize() {
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this._setupCanvases();
        renderFrame(this.frames[this.step], this.interpT, performance.now());
        renderSurvivalChart(this.frames[this.step]);
      }, 120);
    });
  }

  _loop(ts) {
    const dt = this.lastTs ? ts - this.lastTs : 0;
    this.lastTs = ts;

    if (this.playing) {
      const ms = MS_PER_STEP_BASE / this.speed;
      this.elapsed  += dt;
      this.interpT   = Math.min(this.elapsed / ms, 1.0);

      if (this.elapsed >= ms) {
        this.elapsed = 0;
        this.interpT = 0;
        if (this.step < this.total - 1) {
          prevFrame = this.frames[this.step];
          updateTrails(prevFrame);
          this.step++;
          this._onStepChange(true);
        } else {
          this.playing = false;
          document.getElementById('btn-play').textContent = '▶';
        }
      }
    }

    renderFrame(this.frames[this.step], this.interpT, ts);
    requestAnimationFrame(ts2 => this._loop(ts2));
  }

  _onStepChange(animate) {
    const frame = this.frames[this.step];

    // Step counter
    document.getElementById('step-counter').textContent =
      `Step ${frame.step} / ${this.total}`;
    const [west, north] = gridToLngLat(0, 0);
    const [east, south] = gridToLngLat(MAP_COLS, MAP_ROWS);
    document.getElementById('geo-badge').textContent =
      `TACTICAL OSM · ${GEO_BOUNDS_1KM.label} · ${MAP_COLS}×${MAP_ROWS} · ${west.toFixed(4)},${south.toFixed(4)} ↔ ${east.toFixed(4)},${north.toFixed(4)}`;

    // Scrubber
    document.getElementById('scrubber').value = this.step;

    // Thinking log (typewriter if new content)
    if (frame.thinking_log) {
      typewriter(document.getElementById('thinking-text'), frame.thinking_log);
    }

    // Briefing
    if (frame.briefing) {
      typewriterBriefing(document.getElementById('briefing-text'), frame.briefing);
    }

    // Stats
    const stats = frame.stats || {};
    if (stats.rescued !== undefined && stats.rescued !== this._lastRescued) {
      popCounter(document.getElementById('stat-rescued'), stats.rescued);
      this._lastRescued = stats.rescued;
    }
    if (stats.sacrificed !== undefined && stats.sacrificed !== this._lastSacrificed) {
      popCounter(document.getElementById('stat-sacrificed'), stats.sacrificed);
      this._lastSacrificed = stats.sacrificed;
    }
    if (stats.comm_coverage_pct !== undefined) {
      document.getElementById('stat-coverage').textContent =
        stats.comm_coverage_pct + '%';
    }

    // Event log (side panel history) + toasts
    if (animate && frame.events && frame.events.length) {
      const logEl = document.getElementById('event-log');
      frame.events.forEach(ev => {
        showToast(ev);
        const row = document.createElement('div');
        const cfg = TOAST_CFG[ev.type] || TOAST_CFG.default;
        row.style.color = cfg.color;
        row.textContent = `${cfg.icon} [${frame.step}] ${ev.description}`;
        logEl.insertBefore(row, logEl.firstChild);
        // Keep last 20 entries
        while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
      });
    }

    // Survival chart
    renderSurvivalChart(frame);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  _bindControls() {
    document.getElementById('btn-play').addEventListener('click', () => {
      this.playing = !this.playing;
      document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶';
    });
    document.getElementById('btn-first').addEventListener('click', () => this._seek(0));
    document.getElementById('btn-last') .addEventListener('click', () => this._seek(this.total - 1));
    document.getElementById('btn-back') .addEventListener('click', () => this._seek(this.step - 1));
    document.getElementById('btn-fwd')  .addEventListener('click', () => this._seek(this.step + 1));

    document.getElementById('scrubber').addEventListener('input', e => {
      this._seek(parseInt(e.target.value));
    });

    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.speed = parseFloat(btn.dataset.speed);
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.playing = !this.playing;
        document.getElementById('btn-play').textContent = this.playing ? '⏸' : '▶';
      } else if (e.code === 'ArrowRight') this._seek(this.step + 1);
      else if (e.code === 'ArrowLeft')  this._seek(this.step - 1);
    });
  }

  _seek(target) {
    const s = Math.max(0, Math.min(this.total - 1, target));
    prevFrame   = s > 0 ? this.frames[s - 1] : null;
    this.step   = s;
    this.elapsed = 0;
    this.interpT = 0;
    this._onStepChange(false);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
fetch(`timeline.json?ts=${Date.now()}`, { cache: 'no-store' })
  .then(r => {
    if (!r.ok) throw new Error(`timeline.json not found (${r.status})`);
    return r.json();
  })
  .then(data => {
    window._player = new ARCPlayer(data);
  })
  .catch(err => {
    document.getElementById('thinking-text').textContent =
      '⚠️ 无法加载 timeline.json\n\n' +
      '请先运行:\n  python -m simulation.timeline_generator\n\n' +
      '然后用 HTTP 服务器打开此页面:\n  python -m http.server 8080\n' +
      '访问: http://localhost:8080/demo_player/\n\n' + err.message;
  });
