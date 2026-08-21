import { ResourceType } from "@/types/Resource";

export interface Structure {
  id: string;
  type: StructureType;
  position: Position;
  health: number;
  maxHealth: number;
  iconName: string;
  iconSize: number;
  /**
   * Present only while this is a building site. A structure under construction draws as a site,
   * holds no occupants and provides neither housing nor storage.
   */
  construction?: Construction;
  /**
   * What this structure is physically holding. Every item in the game lives in one of these — the
   * inventory store is the aggregated view over them, not a pot of its own.
   */
  inventory?: Partial<Record<ResourceType, number>>;
}

export interface Construction {
  /** Still to be delivered to the site, by resource type. Empty means building can start. */
  pending: Partial<Record<ResourceType, number>>;
  /** 0 to 1, advanced by whoever is working the site once `pending` is empty. */
  progress: number;
}

export enum StructureType {
  Fort = "fort",
  House = "house",
  Shelter = "shelter",
  Stockpile = "stockpile",
  Shed = "shed",
  Forge = "forge",
}

/** What a storage structure is willing to hold. Non-edible keeps food out of the open-air stockpile. */
export type StorageKind = "all" | "nonEdible";

export interface Position {
  x: number;
  y: number;
}
