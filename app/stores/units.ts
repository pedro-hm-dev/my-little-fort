import { ref, computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { UnitType, type Unit } from "@/types/Unit";
import unitDefs from "@/data/unitDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useInventoryStore } from "./inventory";
import { isInWater, distance } from "@/utils/geometry";

// Frame timing for smooth movement
let lastUpdateTime = 0;
const TARGET_FRAME_TIME = 1000 / 60; // 60 FPS target

const workerDef = unitDefs.worker;
const soldierDef = unitDefs.soldier;

function createInitialState(): Unit[] {
  const structureStore = useStructureStore();
  const fort = structureStore.getStructure("fort-1");

  if (!fort) {
    throw new Error("Fort must be initialized before units");
  }

  const fortX = fort.position.x;
  const fortY = fort.position.y;

  return [
    {
      id: "worker-1",
      type: UnitType.Worker,
      position: { x: fortX - 80, y: fortY - 80 },
      health: workerDef.maxHealth,
      maxHealth: workerDef.maxHealth,
      iconName: workerDef.iconName,
      iconBaseSize: workerDef.iconBaseSize,
      iconSize: workerDef.iconSize,
      baseSpeed: workerDef.baseSpeed,
      speed: workerDef.speed,
      baseSwimSpeed: workerDef.baseSwimSpeed,
      swimSpeed: workerDef.swimSpeed,
      baseEfficiency: workerDef.baseEfficiency,
      efficiency: workerDef.efficiency,
    },
    {
      id: "worker-2",
      type: UnitType.Worker,
      position: { x: fortX + 80, y: fortY - 80 },
      health: workerDef.maxHealth,
      maxHealth: workerDef.maxHealth,
      iconName: workerDef.iconName,
      iconBaseSize: workerDef.iconBaseSize,
      iconSize: workerDef.iconSize,
      baseSpeed: workerDef.baseSpeed,
      speed: workerDef.speed,
      baseSwimSpeed: workerDef.baseSwimSpeed,
      swimSpeed: workerDef.swimSpeed,
      baseEfficiency: workerDef.baseEfficiency,
      efficiency: workerDef.efficiency,
    },
    {
      id: "worker-3",
      type: UnitType.Worker,
      position: { x: fortX - 80, y: fortY + 80 },
      health: workerDef.maxHealth,
      maxHealth: workerDef.maxHealth,
      iconName: workerDef.iconName,
      iconBaseSize: workerDef.iconBaseSize,
      iconSize: workerDef.iconSize,
      baseSpeed: workerDef.baseSpeed,
      speed: workerDef.speed,
      baseSwimSpeed: workerDef.baseSwimSpeed,
      swimSpeed: workerDef.swimSpeed,
      baseEfficiency: workerDef.baseEfficiency,
      efficiency: workerDef.efficiency,
    },
    {
      id: "worker-4",
      type: UnitType.Worker,
      position: { x: fortX + 80, y: fortY + 80 },
      health: workerDef.maxHealth,
      maxHealth: workerDef.maxHealth,
      iconName: workerDef.iconName,
      iconBaseSize: workerDef.iconBaseSize,
      iconSize: workerDef.iconSize,
      baseSpeed: workerDef.baseSpeed,
      speed: workerDef.speed,
      baseSwimSpeed: workerDef.baseSwimSpeed,
      swimSpeed: workerDef.swimSpeed,
      baseEfficiency: workerDef.baseEfficiency,
      efficiency: workerDef.efficiency,
    },
    {
      id: "soldier-1",
      type: UnitType.Soldier,
      position: { x: fortX, y: fortY - 100 },
      health: soldierDef.maxHealth,
      maxHealth: soldierDef.maxHealth,
      iconName: soldierDef.iconName,
      iconBaseSize: soldierDef.iconBaseSize,
      iconSize: soldierDef.iconSize,
      baseSpeed: soldierDef.baseSpeed,
      speed: soldierDef.speed,
      baseSwimSpeed: soldierDef.baseSwimSpeed,
      swimSpeed: soldierDef.swimSpeed,
      baseEfficiency: soldierDef.baseEfficiency,
      efficiency: soldierDef.efficiency,
    },
  ];
}

let initialState: Unit[] = [];

export const useUnitStore = defineStore("units", () => {
  const units = ref<Map<string, Unit>>(new Map());
  const worldStore = useWorldStore();

  const allUnits = computed(() => Array.from(units.value.values()));

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

    if (unit) {
      units.value.set(id, { ...unit, ...updates });
    }
  }

  function moveUnitsTo(unitIds: string[], targetX: number, targetY: number) {
    if (unitIds.length === 1) {
      // Single unit goes exactly to target
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
      // Multiple units: scatter randomly around target
      const scatterRadius = 50 + unitIds.length * 15;

      unitIds.forEach((id) => {
        const unit = units.value.get(id);

        if (unit) {
          // Random angle and random distance within radius
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * scatterRadius;
          const offsetX = Math.cos(angle) * distance;
          const offsetY = Math.sin(angle) * distance;

          units.value.set(id, {
            ...unit,
            targetPosition: {
              x: targetX + offsetX,
              y: targetY + offsetY,
            },
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

    // Send units to resource position
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
      // Multiple units: scatter around resource
      const scatterRadius = 40;

      unitIds.forEach((id) => {
        const unit = units.value.get(id);

        if (unit) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * scatterRadius;
          const offsetX = Math.cos(angle) * distance;
          const offsetY = Math.sin(angle) * distance;

          units.value.set(id, {
            ...unit,
            targetPosition: {
              x: resource.position.x + offsetX,
              y: resource.position.y + offsetY,
            },
            targetResource: resourceId,
            gatherProgress: 0,
          });
        }
      });
    }
  }

  function updateUnitPositions() {
    const resourceStore = useResourceStore();
    const inventoryStore = useInventoryStore();

    // Calculate delta time for frame-rate independence
    const currentTime = performance.now();
    const deltaTime = lastUpdateTime === 0 ? TARGET_FRAME_TIME : currentTime - lastUpdateTime;
    lastUpdateTime = currentTime;
    const deltaMultiplier = deltaTime / TARGET_FRAME_TIME;

    // Cache lakes reference for this frame
    const lakesCache = worldStore.allLakes;

    for (const unit of units.value.values()) {
      // If unit is gathering a resource
      if (unit.targetResource) {
        const resource = resourceStore.getResource(unit.targetResource);

        // If resource no longer exists, stop gathering
        if (!resource) {
          units.value.set(unit.id, {
            ...unit,
            targetResource: undefined,
            targetPosition: undefined,
            gatherProgress: undefined,
          });
          continue;
        }

        // Check if unit is at the resource location (use faster squared distance)
        const dx = resource.position.x - unit.position.x;
        const dy = resource.position.y - unit.position.y;
        const distSq = dx * dx + dy * dy;
        const gatherRadiusSq = 50 * 50;

        if (distSq < gatherRadiusSq) {
          // Unit is close enough to gather (frame-rate independent)
          const gatherRate = (unit.efficiency / resource.gatherTime) * deltaMultiplier;
          const newProgress = (unit.gatherProgress || 0) + gatherRate;

          if (newProgress >= 1) {
            // Completed gathering 1 unit
            const depleted = resourceStore.depleteResource(unit.targetResource, 1);

            // Add resource to inventory
            inventoryStore.addResource(resource.type, 1);

            if (depleted) {
              // Resource fully depleted
              units.value.set(unit.id, {
                ...unit,
                targetResource: undefined,
                targetPosition: undefined,
                gatherProgress: undefined,
              });
            } else {
              // Continue gathering
              units.value.set(unit.id, {
                ...unit,
                gatherProgress: 0, // Reset progress for next unit
              });
            }
          } else {
            // Update progress
            units.value.set(unit.id, {
              ...unit,
              gatherProgress: newProgress,
            });
          }

          continue;
        }
      }

      // Regular movement
      if (!unit.targetPosition) continue;

      const dx = unit.targetPosition.x - unit.position.x;
      const dy = unit.targetPosition.y - unit.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        // Reached target
        unit.position.x = unit.targetPosition.x;
        unit.position.y = unit.targetPosition.y;

        // Only clear targetPosition if not gathering
        if (!unit.targetResource) {
          unit.targetPosition = undefined;
        }
      } else {
        // Move towards target (frame-rate independent)
        const inLake = isInWater(unit.position.x, unit.position.y, lakesCache);
        const effSpeed = inLake ? unit.swimSpeed : unit.speed;
        const frameSpeed = effSpeed * deltaMultiplier;
        const moveX = (dx / dist) * frameSpeed;
        const moveY = (dy / dist) * frameSpeed;
        unit.position.x += moveX;
        unit.position.y += moveY;
      }
    }
  }

  function initialize() {
    initialState = createInitialState();
    units.value.clear();

    for (const unit of initialState) {
      units.value.set(unit.id, unit);
    }
  }

  return {
    units,
    allUnits,
    addUnit,
    removeUnit,
    getUnit,
    updateUnit,
    moveUnitsTo,
    gatherResource,
    updateUnitPositions,
    initialize,
  };
});
