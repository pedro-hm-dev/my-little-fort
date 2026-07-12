import type { Combatant } from "@/types/Combat";

export interface Enemy extends Combatant {
  type: EnemyType;
  iconName: string;
  iconSize: number;
  speed: number;
  swimSpeed: number;
  behavior: "horde" | "ambient";
  /** Ambient enemies wander around this anchor instead of marching on the fort. */
  homePosition?: Position;
  targetPosition?: Position;
}

export enum EnemyType {
  Raider = "raider",
  RaiderArcher = "raiderArcher",
  Wolf = "wolf",
  Piranha = "piranha",
}

export interface Position {
  x: number;
  y: number;
}
