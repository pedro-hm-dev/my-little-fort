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
  /**
   * Carcass only — the pre-rolled loot inside, one entry per unit of `amount`, shuffled.
   * Gathering pops from here instead of yielding `type`.
   */
  contents?: ResourceType[];
  /** Carcass only — remaining game-time before it rots away. */
  decayRemainingMs?: number;
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
  /** A dead enemy's droppable loot, sitting on the map until gathered or rotted. */
  Carcass = "carcass",
}

/** Icon per resource type, without the `i-game-icons-` prefix. Loot-only types have no resourceDefinitions entry. */
export const RESOURCE_ICONS: Record<ResourceType, string> = {
  [ResourceType.Wood]: "pine-tree",
  [ResourceType.Stone]: "stone-pile",
  [ResourceType.Metal]: "minerals",
  [ResourceType.Gold]: "gold-nuggets",
  [ResourceType.Fish]: "school-of-fish",
  [ResourceType.Mushroom]: "mushrooms",
  [ResourceType.Cactus]: "cactus",
  [ResourceType.Meat]: "meat",
  [ResourceType.Leather]: "animal-hide",
  [ResourceType.Carcass]: "carrion",
};

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
