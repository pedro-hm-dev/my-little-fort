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
  radius: number;
  outline: Position[];
}

export enum BiomeType {
  Grassland = "grassland",
  Forest = "forest",
  Desert = "desert",
  Tundra = "tundra",
  Mountain = "mountain",
}
