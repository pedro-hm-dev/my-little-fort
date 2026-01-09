import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { UnitType, type Unit } from "@/types/Unit";
import unitDefs from "@/data/unitDefinitions.json";
import { useStructureStore } from "./structures";

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
    },
  ];
}

let initialState: Unit[] = [];

export const useUnitStore = defineStore("units", () => {
  const units = ref<Map<string, Unit>>(new Map());

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
        units.value.set(id, { ...unit, targetPosition: { x: targetX, y: targetY } });
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
          });
        }
      });
    }
  }

  function updateUnitPositions() {
    for (const unit of units.value.values()) {
      if (!unit.targetPosition) continue;

      const dx = unit.targetPosition.x - unit.position.x;
      const dy = unit.targetPosition.y - unit.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 2) {
        // Reached target
        unit.position.x = unit.targetPosition.x;
        unit.position.y = unit.targetPosition.y;
        unit.targetPosition = undefined;
      } else {
        // Move towards target
        const moveX = (dx / distance) * unit.speed;
        const moveY = (dy / distance) * unit.speed;
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
    updateUnitPositions,
    initialize,
  };
});
