/** Shared grid / scoring helpers for simulation and 2D map. */

export function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

export function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Round scores for victim ranking display (2 decimal places). */
export function roundScore(value) {
  return Math.round(value * 100) / 100;
}

export function roundCoord(value) {
  return Math.round(value * 10) / 10;
}

export function nearCell(a, b, radius = 1.5) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

export function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}
