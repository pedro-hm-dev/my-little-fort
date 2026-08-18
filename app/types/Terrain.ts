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

export enum BiomeType {
  Grassland = "grassland",
  Forest = "forest",
  Desert = "desert",
  Tundra = "tundra",
  Mountain = "mountain",
}
