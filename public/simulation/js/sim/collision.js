/** 2D building footprint hit test (grid coords). */

export function pointNearBuilding(x, z, rects, radius = 0.34) {
  for (const r of rects) {
    if (
      x >= r.x - radius &&
      x <= r.x + r.w + radius &&
      z >= r.z - radius &&
      z <= r.z + r.d + radius
    ) {
      return true;
    }
  }
  return false;
}
