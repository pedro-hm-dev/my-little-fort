import type { Position } from "@/types/Resource";

export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** 1 = solid, 0 = walkable. Row-major, `cols * rows` long. */
  blocked: Uint8Array;
  /** How many footprints cover each cell, so removing one structure doesn't clear a neighbour's cells. */
  coverage: Uint8Array;
  scratch?: NavScratch;
}

/** Reused across findPath calls: allocating 4 arrays of ~24k entries per call would dominate the cost. */
interface NavScratch {
  gScore: Float64Array;
  fScore: Float64Array;
  cameFrom: Int32Array;
  /** Which findPath run last wrote a cell, so the buffers never need clearing. */
  seenIn: Int32Array;
  closed: Uint8Array;
  run: number;
}

export interface Footprint {
  x: number;
  y: number;
  radius: number;
}

const DEFAULT_MAX_EXPANSIONS = 6000;
const SQRT2 = Math.SQRT2;

export function createNavGrid(width: number, height: number, cellSize: number): NavGrid {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  return { cols, rows, cellSize, blocked: new Uint8Array(cols * rows), coverage: new Uint8Array(cols * rows) };
}

/** Out of bounds counts as solid: nothing should path off the map. */
export function blockedAtCell(grid: NavGrid, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return true;

  return grid.blocked[cy * grid.cols + cx] === 1;
}

export function isBlockedAt(grid: NavGrid, x: number, y: number): boolean {
  return blockedAtCell(grid, Math.floor(x / grid.cellSize), Math.floor(y / grid.cellSize));
}

/** Marks (or unmarks) every cell whose center falls inside the footprint. */
export function stampCircle(grid: NavGrid, footprint: Footprint, solid: boolean) {
  const cell = grid.cellSize;
  const minCx = Math.max(0, Math.floor((footprint.x - footprint.radius) / cell));
  const maxCx = Math.min(grid.cols - 1, Math.floor((footprint.x + footprint.radius) / cell));
  const minCy = Math.max(0, Math.floor((footprint.y - footprint.radius) / cell));
  const maxCy = Math.min(grid.rows - 1, Math.floor((footprint.y + footprint.radius) / cell));
  const radiusSq = footprint.radius * footprint.radius;

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const dx = (cx + 0.5) * cell - footprint.x;
      const dy = (cy + 0.5) * cell - footprint.y;
      if (dx * dx + dy * dy > radiusSq) continue;

      const index = cy * grid.cols + cx;
      const covered = grid.coverage[index] ?? 0;
      const next = solid ? covered + 1 : Math.max(0, covered - 1);

      grid.coverage[index] = next;
      grid.blocked[index] = next > 0 ? 1 : 0;
    }
  }
}

/**
 * Walks the cells the segment actually crosses (Amanatides-Woo), instead of sampling points along it:
 * a one-cell-thick wall is exactly what sampling slips through.
 */
export function segmentIsClear(grid: NavGrid, from: Position, to: Position): boolean {
  const cell = grid.cellSize;
  let cx = Math.floor(from.x / cell);
  let cy = Math.floor(from.y / cell);

  if (blockedAtCell(grid, cx, cy)) return false;

  const endCx = Math.floor(to.x / cell);
  const endCy = Math.floor(to.y / cell);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let nextX = stepX === 0 ? Infinity : (stepX > 0 ? (cx + 1) * cell - from.x : from.x - cx * cell) / absDx;
  let nextY = stepY === 0 ? Infinity : (stepY > 0 ? (cy + 1) * cell - from.y : from.y - cy * cell) / absDy;
  const deltaX = stepX === 0 ? Infinity : cell / absDx;
  const deltaY = stepY === 0 ? Infinity : cell / absDy;
  const maxSteps = grid.cols + grid.rows + 2;

  for (let step = 0; step < maxSteps && (cx !== endCx || cy !== endCy); step++) {
    if (nextX < nextY) {
      cx += stepX;
      nextX += deltaX;
    } else {
      cy += stepY;
      nextY += deltaY;
    }

    if (blockedAtCell(grid, cx, cy)) return false;
  }

  return true;
}

/** Center of the closest walkable cell, for a goal inside a wall or an entity a wall was built on top of. */
export function nearestOpenPoint(grid: NavGrid, x: number, y: number, maxRingCells = 24): Position | null {
  const cell = grid.cellSize;
  const originCx = Math.floor(x / cell);
  const originCy = Math.floor(y / cell);

  if (!blockedAtCell(grid, originCx, originCy)) return { x, y };

  for (let ring = 1; ring <= maxRingCells; ring++) {
    let best: Position | null = null;
    let bestDistSq = Infinity;

    for (let offsetY = -ring; offsetY <= ring; offsetY++) {
      for (let offsetX = -ring; offsetX <= ring; offsetX++) {
        // Only the ring's rim: the inside was already covered by a smaller ring.
        if (Math.abs(offsetX) !== ring && Math.abs(offsetY) !== ring) continue;

        const cx = originCx + offsetX;
        const cy = originCy + offsetY;
        if (blockedAtCell(grid, cx, cy)) continue;

        const px = (cx + 0.5) * cell;
        const py = (cy + 0.5) * cell;
        const distSq = (px - x) * (px - x) + (py - y) * (py - y);

        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { x: px, y: py };
        }
      }
    }

    if (best) return best;
  }

  return null;
}

/**
 * First open cell on the way back from `target` to `origin`. Used when an order points inside a
 * solid: relocating toward whoever is walking keeps the straight line to the new goal clear, which
 * is what stops a crowd converging on a solid from re-pathing every frame.
 */
export function openPointToward(grid: NavGrid, target: Position, origin: Position): Position | null {
  const dx = origin.x - target.x;
  const dy = origin.y - target.y;
  const span = Math.hypot(dx, dy);
  if (span === 0) return null;

  const step = grid.cellSize * 0.5;
  const steps = Math.ceil(span / step);

  for (let index = 1; index <= steps; index++) {
    const travelled = Math.min(index * step, span);
    const x = target.x + (dx / span) * travelled;
    const y = target.y + (dy / span) * travelled;

    if (!isBlockedAt(grid, x, y)) return { x, y };
  }

  return null;
}

function ensureScratch(grid: NavGrid): NavScratch {
  if (grid.scratch) return grid.scratch;

  const size = grid.cols * grid.rows;
  grid.scratch = {
    gScore: new Float64Array(size),
    fScore: new Float64Array(size),
    cameFrom: new Int32Array(size),
    seenIn: new Int32Array(size),
    closed: new Uint8Array(size),
    run: 0,
  };

  return grid.scratch;
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);

  // Octile: the exact cost of an unobstructed 8-direction walk, so A* never overestimates.
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** Waypoints from `from` to `to`, cell centers except for the final point. Null when unreachable. */
export function findPath(grid: NavGrid, from: Position, to: Position, maxExpansions = DEFAULT_MAX_EXPANSIONS): Position[] | null {
  if (segmentIsClear(grid, from, to)) return [{ x: to.x, y: to.y }];

  const goal = nearestOpenPoint(grid, to.x, to.y);
  if (!goal) return null;

  const cell = grid.cellSize;
  const cols = grid.cols;
  const startCx = Math.floor(from.x / cell);
  const startCy = Math.floor(from.y / cell);
  const goalCx = Math.floor(goal.x / cell);
  const goalCy = Math.floor(goal.y / cell);

  if (startCx < 0 || startCy < 0 || startCx >= cols || startCy >= grid.rows) return null;

  const startIndex = startCy * cols + startCx;
  const goalIndex = goalCy * cols + goalCx;
  if (startIndex === goalIndex) return [{ x: goal.x, y: goal.y }];

  const scratch = ensureScratch(grid);
  const run = ++scratch.run;
  const { gScore, fScore, cameFrom, seenIn, closed } = scratch;
  const open: number[] = [];

  gScore[startIndex] = 0;
  fScore[startIndex] = heuristic(startCx, startCy, goalCx, goalCy);
  cameFrom[startIndex] = -1;
  seenIn[startIndex] = run;
  closed[startIndex] = 0;
  heapPush(open, fScore, startIndex);

  let expansions = 0;

  while (open.length > 0) {
    const current = heapPop(open, fScore);

    if (current === goalIndex) return buildWaypoints(grid, cameFrom, current, startIndex, from, goal);
    if (closed[current] === 1) continue;

    closed[current] = 1;
    if (++expansions > maxExpansions) return null;

    const cx = current % cols;
    const cy = (current - cx) / cols;

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue;

        const nx = cx + offsetX;
        const ny = cy + offsetY;
        if (blockedAtCell(grid, nx, ny)) continue;

        // No corner cutting: a diagonal needs both orthogonal neighbours open, or the entity clips
        // the corner of a wall it should have walked around.
        if (offsetX !== 0 && offsetY !== 0) {
          if (blockedAtCell(grid, cx + offsetX, cy) || blockedAtCell(grid, cx, cy + offsetY)) continue;
        }

        const neighbour = ny * cols + nx;
        if (seenIn[neighbour] === run && closed[neighbour] === 1) continue;

        const stepCost = offsetX !== 0 && offsetY !== 0 ? SQRT2 : 1;
        const tentative = gScore[current]! + stepCost;

        if (seenIn[neighbour] === run && tentative >= gScore[neighbour]!) continue;

        seenIn[neighbour] = run;
        closed[neighbour] = 0;
        gScore[neighbour] = tentative;
        fScore[neighbour] = tentative + heuristic(nx, ny, goalCx, goalCy);
        cameFrom[neighbour] = current;
        heapPush(open, fScore, neighbour);
      }
    }
  }

  return null;
}

function buildWaypoints(
  grid: NavGrid,
  cameFrom: Int32Array,
  goalIndex: number,
  startIndex: number,
  from: Position,
  goal: Position,
): Position[] {
  const cell = grid.cellSize;
  const reversed: Position[] = [];

  for (let index = goalIndex; index !== -1 && index !== startIndex; index = cameFrom[index]!) {
    const cx = index % grid.cols;
    const cy = (index - cx) / grid.cols;

    reversed.push({ x: (cx + 0.5) * cell, y: (cy + 0.5) * cell });
  }

  reversed.reverse();
  if (reversed.length > 0) reversed[reversed.length - 1] = { x: goal.x, y: goal.y };

  return smoothPath(grid, from, reversed);
}

/**
 * Drops every waypoint the entity can see past. A raw grid path is a staircase; without this the
 * movement reads as walking around invisible corners.
 */
export function smoothPath(grid: NavGrid, from: Position, waypoints: Position[]): Position[] {
  if (waypoints.length < 2) return waypoints;

  const smoothed: Position[] = [];
  let anchor = from;

  for (let index = 0; index < waypoints.length; index++) {
    if (segmentIsClear(grid, anchor, waypoints[index]!)) continue;

    // Consecutive waypoints are adjacent open cells, so the fallback is always reachable from here.
    anchor = index === 0 ? waypoints[0]! : waypoints[index - 1]!;
    smoothed.push(anchor);
  }

  const last = waypoints[waypoints.length - 1]!;
  if (smoothed[smoothed.length - 1] !== last) smoothed.push(last);

  return smoothed;
}

function heapPush(heap: number[], fScore: Float64Array, index: number) {
  heap.push(index);
  let child = heap.length - 1;

  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (fScore[heap[parent]!]! <= fScore[heap[child]!]!) break;

    const swap = heap[parent]!;
    heap[parent] = heap[child]!;
    heap[child] = swap;
    child = parent;
  }
}

function heapPop(heap: number[], fScore: Float64Array): number {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return top;

  heap[0] = last;
  let parent = 0;

  for (;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let smallest = parent;

    if (left < heap.length && fScore[heap[left]!]! < fScore[heap[smallest]!]!) smallest = left;
    if (right < heap.length && fScore[heap[right]!]! < fScore[heap[smallest]!]!) smallest = right;
    if (smallest === parent) break;

    const swap = heap[parent]!;
    heap[parent] = heap[smallest]!;
    heap[smallest] = swap;
    parent = smallest;
  }

  return top;
}
