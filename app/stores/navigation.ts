import { shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { useCameraStore } from "./camera";
import { useStructureStore, solidRadiusOf } from "./structures";
import { distance, distanceToSegment } from "@/utils/geometry";
import {
  createNavGrid,
  findPath,
  isBlockedAt,
  nearestOpenPoint,
  openPointToward,
  segmentIsClear,
  stampCircle,
  type Footprint,
  type NavGrid,
} from "@/utils/navGrid";
import type { Position } from "@/types/Resource";

const NAV_CELL_SIZE = 32;
/** A* runs per frame at most. Whoever misses the budget holds position and retries next tick. */
const PATHS_PER_FRAME = 6;
/**
 * How far ahead the straight line is checked. Testing all the way to a distant destination costs in
 * proportion to the distance, every frame, for every entity — and buys nothing: an obstacle 2000
 * units away is discovered in plenty of time by the entity that keeps walking toward it.
 */
const LOOKAHEAD = 420;
/** How far a moving target may drift before the cached path stops being worth following. */
const GOAL_DRIFT_TOLERANCE = 64;
const WAYPOINT_ARRIVAL_RADIUS = 12;
/** Cooldown after an unreachable goal, so something walled in doesn't run A* on every frame. */
const PATH_RETRY_MS = 1200;
/** Above this many solid footprints, testing each one costs more than just walking the cells. */
const REJECT_TEST_LIMIT = 24;

/** Both Unit and Enemy satisfy this structurally — the path lives on the entity, not in a side table. */
export interface Navigable {
  position: Position;
  path?: Position[];
  pathGoal?: Position;
  pathRetryMs?: number;
}

export const useNavigationStore = defineStore("navigation", () => {
  const grid = shallowRef<NavGrid | null>(null);
  /** The same footprints the grid was stamped from, for the cheap reject in segmentClear. */
  let solids: Footprint[] = [];
  let pathsThisFrame = 0;
  let watching = false;

  function rebuild() {
    const cameraStore = useCameraStore();
    const next = createNavGrid(cameraStore.mapWidth, cameraStore.mapHeight, NAV_CELL_SIZE);
    const nextSolids: Footprint[] = [];

    // Sites are staked-out ground, not walls: builders have to be able to walk in.
    for (const structure of useStructureStore().readyStructures) {
      const radius = solidRadiusOf(structure.type);
      if (radius <= 0) continue;

      const footprint = { x: structure.position.x, y: structure.position.y, radius };

      stampCircle(next, footprint, true);
      nextSolids.push(footprint);
    }

    solids = nextSolids;
    grid.value = next;
  }

  /**
   * Rebuilds whenever the structure list changes. A full rebuild costs one 24KB allocation plus a
   * stamp per solid structure, and only happens on placement or destruction, never per frame.
   */
  function startWatchingStructures() {
    if (watching) return;
    watching = true;

    const structureStore = useStructureStore();

    watch(() => structureStore.readyStructures, rebuild, { immediate: true });
  }

  function beginFrame() {
    pathsThisFrame = 0;
  }

  function isBlocked(x: number, y: number): boolean {
    return grid.value ? isBlockedAt(grid.value, x, y) : false;
  }

  /**
   * Walking the cells is ~1.6µs for a long segment, and every entity asks once per frame. With few
   * solids it is far cheaper to first check whether any of them is even near the segment.
   */
  function segmentClear(navGrid: NavGrid, from: Position, to: Position): boolean {
    if (solids.length === 0) return true;

    if (solids.length <= REJECT_TEST_LIMIT) {
      let reachable = false;

      for (const solid of solids) {
        if (distanceToSegment(solid, from, to) > solid.radius + navGrid.cellSize) continue;

        reachable = true;
        break;
      }

      if (!reachable) return true;
    }

    return segmentIsClear(navGrid, from, to);
  }

  /** Nearest spot something can actually be stood on or picked up from. */
  function freeSpotNear(position: Position): Position {
    const navGrid = grid.value;
    if (!navGrid || !isBlockedAt(navGrid, position.x, position.y)) return position;

    return nearestOpenPoint(navGrid, position.x, position.y) ?? position;
  }

  function hasLineOfSight(from: Position, to: Position): boolean {
    return grid.value ? segmentClear(grid.value, from, to) : true;
  }

  /** The goal itself when it is close, otherwise a point LOOKAHEAD units along the way to it. */
  function lookaheadToward(from: Position, goal: Position): Position {
    const dx = goal.x - from.x;
    const dy = goal.y - from.y;
    const span = Math.hypot(dx, dy);
    if (span <= LOOKAHEAD || span === 0) return goal;

    return { x: from.x + (dx / span) * LOOKAHEAD, y: from.y + (dy / span) * LOOKAHEAD };
  }

  function clearPath(entity: Navigable) {
    entity.path = undefined;
    entity.pathGoal = undefined;
  }

  /** Consumes waypoints already reached, plus any the entity can now see past, and returns the next one. */
  function advanceAlong(navGrid: NavGrid, entity: Navigable, path: Position[]): Position {
    while (path.length > 1) {
      const reached = distance(entity.position, path[0]!) < WAYPOINT_ARRIVAL_RADIUS;

      if (!reached && !segmentClear(navGrid, entity.position, path[1]!)) break;

      path.shift();
    }

    // Path spent on a goal that had to be relocated — the real destination is walled off, so stop
    // asking for a new path every frame. A path that ended on the goal itself gets no cooldown, or
    // the next order would freeze the entity for a second.
    if (path.length === 1 && distance(entity.position, path[0]!) < 2) {
      const reachedGoal = !entity.pathGoal || distance(path[0]!, entity.pathGoal) < WAYPOINT_ARRIVAL_RADIUS;

      if (!reachedGoal) entity.pathRetryMs = PATH_RETRY_MS;
    }

    return path[0]!;
  }

  /**
   * The point to actually walk toward this frame. With nothing in the way it is `dest` itself, so the
   * cost of navigation on an open map is one grid raycast per entity.
   */
  function routeTo(entity: Navigable, dest: Position, gameDeltaMs: number): Position {
    const navGrid = grid.value;
    if (!navGrid) return dest;

    // A structure raised on top of the entity would trap it forever; shove it to the nearest open cell.
    if (isBlockedAt(navGrid, entity.position.x, entity.position.y)) {
      const escape = nearestOpenPoint(navGrid, entity.position.x, entity.position.y);

      if (escape) {
        entity.position.x = escape.x;
        entity.position.y = escape.y;
      }

      clearPath(entity);
    }

    if (entity.pathRetryMs) entity.pathRetryMs = Math.max(0, entity.pathRetryMs - gameDeltaMs);

    // An order pointing inside a wall becomes an order to its near edge, so the goal is reachable.
    let goal = dest;

    if (isBlockedAt(navGrid, dest.x, dest.y)) {
      const relocated = openPointToward(navGrid, dest, entity.position) ?? nearestOpenPoint(navGrid, dest.x, dest.y);
      if (!relocated) return { x: entity.position.x, y: entity.position.y };

      goal = relocated;
    }

    if (segmentClear(navGrid, entity.position, lookaheadToward(entity.position, goal))) {
      if (entity.path) clearPath(entity);
      if (entity.pathRetryMs) entity.pathRetryMs = 0;

      return goal;
    }

    const cached = entity.path;
    const goalHeld = entity.pathGoal && distance(entity.pathGoal, goal) <= GOAL_DRIFT_TOLERANCE;

    if (cached && cached.length > 0 && goalHeld) return advanceAlong(navGrid, entity, cached);

    // Out of budget or still cooling down: hold position. Returning `dest` here would walk the
    // entity straight through the wall the raycast just found.
    if (entity.pathRetryMs || pathsThisFrame >= PATHS_PER_FRAME) return { x: entity.position.x, y: entity.position.y };

    pathsThisFrame++;
    const path = findPath(navGrid, entity.position, goal);

    if (!path) {
      clearPath(entity);
      entity.pathRetryMs = PATH_RETRY_MS;

      return { x: entity.position.x, y: entity.position.y };
    }

    entity.path = path;
    entity.pathGoal = { x: goal.x, y: goal.y };

    return advanceAlong(navGrid, entity, path);
  }

  return {
    grid,
    rebuild,
    startWatchingStructures,
    beginFrame,
    isBlocked,
    freeSpotNear,
    hasLineOfSight,
    routeTo,
    clearPath,
  };
});
