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
 * Calculate squared distance (faster when you don't need the actual distance)
 */
export function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
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
 * Optimized with early radius check before polygon test
 */
export function isInWater(
  x: number,
  y: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
    outline?: Array<{ x: number; y: number }>;
  }>,
): boolean {
  for (const lake of lakes) {
    // Fast radius check first (eliminates most cases)
    const dx = x - lake.center.x;
    const dy = y - lake.center.y;
    const distSq = dx * dx + dy * dy;
    const maxRadiusSq = (lake.radius * 1.5) ** 2; // Add margin for irregular shapes

    if (distSq > maxRadiusSq) continue;

    // Precise polygon check
    if (lake.outline && lake.outline.length >= 3) {
      if (pointInPolygon({ x, y }, lake.outline)) return true;
    } else {
      // Fallback to circle check
      if (distSq <= lake.radius * lake.radius) return true;
    }
  }

  return false;
}

/**
 * Get distance from point to nearest lake edge
 * Returns negative if inside lake, positive if outside
 */
export function distanceToLakeEdge(
  x: number,
  y: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
    outline?: Array<{ x: number; y: number }>;
  }>,
): number {
  let minDistance = Infinity;

  for (const lake of lakes) {
    const distToCenter = distance({ x, y }, lake.center);

    // Simple approximation using radius
    const distToEdge = distToCenter - lake.radius;

    if (Math.abs(distToEdge) < Math.abs(minDistance)) {
      minDistance = distToEdge;
    }
  }

  return minDistance;
}

/**
 * Normalize a vector to unit length
 */
export function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Linear interpolation between two positions
 */
export function lerpPosition(a: Position, b: Position, t: number): Position {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  };
}

/**
 * Check if a circle overlaps with any lake
 */
export function circleOverlapsLakes(
  x: number,
  y: number,
  radius: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
  }>,
): boolean {
  for (const lake of lakes) {
    const d = distance({ x, y }, lake.center);
    if (d < radius + lake.radius) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a circle (e.g. an entity's icon) overlaps a rectangle (e.g. a drag-selection box).
 * Used instead of a plain center-point-in-rect test so a small drag that merely clips an icon's
 * edge still counts as a hit — otherwise tiny boxes over a valid target can miss entirely.
 */
export function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
): boolean {
  const closestX = clamp(cx, rectX, rectX + rectWidth);
  const closestY = clamp(cy, rectY, rectY + rectHeight);
  const dx = cx - closestX;
  const dy = cy - closestY;

  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Generate a random position within a margin-constrained area
 */
export function randomPosition(width: number, height: number, margin: number = 0): Position {
  return {
    x: randRange(margin, width - margin),
    y: randRange(margin, height - margin),
  };
}

/**
 * Calculate angle between two points (in radians)
 */
export function angleBetween(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Point on the segment from `targetPos` toward `unitPos`, `standoff` units away from the target.
 * Used to approach a combat target and stop just inside weapon range instead of walking into it.
 */
export function approachPoint(unitPos: Position, targetPos: Position, standoff: number): Position {
  const dx = unitPos.x - targetPos.x;
  const dy = unitPos.y - targetPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= standoff || dist === 0) return { ...unitPos };

  return { x: targetPos.x + (dx / dist) * standoff, y: targetPos.y + (dy / dist) * standoff };
}

/**
 * Check if two circles overlap
 */
export function circlesOverlap(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distSq = dx * dx + dy * dy;
  const radiusSum = r1 + r2;
  return distSq < radiusSum * radiusSum;
}
