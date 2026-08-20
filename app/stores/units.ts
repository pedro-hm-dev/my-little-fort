import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { UnitType, type Unit, type Position } from "@/types/Unit";
import type { Structure } from "@/types/Structure";
import type { Enemy } from "@/types/Enemy";
import { RESOURCE_ICONS, type Resource } from "@/types/Resource";
import unitDefs from "@/data/unitDefinitions.json";
import structureDefs from "@/data/structureDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useInventoryStore } from "./inventory";
import { useSelectionStore } from "./selection";
import { useEnemyStore } from "./enemies";
import { useEffectsStore } from "./effects";
import { isInWater, distance, approachPoint, evenlySpacedAngles } from "@/utils/geometry";
import { combatRangeFor } from "@/utils/combatEngine";
import actionDefs from "@/data/actionDefinitions.json";
import type { ActionDefinition } from "@/types/Combat";

const TARGET_FRAME_TIME = 1000 / 60;

// Must match FULL_DAY_MS_AT_X1 in time.ts
const FULL_DAY_GAME_MS = 300_000;

/** How far around a resource a gathering unit stands, so a group rings it instead of stacking on top. */
const GATHER_STANDOFF_RADIUS = 35;

type UnitDefKey = keyof typeof unitDefs;
const ACTION_DEFS = actionDefs as unknown as Record<string, ActionDefinition>;

let unitIdCounter = 100;

function spawnUnit(type: UnitType, position: Position): Unit {
  const def = unitDefs[type as UnitDefKey];
  return {
    id: `${type}-${++unitIdCounter}`,
    type,
    position: { ...position },
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    iconName: def.iconName,
    iconBaseSize: def.iconBaseSize,
    iconSize: def.iconSize,
    baseSpeed: def.baseSpeed,
    speed: def.speed,
    baseSwimSpeed: def.baseSwimSpeed,
    swimSpeed: def.swimSpeed,
    baseEfficiency: def.baseEfficiency,
    efficiency: def.efficiency,
    foodPerDay: def.foodPerDay,
    passive: (def as { passive?: boolean }).passive ?? false,
    reproductionTimeHours: def.reproductionTimeHours,
    attack: def.attack,
    defense: def.defense,
    actionIds: (def as { actionIds?: string[] }).actionIds ?? [],
    combatRange: combatRangeFor((def as { actionIds?: string[] }).actionIds ?? [], ACTION_DEFS),
    actionCooldowns: {},
  };
}

function createInitialState(): Unit[] {
  const structureStore = useStructureStore();
  const fort = structureStore.getStructure("fort-1");

  if (!fort) throw new Error("Fort must be initialized before units");

  const fx = fort.position.x;
  const fy = fort.position.y;

  const make = (type: UnitType, x: number, y: number, id: string): Unit => ({
    ...spawnUnit(type, { x, y }),
    id,
  });

  return [
    make(UnitType.Worker,  fx - 80,  fy - 80,  "worker-1"),
    make(UnitType.Worker,  fx + 80,  fy - 80,  "worker-2"),
    make(UnitType.Worker,  fx - 80,  fy + 80,  "worker-3"),
    make(UnitType.Worker,  fx + 80,  fy + 80,  "worker-4"),
    make(UnitType.Soldier, fx,       fy - 110, "soldier-1"),
    make(UnitType.Archer,  fx + 110, fy,       "archer-1"),
    make(UnitType.Hunter,  fx - 110, fy,       "hunter-1"),
  ];
}

export const useUnitStore = defineStore("units", () => {
  const units = ref<Map<string, Unit>>(new Map());
  const worldStore = useWorldStore();

  const pendingReproduction = ref<{ fortId: string; targetType: UnitType } | null>(null);

  function startPendingReproduction(fortId: string, targetType: UnitType) {
    pendingReproduction.value = { fortId, targetType };
  }

  function clearPendingReproduction() {
    pendingReproduction.value = null;
  }

  /** All units including those inside a fort */
  const allUnits = computed(() => Array.from(units.value.values()));

  /** Only units present on the map (not inside a fort) */
  const mapUnits = computed(() => allUnits.value.filter((u) => !u.insideFortId));

  /** Units currently inside a specific fort */
  function unitsInsideFort(fortId: string): Unit[] {
    return allUnits.value.filter((u) => u.insideFortId === fortId);
  }

  function addUnit(unit: Unit) {
    units.value.set(unit.id, unit);
  }

  function removeUnit(id: string) {
    units.value.delete(id);
  }

  function getUnit(id: string): Unit | undefined {
    return units.value.get(id);
  }

  function updateUnit(id: string, updates: Partial<Unit>) {
    const unit = units.value.get(id);
    if (unit) units.value.set(id, { ...unit, ...updates });
  }

  /** Send a selected map unit into the fort to reproduce, creating a new unit of targetType. */
  function startReproduction(unitId: string, targetType: UnitType, fortId: string) {
    const unit = units.value.get(unitId);
    const selectionStore = useSelectionStore();
    if (!unit || unit.insideFortId) return;

    const structureStore = useStructureStore();
    const fort = structureStore.getStructure(fortId);
    if (!fort) return;

    const def = structureDefOf(fort);
    if (structureOccupancy(fortId) >= (def.maxOccupancy ?? Infinity)) return;

    pendingReproduction.value = null;

    selectionStore.deselectUnit(unitId);

    units.value.set(unitId, {
      ...unit,
      insideFortId: fortId,
      reproductionProgress: 0,
      reproductionTargetType: targetType,
      targetPosition: undefined,
      targetResource: undefined,
      gatherProgress: undefined,
    });
  }

  /** Exit the fort immediately at its entrance — cancels any in-progress reproduction too. */
  function exitShelter(unitId: string) {
    const unit = units.value.get(unitId);
    if (!unit || !unit.insideFortId) return;

    const structureStore = useStructureStore();
    const fort = structureStore.getStructure(unit.insideFortId);
    const base = fort ? fort.position : unit.position;

    units.value.set(unitId, {
      ...unit,
      insideFortId: undefined,
      reproductionProgress: undefined,
      reproductionTargetType: undefined,
      position: { x: base.x + 60 + Math.random() * 40, y: base.y + (Math.random() - 0.5) * 80 },
    });
  }

  /**
   * Called every frame with the scaled game delta.
   * Advances reproduction progress and heals units inside forts.
   */
  function updateFortUnits(gameDeltaMs: number) {
    const structureStore = useStructureStore();

    for (const unit of units.value.values()) {
      if (!unit.insideFortId) continue;

      // Heal: 1% maxHealth per game hour — suspended while starving, so shelter can't outheal hunger.
      const healPerMs = unit.starving ? 0 : unit.maxHealth / (100 * (FULL_DAY_GAME_MS / 24));
      const newHealth = Math.min(unit.maxHealth, unit.health + healPerMs * gameDeltaMs);

      // Advance reproduction
      let newProgress = unit.reproductionProgress;
      let complete = false;

      if (newProgress !== undefined && unit.reproductionTargetType !== undefined) {
        const progressPerMs = 1 / (unit.reproductionTimeHours * (FULL_DAY_GAME_MS / 24));
        newProgress = newProgress + progressPerMs * gameDeltaMs;
        if (newProgress >= 1) complete = true;
      }

      if (complete && unit.reproductionTargetType) {
        const fort = structureStore.getStructure(unit.insideFortId);
        const base = fort ? fort.position : unit.position;
        const angle = Math.random() * Math.PI * 2;
        const spawnPos = {
          x: base.x + Math.cos(angle) * (70 + Math.random() * 40),
          y: base.y + Math.sin(angle) * (70 + Math.random() * 40),
        };

        // Spawn new unit
        const newUnit = spawnUnit(unit.reproductionTargetType, spawnPos);
        units.value.set(newUnit.id, newUnit);

        // Original unit exits fort (opposite side from spawn)
        units.value.set(unit.id, {
          ...unit,
          health: newHealth,
          insideFortId: undefined,
          reproductionProgress: undefined,
          reproductionTargetType: undefined,
          position: { x: base.x - Math.cos(angle) * 80, y: base.y - Math.sin(angle) * 80 },
        });
      } else {
        units.value.set(unit.id, { ...unit, health: newHealth, reproductionProgress: newProgress });
      }
    }
  }

  function moveUnitsTo(unitIds: string[], targetX: number, targetY: number) {
    if (unitIds.length === 1) {
      const id = unitIds[0];
      if (!id) return;
      const unit = units.value.get(id);
      if (unit) {
        units.value.set(id, {
          ...unit,
          targetPosition: { x: targetX, y: targetY },
          targetResource: undefined,
          gatherProgress: undefined,
        });
      }
    } else {
      const scatterRadius = 50 + unitIds.length * 15;
      unitIds.forEach((id) => {
        const unit = units.value.get(id);
        if (unit) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * scatterRadius;
          units.value.set(id, {
            ...unit,
            targetPosition: { x: targetX + Math.cos(angle) * dist, y: targetY + Math.sin(angle) * dist },
            targetResource: undefined,
            gatherProgress: undefined,
          });
        }
      });
    }
  }

  function gatherResource(unitIds: string[], resourceId: string) {
    const resourceStore = useResourceStore();
    const resource = resourceStore.getResource(resourceId);
    if (!resource) return;

    if (unitIds.length === 1) {
      const id = unitIds[0];
      if (!id) return;
      const unit = units.value.get(id);
      if (unit) {
        units.value.set(id, {
          ...unit,
          targetPosition: { x: resource.position.x, y: resource.position.y },
          targetResource: resourceId,
          gatherProgress: 0,
        });
      }
    } else {
      const angles = evenlySpacedAngles(unitIds.length);
      unitIds.forEach((id, index) => {
        const unit = units.value.get(id);
        if (unit) {
          const angle = angles[index]!;
          units.value.set(id, {
            ...unit,
            targetPosition: {
              x: resource.position.x + Math.cos(angle) * GATHER_STANDOFF_RADIUS,
              y: resource.position.y + Math.sin(angle) * GATHER_STANDOFF_RADIUS,
            },
            targetResource: resourceId,
            gatherProgress: 0,
          });
        }
      });
    }
  }

  /** Order units to engage an enemy: close to 90% of their combat range, then let the combat store take over.
   * A group spreads around the enemy in a ring (each at its own combat range) instead of converging on one spot. */
  function attackTarget(unitIds: string[], enemyId: string) {
    const enemyStore = useEnemyStore();
    const enemy = enemyStore.getEnemy(enemyId);
    if (!enemy) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (unit.combatRange <= 0 || unit.actionIds.length === 0) return;

      const standoff = unit.combatRange * 0.9;
      const targetPosition = angles
        ? { x: enemy.position.x + Math.cos(angles[index]!) * standoff, y: enemy.position.y + Math.sin(angles[index]!) * standoff }
        : approachPoint(unit.position, enemy.position, standoff);

      units.value.set(id, {
        ...unit,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        shelterTargetId: undefined,
        combatTargetId: enemyId,
        combatTargetIsStructure: false,
        combatQueue: undefined,
        targetPosition,
      });
    });
  }

  /** Queue a set of enemies (e.g. from an area selection) for each unit, nearest first, and engage the closest.
   * A group spreads around its (usually shared) nearest enemy in a ring instead of converging on one spot. */
  function attackArea(unitIds: string[], enemyIds: string[]) {
    const enemyStore = useEnemyStore();
    const enemies = enemyIds.map((id) => enemyStore.getEnemy(id)).filter((e): e is Enemy => !!e);
    if (enemies.length === 0) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (unit.combatRange <= 0 || unit.actionIds.length === 0) return;

      const sorted = [...enemies].sort(
        (a, b) => distance(unit.position, a.position) - distance(unit.position, b.position),
      );
      const [first, ...rest] = sorted;
      if (!first) return;

      const standoff = unit.combatRange * 0.9;
      const targetPosition = angles
        ? { x: first.position.x + Math.cos(angles[index]!) * standoff, y: first.position.y + Math.sin(angles[index]!) * standoff }
        : approachPoint(unit.position, first.position, standoff);

      units.value.set(id, {
        ...unit,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        shelterTargetId: undefined,
        combatTargetId: first.id,
        combatTargetIsStructure: false,
        combatQueue: rest.map((e) => e.id),
        targetPosition,
      });
    });
  }

  /** Pops the next reachable resource off a unit's gather queue, or clears gathering state if none remain. */
  function nextGatherState(gatherQueue: string[] | undefined): Partial<Unit> {
    const resourceStore = useResourceStore();
    const queue = gatherQueue ? [...gatherQueue] : [];

    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) continue;

      const resource = resourceStore.getResource(nextId);
      if (resource) {
        // No sibling-unit context here (this runs per-unit as its own queue advances), so just a
        // random offset rather than a full ring — still keeps it off the resource's exact center.
        const angle = Math.random() * Math.PI * 2;
        return {
          targetResource: nextId,
          targetPosition: {
            x: resource.position.x + Math.cos(angle) * GATHER_STANDOFF_RADIUS,
            y: resource.position.y + Math.sin(angle) * GATHER_STANDOFF_RADIUS,
          },
          gatherProgress: 0,
          gatherQueue: queue.length > 0 ? queue : undefined,
        };
      }
    }

    return { targetResource: undefined, targetPosition: undefined, gatherProgress: undefined, gatherQueue: undefined };
  }

  /** Queue a set of resources (e.g. from an area selection) for each unit, nearest first, and start gathering.
   * A group rings its (usually shared) nearest resource instead of every unit stacking on the exact same spot. */
  function gatherResources(unitIds: string[], resourceIds: string[]) {
    const resourceStore = useResourceStore();
    const resources = resourceIds.map((id) => resourceStore.getResource(id)).filter((r): r is Resource => !!r);
    if (resources.length === 0) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;

      const sorted = [...resources].sort(
        (a, b) => distance(unit.position, a.position) - distance(unit.position, b.position),
      );
      const [first, ...rest] = sorted;
      if (!first) return;

      const targetPosition = angles
        ? {
            x: first.position.x + Math.cos(angles[index]!) * GATHER_STANDOFF_RADIUS,
            y: first.position.y + Math.sin(angles[index]!) * GATHER_STANDOFF_RADIUS,
          }
        : { ...first.position };

      units.value.set(id, {
        ...unit,
        combatTargetId: undefined,
        combatTargetIsStructure: undefined,
        combatQueue: undefined,
        shelterTargetId: undefined,
        targetPosition,
        targetResource: first.id,
        gatherProgress: 0,
        gatherQueue: rest.map((r) => r.id),
      });
    });
  }

  /** Queue every resource currently on the map for each unit, nearest first, and start gathering. */
  function gatherAll(unitIds: string[]) {
    const resourceStore = useResourceStore();
    gatherResources(unitIds, resourceStore.allResources.map((r) => r.id));
  }

  /** Definition of a structure's type, for capacity/eligibility lookups. */
  function structureDefOf(structure: Structure) {
    return structureDefs[structure.type as keyof typeof structureDefs] as {
      canReproduce?: string[];
      maxOccupancy?: number;
    };
  }

  /** Units currently occupying a structure: already inside it, plus those already walking toward it to shelter. */
  function structureOccupancy(structureId: string): number {
    return allUnits.value.filter((u) => u.insideFortId === structureId || u.shelterTargetId === structureId).length;
  }

  /** Send units to take shelter inside a specific structure, skipping any that don't fit or that it doesn't have room for. */
  function shelterUnitsAt(unitIds: string[], structureId: string) {
    const structureStore = useStructureStore();
    const structure = structureStore.getStructure(structureId);
    if (!structure) return;

    const def = structureDefOf(structure);
    const maxOccupancy = def.maxOccupancy ?? Infinity;
    let occupancy = structureOccupancy(structureId);

    unitIds.forEach((id) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (!def.canReproduce?.includes(unit.type)) return;
      if (occupancy >= maxOccupancy) return;

      occupancy++;

      units.value.set(id, {
        ...unit,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        combatTargetId: undefined,
        combatTargetIsStructure: undefined,
        shelterTargetId: structure.id,
        targetPosition: { ...structure.position },
      });
    });
  }

  function updateUnitPositions(gameDeltaMs: number) {
    const resourceStore = useResourceStore();
    const inventoryStore = useInventoryStore();
    const effectsStore = useEffectsStore();
    const deltaMultiplier = gameDeltaMs / TARGET_FRAME_TIME;
    const lakesCache = worldStore.allWaterBodies;

    for (const unit of units.value.values()) {
      // Skip units inside a fort
      if (unit.insideFortId) continue;

      if (unit.targetResource) {
        const resource = resourceStore.getResource(unit.targetResource);
        if (!resource) {
          units.value.set(unit.id, { ...unit, ...nextGatherState(unit.gatherQueue) });
          continue;
        }

        const dx = resource.position.x - unit.position.x;
        const dy = resource.position.y - unit.position.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 50 * 50) {
          const gatherRate = (unit.efficiency / resource.gatherTime) * deltaMultiplier;
          const newProgress = (unit.gatherProgress || 0) + gatherRate;

          if (newProgress >= 1) {
            // A carcass yields whatever loot is left inside it; every other resource yields its own type.
            const collected = resource.contents?.shift() ?? resource.type;
            const depleted = resourceStore.depleteResource(unit.targetResource, 1);

            inventoryStore.addResource(collected, 1);
            effectsStore.spawn({
              kind: "gatherNumber",
              x: unit.position.x,
              y: unit.position.y,
              offsetX: (Math.random() - 0.5) * 20,
              amount: 1,
              iconName: RESOURCE_ICONS[collected] ?? resource.iconName,
              durationMs: 900,
            });

            if (depleted) {
              units.value.set(unit.id, { ...unit, ...nextGatherState(unit.gatherQueue) });
            } else {
              units.value.set(unit.id, { ...unit, gatherProgress: 0 });
            }
          } else {
            units.value.set(unit.id, { ...unit, gatherProgress: newProgress });
          }
          continue;
        }
      }

      // Chase an attack order to 90% of combat range; stand still mid-swing.
      if (unit.combatTargetId && !unit.combatTargetIsStructure && !unit.actionLock) {
        const enemyStore = useEnemyStore();
        const target = enemyStore.getEnemy(unit.combatTargetId);
        if (target) {
          unit.targetPosition = approachPoint(unit.position, target.position, unit.combatRange * 0.9);
        }
      }

      if (!unit.targetPosition) continue;

      const dx = unit.targetPosition.x - unit.position.x;
      const dy = unit.targetPosition.y - unit.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        unit.position.x = unit.targetPosition.x;
        unit.position.y = unit.targetPosition.y;

        if (unit.shelterTargetId) {
          units.value.set(unit.id, { ...unit, insideFortId: unit.shelterTargetId, shelterTargetId: undefined, targetPosition: undefined });
          continue;
        }

        if (unit.fleeing) unit.fleeing = false;
        if (!unit.targetResource) unit.targetPosition = undefined;
      } else {
        const inLake = isInWater(unit.position.x, unit.position.y, lakesCache);
        const effSpeed = inLake ? unit.swimSpeed : unit.speed;
        const frameSpeed = effSpeed * deltaMultiplier;
        const actualSpeed = Math.min(frameSpeed, dist);
        unit.position.x += (dx / dist) * actualSpeed;
        unit.position.y += (dy / dist) * actualSpeed;
      }
    }
  }

  function initialize() {
    units.value.clear();
    for (const unit of createInitialState()) {
      units.value.set(unit.id, unit);
    }
  }

  return {
    units,
    allUnits,
    mapUnits,
    unitsInsideFort,
    addUnit,
    removeUnit,
    getUnit,
    updateUnit,
    startReproduction,
    exitShelter,
    updateFortUnits,
    moveUnitsTo,
    gatherResource,
    gatherResources,
    attackTarget,
    attackArea,
    gatherAll,
    shelterUnitsAt,
    updateUnitPositions,
    initialize,
    pendingReproduction,
    startPendingReproduction,
    clearPendingReproduction,
  };
});
