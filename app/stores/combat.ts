import { defineStore } from "pinia";
import actionDefs from "@/data/actionDefinitions.json";
import enemyDefs from "@/data/enemyDefinitions.json";
import type { ActionDefinition, Combatant, LootDrop } from "@/types/Combat";
import type { Unit } from "@/types/Unit";
import type { Enemy } from "@/types/Enemy";
import { ResourceType } from "@/types/Resource";
import { useUnitStore } from "./units";
import { useEnemyStore } from "./enemies";
import { useStructureStore } from "./structures";
import { useResourceStore } from "./resources";
import { useSelectionStore } from "./selection";
import { useEffectsStore } from "./effects";
import { distance } from "@/utils/geometry";
import { pickAction, rollDamage } from "@/utils/combatEngine";
import { SpatialGrid } from "@/utils/spatialGrid";

const ACTION_DEFS = actionDefs as unknown as Record<string, ActionDefinition>;
type EnemyDefKey = keyof typeof enemyDefs;

// Must match FULL_DAY_MS_AT_X1 in time.ts
const FULL_DAY_GAME_MS = 300_000;

/** A carcass rots away 8 game hours after the kill, so loot on the ground is a window, not a depot. */
const CARCASS_DECAY_MS = (FULL_DAY_GAME_MS / 24) * 8;
const CARCASS_GATHER_TIME = 4;
/** Carcass icon is drawn a bit smaller than the living enemy it came from. */
const CARCASS_ICON_SCALE = 0.8;
const DEFAULT_CORPSE_ICON = "carrion";

interface Target {
  id: string;
  isStructure: boolean;
  position: { x: number; y: number };
  /** Structures have no armor stat, so they always take full damage. */
  defense: number;
}

export const useCombatStore = defineStore("combat", () => {
  // Rebuilt once per frame in updateCombat — avoids the O(units x enemies) linear scan that
  // findUnitTarget/findEnemyTarget/applyImpact's AOE splash would otherwise redo per combatant.
  const unitGrid = new SpatialGrid<Unit>(150);
  const enemyGrid = new SpatialGrid<Enemy>(150);

  function resolveTarget(id: string, isStructure: boolean): Target | null {
    if (isStructure) {
      const s = useStructureStore().getStructure(id);
      return s ? { id, isStructure: true, position: s.position, defense: 0 } : null;
    }

    const u = useUnitStore().getUnit(id);
    if (u) return { id, isStructure: false, position: u.position, defense: u.defense };

    const e = useEnemyStore().getEnemy(id);
    return e ? { id, isStructure: false, position: e.position, defense: e.defense } : null;
  }

  function isAliveById(id: string, isStructure: boolean): boolean {
    if (isStructure) return (useStructureStore().getStructure(id)?.health ?? 0) > 0;
    const health = useUnitStore().getUnit(id)?.health ?? useEnemyStore().getEnemy(id)?.health;
    return (health ?? 0) > 0;
  }

  function findUnitTarget(unit: Unit): Target | null {
    const enemyStore = useEnemyStore();

    // An area-attack order queues the rest of its targets here, nearest first — work through it before
    // falling back to auto-aggro on whatever wanders into range.
    while (unit.combatQueue && unit.combatQueue.length > 0) {
      const nextId = unit.combatQueue.shift();
      const enemy = nextId ? enemyStore.getEnemy(nextId) : undefined;
      if (enemy && enemy.health > 0) {
        return { id: enemy.id, isStructure: false, position: enemy.position, defense: enemy.defense };
      }
    }

    const nearest = enemyGrid.findNearest(unit.position.x, unit.position.y, unit.combatRange);
    return nearest ? { id: nearest.id, isStructure: false, position: nearest.position, defense: nearest.defense } : null;
  }

  function findEnemyTarget(enemy: Enemy): Target | null {
    const { x, y } = enemy.position;
    let prey: Unit | Enemy | null = unitGrid.findNearest(x, y, enemy.combatRange);

    // A hostileToAll enemy has no allies, so rival enemies are prey too — whichever is nearer wins.
    if (enemy.hostileToAll) {
      const rival = enemyGrid.findNearest(x, y, enemy.combatRange, enemy.id);

      if (rival && (!prey || distance(enemy.position, rival.position) < distance(enemy.position, prey.position))) {
        prey = rival;
      }
    }

    if (prey) {
      return { id: prey.id, isStructure: false, position: prey.position, defense: prey.defense };
    }

    if (enemy.behavior === "horde") {
      const fort = useStructureStore().getStructure("fort-1");
      if (fort && distance(enemy.position, fort.position) <= enemy.combatRange) {
        return { id: fort.id, isStructure: true, position: fort.position, defense: 0 };
      }
    }

    return null;
  }

  function applyDamage(target: Target, amount: number) {
    if (target.isStructure) {
      const structureStore = useStructureStore();
      const structure = structureStore.getStructure(target.id);
      if (structure) structureStore.updateStructure(target.id, { health: Math.max(0, structure.health - amount) });
      return;
    }

    const unit = useUnitStore().getUnit(target.id);
    if (unit) {
      unit.health = Math.max(0, unit.health - amount);
      return;
    }

    const enemy = useEnemyStore().getEnemy(target.id);
    if (enemy) enemy.health = Math.max(0, enemy.health - amount);
  }

  /** A hit combatant always turns to fight back — structures can't, and units with no weapon can't either. */
  function retaliate(target: Target, attackerId: string) {
    if (target.isStructure || target.id === attackerId) return;

    const unit = useUnitStore().getUnit(target.id);
    if (unit) {
      if (unit.actionIds.length > 0) {
        unit.combatTargetId = attackerId;
        unit.combatTargetIsStructure = false;
      }
      return;
    }

    const enemy = useEnemyStore().getEnemy(target.id);
    if (enemy && enemy.actionIds.length > 0) {
      enemy.combatTargetId = attackerId;
      enemy.combatTargetIsStructure = false;
    }
  }

  function spawnActionVfx(action: ActionDefinition, attackerPos: { x: number; y: number }, target: Target) {
    const effectsStore = useEffectsStore();

    if (action.vfx === "bombArrow") {
      effectsStore.spawn({
        kind: "arrow",
        x: attackerPos.x,
        y: attackerPos.y,
        targetX: target.position.x,
        targetY: target.position.y,
        durationMs: action.impactMs,
      });
      effectsStore.spawn({ kind: "bombArrow", x: target.position.x, y: target.position.y, durationMs: 550 });
    } else if (action.vfx === "bite") {
      effectsStore.spawn({ kind: "bite", x: target.position.x, y: target.position.y, durationMs: action.animationMs });
    } else {
      effectsStore.spawn({
        kind: action.vfx,
        x: attackerPos.x,
        y: attackerPos.y,
        targetX: target.position.x,
        targetY: target.position.y,
        durationMs: action.kind === "melee" ? action.animationMs : action.impactMs,
      });
    }
  }

  function applyImpact(action: ActionDefinition, attacker: Combatant, target: Target) {
    const effectsStore = useEffectsStore();
    const { amount, crit } = rollDamage(action, attacker.attack, target.defense);

    applyDamage(target, amount);
    retaliate(target, attacker.id);

    if (action.aoeRadius && !target.isStructure) {
      for (const enemy of enemyGrid.queryRadius(target.position.x, target.position.y, action.aoeRadius)) {
        if (enemy.id === target.id) continue;

        const splash = rollDamage(action, attacker.attack, enemy.defense);
        enemy.health = Math.max(0, enemy.health - splash.amount);
        if (enemy.actionIds.length > 0) {
          enemy.combatTargetId = attacker.id;
          enemy.combatTargetIsStructure = false;
        }
      }
    }

    spawnActionVfx(action, attacker.position, target);
    effectsStore.spawn({
      kind: "damageNumber",
      x: target.position.x,
      y: target.position.y,
      offsetX: (Math.random() - 0.5) * 24,
      amount: Math.round(amount),
      crit,
      durationMs: 800,
    });
  }

  function tickCooldowns(combatant: Combatant, gameDeltaMs: number) {
    for (const id of Object.keys(combatant.actionCooldowns)) {
      combatant.actionCooldowns[id] = Math.max(0, (combatant.actionCooldowns[id] ?? 0) - gameDeltaMs);
    }
  }

  function processCombatant(combatant: Combatant, gameDeltaMs: number, findTarget: () => Target | null) {
    tickCooldowns(combatant, gameDeltaMs);

    if (!combatant.combatTargetId || !isAliveById(combatant.combatTargetId, combatant.combatTargetIsStructure ?? false)) {
      const target = findTarget();
      combatant.combatTargetId = target?.id;
      combatant.combatTargetIsStructure = target?.isStructure;
    }

    if (combatant.actionLock) {
      const lock = combatant.actionLock;
      lock.elapsedMs += gameDeltaMs;
      const def = ACTION_DEFS[lock.actionId];

      if (def) {
        if (!lock.impactApplied && lock.elapsedMs >= def.impactMs) {
          lock.impactApplied = true;
          const target = resolveTarget(lock.targetId, lock.targetIsStructure);
          if (target) applyImpact(def, combatant, target);
        }

        if (lock.elapsedMs >= def.animationMs) combatant.actionLock = undefined;
      } else {
        combatant.actionLock = undefined;
      }

      return;
    }

    if (!combatant.combatTargetId) return;

    const target = resolveTarget(combatant.combatTargetId, combatant.combatTargetIsStructure ?? false);
    if (!target) {
      combatant.combatTargetId = undefined;
      return;
    }

    const dist = distance(combatant.position, target.position);
    const action = pickAction(combatant.actionIds, combatant.actionCooldowns, dist, ACTION_DEFS);
    if (!action) return;

    combatant.actionCooldowns[action.id] = action.cooldownMs;
    combatant.actionLock = {
      actionId: action.id,
      targetId: target.id,
      targetIsStructure: target.isStructure,
      elapsedMs: 0,
      impactApplied: false,
    };
  }

  /**
   * Rolls the enemy's loot table into a carcass dropped where it died, instead of teleporting the
   * loot into the inventory — the player has to send someone to gather it before it rots.
   */
  function dropCarcass(enemy: Enemy) {
    const def = enemyDefs[enemy.type as EnemyDefKey] as unknown as
      | { lootTable?: LootDrop[]; corpseIcon?: string }
      | undefined;
    const contents: ResourceType[] = [];

    for (const drop of def?.lootTable ?? []) {
      if (Math.random() > drop.chance) continue;

      const amount = Math.round(drop.amount[0] + Math.random() * (drop.amount[1] - drop.amount[0]));

      for (let item = 0; item < amount; item++) contents.push(drop.type as ResourceType);
    }

    if (contents.length === 0) return;

    // Shuffled so a partial gather yields a mix, not all of the first drop type.
    for (let i = contents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [contents[i], contents[j]] = [contents[j]!, contents[i]!];
    }

    useResourceStore().addResource({
      id: `carcass-${enemy.id}`,
      type: ResourceType.Carcass,
      position: { ...enemy.position },
      amount: contents.length,
      maxAmount: contents.length,
      iconName: def?.corpseIcon ?? DEFAULT_CORPSE_ICON,
      iconSize: Math.round(enemy.iconSize * CARCASS_ICON_SCALE),
      gatherTime: CARCASS_GATHER_TIME,
      possibleTerrainTypes: ["land", "water"],
      contents,
      decayRemainingMs: CARCASS_DECAY_MS,
    });
  }

  /** Called every frame with the scaled game delta, after unit/enemy movement has been applied. */
  function updateCombat(gameDeltaMs: number) {
    if (gameDeltaMs <= 0) return;

    const unitStore = useUnitStore();
    const enemyStore = useEnemyStore();

    // Snapshot once per frame: these are computeds that rebuild whenever a position mutates, and this
    // function walks each of them three times. Iterating the snapshot also makes the removal passes
    // below safe, since they mutate the underlying maps.
    const mapUnits = unitStore.mapUnits;
    const enemies = enemyStore.allEnemies;

    unitGrid.rebuild(mapUnits.filter((unit) => unit.health > 0));
    enemyGrid.rebuild(enemies.filter((enemy) => enemy.health > 0));

    for (const unit of mapUnits) {
      if (unit.actionIds.length === 0) continue;
      processCombatant(unit, gameDeltaMs, () => findUnitTarget(unit));
    }

    for (const enemy of enemies) {
      processCombatant(enemy, gameDeltaMs, () => findEnemyTarget(enemy));
    }

    const selectionStore = useSelectionStore();
    for (const unit of mapUnits) {
      if (unit.health <= 0) {
        selectionStore.deselectUnit(unit.id);
        unitStore.removeUnit(unit.id);
      }
    }

    for (const enemy of enemies) {
      if (enemy.health <= 0) {
        dropCarcass(enemy);
        enemyStore.removeEnemy(enemy.id);
      }
    }
  }

  return { updateCombat };
});
