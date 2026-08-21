export interface Position {
  x: number;
  y: number;
}

export interface Lake {
  center: Position;
  radius: number;
  outline: Position[]; // smoothed perimeter points
  /** Centerline samples — only present for rivers, used for cheap distance-to-water-body checks. */
  path?: Position[];
  /** Outline bounding box, precomputed at generation so isInWater can reject without touching vertices. */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  kind?: "lake" | "river";
}

/**
 * One organic blob of a non-Grassland biome on the map. There can be more than one per biome, so the
 * `id` is what lets systems track "this region" — a worm per region, an enemy cap per region.
 */
export interface BiomeRegion {
  /** Stable within a generated world: `${biome}-${n}`, n counting from 0 per biome. */
  id: string;
  biome: BiomeType;
  center: Position;
  /** Distance from `center` to the farthest outline point — a loose bound, not a shape. */
  radius: number;
  outline: Position[];
  /**
   * Outline bounding box. Needed because merged regions are concave: `center` + `radius` can cover
   * half the map and reject nothing, the same trap rivers hit in isInWater (PLANS.md section 9).
   */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Grid cells this region occupies — its area, used to compare region sizes. */
  cellCount?: number;
}

export enum BiomeType {
  Grassland = "grassland",
  Forest = "forest",
  Desert = "desert",
  Tundra = "tundra",
  Mountain = "mountain",
}
