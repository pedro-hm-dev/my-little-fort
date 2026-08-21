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
  /**
   * Goods that were dropped because every store was full, not something that grew here. An idle
   * unit fetches these back the moment there is room for them again.
   */
  dropped?: boolean;
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
  Algae = "algae",
  WhiteMeat = "whiteMeat",
  Fat = "fat",
  LegendaryFang = "legendaryFang",
  Egg = "egg",
  Poison = "poison",
  PlantFiber = "plantFiber",
  /** A dead enemy's droppable loot, sitting on the map until gathered or rotted. */
  Carcass = "carcass",
}

/** Icon per resource type, without the `i-game-icons-` prefix. Loot-only types have no resourceDefinitions entry. */
export const RESOURCE_ICONS: Record<ResourceType, string> = {
  [ResourceType.Wood]: "pine-tree",
  [ResourceType.Stone]: "stone-pile",
  [ResourceType.Metal]: "minerals",
  [ResourceType.Gold]: "gold-nuggets",
  [ResourceType.Fish]: "fried-fish",
  [ResourceType.Mushroom]: "mushrooms",
  [ResourceType.Cactus]: "cactus",
  [ResourceType.Meat]: "meat",
  [ResourceType.Leather]: "animal-hide",
  [ResourceType.Algae]: "algae",
  [ResourceType.Carcass]: "carrion",
  [ResourceType.WhiteMeat]: "chicken-leg",
  [ResourceType.Fat]: "fat",
  [ResourceType.LegendaryFang]: "bestial-fangs",
  [ResourceType.Egg]: "egg-clutch",
  [ResourceType.Poison]: "poison-bottle",
  [ResourceType.PlantFiber]: "herbs-bundle",
};

/** Resource types units eat — the daily ration comes out of these, see stores/food.ts. */
export const FOOD_RESOURCE_TYPES: ResourceType[] = [
  ResourceType.Fish,
  ResourceType.Mushroom,
  ResourceType.Meat,
  ResourceType.Cactus,
  ResourceType.Algae,
  ResourceType.WhiteMeat,
  ResourceType.Fat,
  ResourceType.Egg,
];

export interface Position {
  x: number;
  y: number;
}

export enum TerrainType {
  Land = "land",
  Water = "water",
}
