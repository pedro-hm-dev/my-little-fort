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
 * `count` angles evenly spread around a full circle, sharing one random overall rotation and a
 * small per-slot jitter — used to spread a group of units around a shared target (attack/gather)
 * instead of every unit converging on the exact same point.
 */
export function evenlySpacedAngles(count: number, jitterFraction: number = 0.25): number[] {
  if (count <= 0) return [];

  const baseAngle = Math.random() * Math.PI * 2;
  const slice = (Math.PI * 2) / count;
  const angles: number[] = [];

  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * slice * jitterFraction;
    angles.push(baseAngle + slice * i + jitter);
  }

  return angles;
}

/**
 * Shortest distance from a point to a line segment.
 */
export function distanceToSegment(point: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return distance(point, a);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };

  return distance(point, closest);
}

/**
 * Shortest distance from a point to a polyline (e.g. a river's centerline).
 */
export function distanceToPolyline(point: Position, path: Position[]): number {
  let min = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    min = Math.min(min, distanceToSegment(point, a, b));
  }

  return min;
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
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function outlineBounds(outline: Array<{ x: number; y: number }>): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const point of outline) {
    if (point.x < bounds.minX) bounds.minX = point.x;
    if (point.x > bounds.maxX) bounds.maxX = point.x;
    if (point.y < bounds.minY) bounds.minY = point.y;
    if (point.y > bounds.maxY) bounds.maxY = point.y;
  }

  return bounds;
}

export function isInWater(
  x: number,
  y: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
    outline?: Array<{ x: number; y: number }>;
    bounds?: Bounds;
  }>,
): boolean {
  for (const lake of lakes) {
    // Bounding box first when the body carries one. A river's `radius` spans its whole length, so the
    // circle test below barely rejects anything for them — the box does.
    if (lake.bounds) {
      if (x < lake.bounds.minX || x > lake.bounds.maxX || y < lake.bounds.minY || y > lake.bounds.maxY) continue;
    }

    // Fast radius check (eliminates most cases)
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
