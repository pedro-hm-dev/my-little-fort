import type { ActionDefinition, Combatant } from "@/types/Combat";
import { distance } from "@/utils/geometry";

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

/** Roll damage in [min, max], applying crit chance/multiplier. Returns the final amount and whether it crit. */
export function rollDamage(action: ActionDefinition): { amount: number; crit: boolean } {
  const [min, max] = action.damage;
  const base = min + Math.random() * (max - min);
  const crit = Math.random() < action.critChance;

  return { amount: crit ? base * action.critMultiplier : base, crit };
}

/** Whether `target` is within `combatant`'s engagement range. */
export function inCombatRange(combatant: Combatant, targetPos: { x: number; y: number }): boolean {
  return distance(combatant.position, targetPos) <= combatant.combatRange;
}
