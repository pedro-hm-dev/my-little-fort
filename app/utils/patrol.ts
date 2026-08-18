import type { Position } from "@/types/Terrain";
import { outlineBounds, pointInPolygon } from "@/utils/geometry";

/** How many bounding-box samples to try before giving up on filling the route. */
const MAX_SAMPLE_ATTEMPTS = 400;

export interface PatrolRoute {
  waypoints: Position[];
  /** Middle of the loop — the nest sits here. */
  center: Position;
}

function centroid(points: Position[]): Position {
  let x = 0;
  let y = 0;

  for (const point of points) {
    x += point.x;
    y += point.y;
  }

  return { x: x / points.length, y: y / points.length };
}

/**
 * Builds a closed patrol loop inside an arbitrary polygon.
 *
 * Points come from rejection sampling the outline's bounding box, then get sorted by their angle
 * around the centroid. The sort is what keeps the loop from crossing itself: walking vertices in
 * angular order around an interior point always traces a simple polygon.
 */
export function generatePatrolRoute(
  outline: Position[],
  waypointCount: number,
  random: () => number = Math.random,
): PatrolRoute | null {
  if (outline.length < 3 || waypointCount < 3) return null;

  const bounds = outlineBounds(outline);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const sampled: Position[] = [];

  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS && sampled.length < waypointCount; attempt++) {
    const candidate = { x: bounds.minX + random() * width, y: bounds.minY + random() * height };

    if (pointInPolygon(candidate, outline)) sampled.push(candidate);
  }

  if (sampled.length < 3) return null;

  const center = centroid(sampled);
  const waypoints = [...sampled].sort(
    (a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
  );

  return { waypoints, center: centroid(waypoints) };
}
