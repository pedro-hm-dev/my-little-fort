import type { ActionDefinition, Combatant } from "@/types/Combat";
import { distance } from "@/utils/geometry";
import { rollDice } from "@/utils/dice";

/**
 * Armor points needed to halve incoming damage. Drives the diminishing-returns curve:
 * each point is worth less than the last, so reduction approaches 100% without reaching it.
 */
const DEFENSE_HALVING_POINT = 100;

/**
 * Pick a random action from `actionIds`, restricted to those currently off
 * cooldown and whose range window covers `targetDist`. Weighted by `weight`
 * (default 1). Returns null if nothing is usable right now.
 */
export function pickAction(
  actionIds: string[],
  cooldowns: Record<string, number>,
  targetDist: number,
  actionDefs: Record<string, ActionDefinition>,
): ActionDefinition | null {
  const usable = actionIds
    .map((id) => actionDefs[id])
    .filter((def): def is ActionDefinition => {
      if (!def) return false;
      if ((cooldowns[def.id] ?? 0) > 0) return false;
      return targetDist >= def.minRange && targetDist <= def.maxRange;
    });

  if (usable.length === 0) return null;

  const totalWeight = usable.reduce((sum, def) => sum + (def.weight ?? 1), 0);
  let roll = Math.random() * totalWeight;

  for (const def of usable) {
    roll -= def.weight ?? 1;
    if (roll <= 0) return def;
  }

  return usable[usable.length - 1]!;
}

/** Fraction of incoming damage that survives `defense` armor points. Never reaches 0. */
export function damageMultiplierFor(defense: number): number {
  return DEFENSE_HALVING_POINT / (DEFENSE_HALVING_POINT + Math.max(0, defense));
}

/** Percent of incoming damage `defense` armor points absorb — for UI. */
export function damageReductionFor(defense: number): number {
  return (1 - damageMultiplierFor(defense)) * 100;
}

/**
 * Roll the action's damage dice, add `scaling`% of the attacker's attack stat, apply crit,
 * then mitigate by the defender's armor. Returns the final amount and whether it crit.
 */
export function rollDamage(
  action: ActionDefinition,
  attackerAttack: number,
  defenderDefense: number,
): { amount: number; crit: boolean } {
  const base = rollDice(action.damage);
  const scaled = base + (attackerAttack * action.scaling) / 100;
  const crit = Math.random() < action.critChance;
  const beforeArmor = crit ? scaled * action.critMultiplier : scaled;

  return { amount: beforeArmor * damageMultiplierFor(defenderDefense), crit };
}

/** Whether `target` is within `combatant`'s engagement range. */
export function inCombatRange(combatant: Combatant, targetPos: { x: number; y: number }): boolean {
  return distance(combatant.position, targetPos) <= combatant.combatRange;
}
