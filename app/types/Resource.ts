export interface Resource {
  id: string;
  type: ResourceType;
  position: Position;
  amount: number;
  maxAmount: number;
  iconName: string;
  iconSize: number;
  gatherTime: number;
  possibleTerrainTypes: string[];
}

export enum ResourceType {
  Wood = "wood",
  Stone = "stone",
  Metal = "metal",
  Gold = "gold",
  Fish = "fish",
  Mushroom = "mushroom",
  Cactus = "cactus",
  Meat = "meat",
  Leather = "leather",
}

/** Resource types units eat — the daily ration comes out of these, see stores/food.ts. */
export const FOOD_RESOURCE_TYPES: ResourceType[] = [
  ResourceType.Fish,
  ResourceType.Mushroom,
  ResourceType.Meat,
  ResourceType.Cactus,
];

export interface Position {
  x: number;
  y: number;
}

export enum TerrainType {
  Land = "land",
  Water = "water",
}
