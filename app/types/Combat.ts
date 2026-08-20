export interface Position {
  x: number;
  y: number;
}

/**
 * Structural contract shared by Unit and Enemy — not an extends/implements
 * relationship, just matching field names so combat code can operate on either.
 */
export interface Combatant {
  id: string;
  position: Position;
  health: number;
  maxHealth: number;
  /** Flat power stat; each action adds `scaling`% of it to its dice roll. */
  attack: number;
  /** Armor points, converted to a damage reduction with diminishing returns — see damageMultiplierFor. */
  defense: number;
  combatRange: number;
  actionIds: string[];
  actionCooldowns: Record<string, number>;
  actionLock?: ActionLock;
  combatTargetId?: string;
  combatTargetIsStructure?: boolean;
  /** Active damage-over-time. Ticked in its own pass, since unarmed units skip processCombatant. */
  poison?: { remainingMs: number; damagePerSecond: number };
}

export interface ActionLock {
  actionId: string;
  targetId: string;
  targetIsStructure: boolean;
  elapsedMs: number;
  impactApplied: boolean;
  /** Where the attacker stood when the action started — a charge sweeps the line back to here. */
  origin?: Position;
}

export type ActionVfx = "thrust" | "slash" | "arrow" | "bombArrow" | "bite" | "magicRay";

export interface ActionDefinition {
  id: string;
  label: string;
  kind: "melee" | "ranged";
  /** Base damage as a pure dice roll, no flat bonus — "2d10", "4d6". */
  damage: string;
  /** Percent of the attacker's attack stat added to the dice roll. 100 = the full stat. */
  scaling: number;
  critChance: number;
  critMultiplier: number;
  cooldownMs: number;
  animationMs: number;
  /** When within the animation the damage actually lands (<= animationMs). */
  impactMs: number;
  minRange: number;
  maxRange: number;
  vfx: ActionVfx;
  /** Area-of-effect radius, bombArrow only. */
  aoeRadius?: number;
  /**
   * Melee dash: the attacker closes on its target during the wind-up, then hits everything within
   * `radius` of the line it travelled. Damage lands on hostiles only; the shove hits everyone.
   */
  charge?: { radius: number; pushDistance: number };
  /** Leaves damage-over-time on whatever this action hits. */
  poison?: { durationMs: number; damagePerSecond: number };
  /** Random-pick weight among off-cooldown, in-range actions. Default 1. */
  weight?: number;
}

export interface LootDrop {
  type: string;
  chance: number;
  amount: [number, number];
}

export interface EffectSpec {
  id: string;
  kind: ActionVfx | "damageNumber" | "gatherNumber";
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  amount?: number;
  crit?: boolean;
  durationMs: number;
  /** gatherNumber only — icon shown next to the "+amount" text. */
  iconName?: string;
  /** Small random horizontal jitter so simultaneous pops at the same spot don't perfectly overlap. */
  offsetX?: number;
}
