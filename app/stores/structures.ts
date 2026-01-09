import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { StructureType, type Structure } from "@/types/Structure";
import structureDefs from "@/data/structureDefinitions.json";
import { useCameraStore } from "./camera";

const fortDef = structureDefs.fort;

function getRandomFortPosition(centerX: number, centerY: number): { x: number; y: number } {
  const MAX_DISTANCE = Math.min(centerX, centerY) * 0.5; // 50% of distance from center

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * MAX_DISTANCE;

  const x = centerX + Math.cos(angle) * radius;
  const y = centerY + Math.sin(angle) * radius;

  return { x, y };
}

function createInitialState(): Structure[] {
  const cameraStore = useCameraStore();
  const MAP_CENTER_X = cameraStore.mapWidth / 2;
  const MAP_CENTER_Y = cameraStore.mapHeight / 2;
  const fortPosition = getRandomFortPosition(MAP_CENTER_X, MAP_CENTER_Y);

  return [
    {
      id: "fort-1",
      type: StructureType.Fort,
      position: fortPosition,
      health: fortDef.maxHealth,
      maxHealth: fortDef.maxHealth,
      iconName: fortDef.iconName,
      iconBaseSize: fortDef.iconBaseSize,
      iconSize: fortDef.iconSize,
    },
  ];
}

let initialState: Structure[] = [];

export const useStructureStore = defineStore("structures", () => {
  const structures = ref<Map<string, Structure>>(new Map());

  const allStructures = computed(() => Array.from(structures.value.values()));

  function addStructure(structure: Structure) {
    structures.value.set(structure.id, structure);
  }

  function removeStructure(id: string) {
    structures.value.delete(id);
  }

  function getStructure(id: string): Structure | undefined {
    return structures.value.get(id);
  }

  function updateStructure(id: string, updates: Partial<Structure>) {
    const structure = structures.value.get(id);

    if (structure) {
      structures.value.set(id, { ...structure, ...updates });
    }
  }

  function initialize() {
    initialState = createInitialState();
    structures.value.clear();

    for (const structure of initialState) {
      structures.value.set(structure.id, structure);
    }
  }

  return {
    structures,
    allStructures,
    addStructure,
    removeStructure,
    getStructure,
    updateStructure,
    initialize,
  };
});
