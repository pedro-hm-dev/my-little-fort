import { BiomeType, type BiomeRegion, type Position } from "@/types/Terrain";
import { outlineBounds, type Bounds } from "@/utils/geometry";

/**
 * Biome generation by rasterized Voronoi.
 *
 * Seeds are jittered across the map, every grid cell takes the biome of its nearest seed (measured
 * through a noise-warped position, so borders come out ragged instead of straight), and adjacent
 * cells of the same biome are then flood-filled into one region. That merge step is what produces
 * concave, irregular polygons rather than the convex blobs the old generator made.
 *
 * Deliberately NOT Lloyd-relaxed: relaxation regularizes cells toward hexagons, which is the look
 * we're moving away from.
 *
 * The grid is kept and returned, because it doubles as the O(1) lookup for "which biome/region is
 * this point in" — with a full partition, every point belongs to some region, so walking polygons
 * per query would be far more expensive than it was when most points fell through to a default.
 */

export interface BiomeMapOptions {
  width: number;
  height: number;
  /** World units per grid cell. Smaller = finer borders, more cells to process. */
  cellSize?: number;
  /** Roughly how many Voronoi seeds; the real count is rounded to a jittered grid. */
  seedCount?: number;
  random: () => number;
  /** Domain warp: displaces the sample position before the nearest-seed test, ragging up borders. */
  warp?: (x: number, y: number) => Position;
  /** Regions smaller than this many cells get absorbed by a neighbour. */
  minRegionCells?: number;
}

export interface BiomeMap {
  regions: BiomeRegion[];
  cols: number;
  rows: number;
  cellSize: number;
  /** Index into `regions` per cell, row-major. Never -1 once generation finishes. */
  regionIndex: Int32Array;
}

/** Relative frequency of each biome among the seeds. Grassland dominates; mountain is scarce. */
const BIOME_WEIGHTS: Array<[BiomeType, number]> = [
  [BiomeType.Grassland, 5],
  [BiomeType.Forest, 3],
  [BiomeType.Desert, 3],
  [BiomeType.Tundra, 2],
  [BiomeType.Mountain, 2],
];

const DEFAULTS = { cellSize: 50, seedCount: 30, minRegionCells: 12 };

function pickBiome(random: () => number): BiomeType {
  const total = BIOME_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;

  for (const [biome, weight] of BIOME_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return biome;
  }

  return BiomeType.Grassland;
}

/** Seeds on a jittered lattice — pure random clusters badly and leaves huge empty stretches. */
function placeSeeds(width: number, height: number, seedCount: number, random: () => number) {
  const columns = Math.max(2, Math.round(Math.sqrt((seedCount * width) / height)));
  const rows = Math.max(2, Math.round(seedCount / columns));
  const cellW = width / columns;
  const cellH = height / rows;
  const seeds: Array<{ x: number; y: number; biome: BiomeType }> = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      seeds.push({
        x: (col + 0.15 + random() * 0.7) * cellW,
        y: (row + 0.15 + random() * 0.7) * cellH,
        biome: pickBiome(random),
      });
    }
  }

  return seeds;
}

/**
 * Traces the outline of one region as a closed ring of its boundary cell edges.
 *
 * Every edge between an inside cell and an outside one is collected, then chained end-to-end. The
 * result is a staircase, which is the intended look — collinear points are collapsed afterwards so
 * a straight run of 10 cells costs 2 vertices instead of 20, which matters because pointInPolygon
 * walks this list.
 */
function traceOutline(cells: Set<number>, cols: number, cellSize: number): Position[] {
  const key = (x: number, y: number) => `${x},${y}`;
  const edges = new Map<string, string[]>();

  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const a = key(ax, ay);
    const b = key(bx, by);
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a)!.push(b);
  };

  for (const index of cells) {
    const cx = index % cols;
    const cy = Math.floor(index / cols);
    const inside = (nx: number, ny: number) => cells.has(ny * cols + nx);

    // Wound consistently so the chain forms a single ring.
    if (!inside(cx, cy - 1)) addEdge(cx, cy, cx + 1, cy);
    if (!inside(cx + 1, cy)) addEdge(cx + 1, cy, cx + 1, cy + 1);
    if (!inside(cx, cy + 1)) addEdge(cx + 1, cy + 1, cx, cy + 1);
    if (!inside(cx - 1, cy)) addEdge(cx, cy + 1, cx, cy);
  }

  // A region can trace more than one ring: an outer boundary plus a hole where another region is
  // embedded. pointInPolygon takes a single ring, so we keep the largest — the outer boundary — and
  // treat the grid as authoritative for containment. See regionAt in stores/world.ts.
  let largest: Position[] = [];
  // Fixed before the walk: `edges.size` shrinks as edges are consumed, and using it as the loop
  // bound truncated every ring at roughly half its length.
  const totalEdges = [...edges.values()].reduce((sum, targets) => sum + targets.length, 0);

  while (edges.size > 0) {
    const start = edges.keys().next().value!;
    const ring: Position[] = [];
    let current: string | undefined = start;

    for (let step = 0; step <= totalEdges && current; step++) {
      const [gx, gy] = current.split(",").map(Number);
      ring.push({ x: gx! * cellSize, y: gy! * cellSize });

      const outgoing = edges.get(current);
      const next = outgoing?.pop();
      if (outgoing && outgoing.length === 0) edges.delete(current);

      if (!next || next === start) break;
      current = next;
    }

    if (ring.length > largest.length) largest = ring;
  }

  return collapseCollinear(largest);
}

function collapseCollinear(ring: Position[]): Position[] {
  if (ring.length < 3) return ring;

  const kept: Position[] = [];

  for (let i = 0; i < ring.length; i++) {
    const previous = ring[(i - 1 + ring.length) % ring.length]!;
    const point = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    const cross = (point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x);

    if (cross !== 0) kept.push(point);
  }

  return kept.length >= 3 ? kept : ring;
}

export function generateBiomeMap(options: BiomeMapOptions): BiomeMap {
  const { width, height, random } = options;
  const cellSize = options.cellSize ?? DEFAULTS.cellSize;
  const seedCount = options.seedCount ?? DEFAULTS.seedCount;
  const minRegionCells = options.minRegionCells ?? DEFAULTS.minRegionCells;
  const warp = options.warp ?? ((x, y) => ({ x, y }));

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const seeds = placeSeeds(width, height, seedCount, random);

  // 1. Nearest seed per cell, sampled through the warp so borders wander.
  const cellBiome = new Uint8Array(cols * rows);
  const biomeList = Object.values(BiomeType);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const worldX = (cx + 0.5) * cellSize;
      const worldY = (cy + 0.5) * cellSize;
      const warped = warp(worldX, worldY);

      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let s = 0; s < seeds.length; s++) {
        const seed = seeds[s]!;
        const dx = warped.x - seed.x;
        const dy = warped.y - seed.y;
        const distance = dx * dx + dy * dy;

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = s;
        }
      }

      cellBiome[cy * cols + cx] = biomeList.indexOf(seeds[bestIndex]!.biome);
    }
  }

  // 2. Flood fill same-biome neighbours into connected regions.
  const regionIndex = new Int32Array(cols * rows).fill(-1);
  const groups: Array<{ biome: BiomeType; cells: Set<number> }> = [];

  for (let start = 0; start < cellBiome.length; start++) {
    if (regionIndex[start] !== -1) continue;

    const biomeCode = cellBiome[start]!;
    const groupId = groups.length;
    const cells = new Set<number>();
    const stack = [start];

    regionIndex[start] = groupId;

    while (stack.length > 0) {
      const index = stack.pop()!;
      cells.add(index);

      const cx = index % cols;
      const cy = Math.floor(index / cols);
      const neighbours = [
        cx > 0 ? index - 1 : -1,
        cx < cols - 1 ? index + 1 : -1,
        cy > 0 ? index - cols : -1,
        cy < rows - 1 ? index + cols : -1,
      ];

      for (const neighbour of neighbours) {
        if (neighbour < 0) continue;
        if (regionIndex[neighbour] !== -1) continue;
        if (cellBiome[neighbour] !== biomeCode) continue;

        regionIndex[neighbour] = groupId;
        stack.push(neighbour);
      }
    }

    groups.push({ biome: biomeList[biomeCode]!, cells });
  }

  // 3. Absorb slivers into whichever neighbour touches them most, so the map has no confetti.
  for (let groupId = 0; groupId < groups.length; groupId++) {
    const group = groups[groupId]!;
    if (group.cells.size >= minRegionCells || group.cells.size === 0) continue;

    const touching = new Map<number, number>();

    for (const index of group.cells) {
      const cx = index % cols;
      const cy = Math.floor(index / cols);
      for (const neighbour of [
        cx > 0 ? index - 1 : -1,
        cx < cols - 1 ? index + 1 : -1,
        cy > 0 ? index - cols : -1,
        cy < rows - 1 ? index + cols : -1,
      ]) {
        if (neighbour < 0) continue;
        const other = regionIndex[neighbour]!;
        if (other === groupId) continue;
        touching.set(other, (touching.get(other) ?? 0) + 1);
      }
    }

    let bestNeighbour = -1;
    let bestShared = 0;
    for (const [candidate, shared] of touching) {
      if (shared > bestShared && groups[candidate]!.cells.size > 0) {
        bestNeighbour = candidate;
        bestShared = shared;
      }
    }

    if (bestNeighbour === -1) continue;

    for (const index of group.cells) {
      regionIndex[index] = bestNeighbour;
      groups[bestNeighbour]!.cells.add(index);
    }
    group.cells.clear();
  }

  // 4. Build the regions, renumbering so regionIndex points at the final array.
  const regions: BiomeRegion[] = [];
  const remap = new Map<number, number>();
  const perBiomeCount = new Map<BiomeType, number>();

  for (let groupId = 0; groupId < groups.length; groupId++) {
    const group = groups[groupId]!;
    if (group.cells.size === 0) continue;

    const outline = traceOutline(group.cells, cols, cellSize);
    if (outline.length < 3) continue;

    let sumX = 0;
    let sumY = 0;
    for (const index of group.cells) {
      sumX += (index % cols) + 0.5;
      sumY += Math.floor(index / cols) + 0.5;
    }

    // O centróide de uma região côncava (em C, em L) cai fora dela. Como o center é usado para
    // nascer o verme e o ninho dele, precisa ser um ponto de dentro: pegamos a célula da região
    // mais próxima do centróide.
    const centroidX = sumX / group.cells.size;
    const centroidY = sumY / group.cells.size;
    let centerCell = -1;
    let centerDistance = Infinity;

    for (const index of group.cells) {
      const dx = (index % cols) + 0.5 - centroidX;
      const dy = Math.floor(index / cols) + 0.5 - centroidY;
      const candidate = dx * dx + dy * dy;

      if (candidate < centerDistance) {
        centerDistance = candidate;
        centerCell = index;
      }
    }

    const center: Position = {
      x: ((centerCell % cols) + 0.5) * cellSize,
      y: (Math.floor(centerCell / cols) + 0.5) * cellSize,
    };
    const bounds: Bounds = outlineBounds(outline);
    const radius = Math.max(
      ...outline.map((point) => Math.hypot(point.x - center.x, point.y - center.y)),
    );
    const ordinal = perBiomeCount.get(group.biome) ?? 0;
    perBiomeCount.set(group.biome, ordinal + 1);

    remap.set(groupId, regions.length);
    regions.push({
      id: `${group.biome}-${ordinal}`,
      biome: group.biome,
      center,
      radius,
      outline,
      bounds,
      cellCount: group.cells.size,
    });
  }

  for (let index = 0; index < regionIndex.length; index++) {
    regionIndex[index] = remap.get(regionIndex[index]!) ?? 0;
  }

  return { regions, cols, rows, cellSize, regionIndex };
}

/**
 * O(1) region lookup through the grid — the reason the grid is kept after generation.
 * Returns -1 outside the map: clamping to the edge cell would answer "yes, this belongs to the
 * border region" for a point nowhere near it.
 */
export function regionIndexAt(map: BiomeMap, x: number, y: number): number {
  const cx = Math.floor(x / map.cellSize);
  const cy = Math.floor(y / map.cellSize);

  if (cx < 0 || cy < 0 || cx >= map.cols || cy >= map.rows) return -1;

  return map.regionIndex[cy * map.cols + cx] ?? -1;
}
