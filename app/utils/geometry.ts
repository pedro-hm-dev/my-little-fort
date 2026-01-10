import type { Position } from "@/types/Terrain";

/**
 * Generate a random number between min and max
 */
export function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Calculate Euclidean distance between two points
 */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>
): boolean {
  let inside = false;

  const n = polygon.length;

  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];

    if (!pi || !pj) continue;

    const xi = pi.x,
      yi = pi.y;
    const xj = pj.x,
      yj = pj.y;
    const intersects =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * Check if a point is inside any lake (water)
 */
export function isInWater(
  x: number,
  y: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
    outline?: Array<{ x: number; y: number }>;
  }>
): boolean {
  for (const lake of lakes) {
    if (lake.outline && lake.outline.length >= 3) {
      if (pointInPolygon({ x, y }, lake.outline)) return true;
    } else {
      const d = distance({ x, y }, lake.center);

      if (d <= lake.radius) return true;
    }
  }

  return false;
}
