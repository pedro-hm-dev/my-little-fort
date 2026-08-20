import type { ActionLock } from "@/types/Combat";

export interface Unit {
  id: string;
  type: UnitType;
  position: Position;
  targetPosition?: Position;
  targetResource?: string;
  gatherProgress?: number;
  /** Remaining resource ids to gather in order, after targetResource, from a "gather all" command. */
  gatherQueue?: string[];
  /** Structure this unit is walking toward to take shelter in; consumed on arrival. */
  shelterTargetId?: string;
  health: number;
  maxHealth: number;
  iconName: string;
  iconBaseSize: number;
  iconSize: number;
  baseSpeed: number;
  speed: number;
  baseSwimSpeed: number;
  swimSpeed: number;
  efficiency: number;
  baseEfficiency: number;
  foodPerDay: number;
  /** Went unfed at the last day rollover — losing health each day until it eats again. */
  starving?: boolean;
  /** A working animal: never attacks, never fights back, bolts when hit. */
  passive?: boolean;
  /** Currently running from something that hit it — cosmetic, cleared on arrival. */
  fleeing?: boolean;
  reproductionTimeHours: number;
  // Fort state
  insideFortId?: string;
  reproductionProgress?: number;
  reproductionTargetType?: UnitType;
  // Combat state (Combatant contract — see types/Combat.ts)
  attack: number;
  defense: number;
  combatRange: number;
  actionIds: string[];
  actionCooldowns: Record<string, number>;
  actionLock?: ActionLock;
  combatTargetId?: string;
  combatTargetIsStructure?: boolean;
  /** Active damage-over-time. Ticked in its own pass, since unarmed units skip processCombatant. */
  poison?: { remainingMs: number; damagePerSecond: number };
  /** Remaining enemy ids to engage in order, after combatTargetId, from an area-attack command. */
  combatQueue?: string[];
}

export enum UnitType {
  Worker = "worker",
  Soldier = "soldier",
  Archer = "archer",
  Hunter = "hunter",
  Miner = "miner",
  Capybara = "capybara",
}

export interface Position {
  x: number;
  y: number;
}
