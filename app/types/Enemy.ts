import type { Combatant } from "@/types/Combat";

export interface Enemy extends Combatant {
  type: EnemyType;
  iconName: string;
  iconSize: number;
  speed: number;
  swimSpeed: number;
  /** Confined to water — will not chase a combat target onto land. */
  aquatic?: boolean;
  behavior: "horde" | "ambient";
  /** Ambient enemies wander around this anchor instead of marching on the fort. */
  homePosition?: Position;
  targetPosition?: Position;
  /** Where this enemy stood when it started chasing its current combat target — the leash anchor. */
  combatAnchor?: Position;
  /** combatTargetId the anchor/timer above were captured for; lets us detect a freshly (re)acquired target. */
  combatAnchorTargetId?: string;
  /** Accumulated time spent chasing the current target while still out of weapon range. */
  chaseElapsedMs?: number;
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
