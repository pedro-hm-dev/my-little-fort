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
  Food = "food",
  Wood = "wood",
  Stone = "stone",
  Metal = "metal",
  Gold = "gold",
  Meat = "meat",
  Leather = "leather",
}

export interface Position {
  x: number;
  y: number;
}

export enum TerrainType {
  Land = "land",
  Water = "water",
}
