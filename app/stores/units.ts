import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { UnitType, type Unit, type Position } from "@/types/Unit";
import unitDefs from "@/data/unitDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useInventoryStore } from "./inventory";
import { useSelectionStore } from "./selection";
import { isInWater } from "@/utils/geometry";

const TARGET_FRAME_TIME = 1000 / 60;

// Must match FULL_DAY_MS_AT_X1 in time.ts
const FULL_DAY_GAME_MS = 180_000;

type UnitDefKey = keyof typeof unitDefs;

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
    reproductionTimeHours: def.reproductionTimeHours,
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

  /** Cancel reproduction — unit exits the fort immediately at its entrance. */
  function cancelReproduction(unitId: string) {
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

      // Heal: 1% maxHealth per game hour
      const healPerMs = unit.maxHealth / (100 * (FULL_DAY_GAME_MS / 24));
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
      const scatterRadius = 40;
      unitIds.forEach((id) => {
        const unit = units.value.get(id);
        if (unit) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * scatterRadius;
          units.value.set(id, {
            ...unit,
            targetPosition: {
              x: resource.position.x + Math.cos(angle) * dist,
              y: resource.position.y + Math.sin(angle) * dist,
            },
            targetResource: resourceId,
            gatherProgress: 0,
          });
        }
      });
    }
  }

  function updateUnitPositions(gameDeltaMs: number) {
    const resourceStore = useResourceStore();
    const inventoryStore = useInventoryStore();
    const deltaMultiplier = gameDeltaMs / TARGET_FRAME_TIME;
    const lakesCache = worldStore.allLakes;

    for (const unit of units.value.values()) {
      // Skip units inside a fort
      if (unit.insideFortId) continue;

      if (unit.targetResource) {
        const resource = resourceStore.getResource(unit.targetResource);
        if (!resource) {
          units.value.set(unit.id, {
            ...unit,
            targetResource: undefined,
            targetPosition: undefined,
            gatherProgress: undefined,
          });
          continue;
        }

        const dx = resource.position.x - unit.position.x;
        const dy = resource.position.y - unit.position.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 50 * 50) {
          const gatherRate = (unit.efficiency / resource.gatherTime) * deltaMultiplier;
          const newProgress = (unit.gatherProgress || 0) + gatherRate;

          if (newProgress >= 1) {
            const depleted = resourceStore.depleteResource(unit.targetResource, 1);
            inventoryStore.addResource(resource.type, 1);

            if (depleted) {
              units.value.set(unit.id, {
                ...unit,
                targetResource: undefined,
                targetPosition: undefined,
                gatherProgress: undefined,
              });
            } else {
              units.value.set(unit.id, { ...unit, gatherProgress: 0 });
            }
          } else {
            units.value.set(unit.id, { ...unit, gatherProgress: newProgress });
          }
          continue;
        }
      }

      if (!unit.targetPosition) continue;

      const dx = unit.targetPosition.x - unit.position.x;
      const dy = unit.targetPosition.y - unit.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        unit.position.x = unit.targetPosition.x;
        unit.position.y = unit.targetPosition.y;
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
    cancelReproduction,
    updateFortUnits,
    moveUnitsTo,
    gatherResource,
    updateUnitPositions,
    initialize,
    pendingReproduction,
    startPendingReproduction,
    clearPendingReproduction,
  };
});
