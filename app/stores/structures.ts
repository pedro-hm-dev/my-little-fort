import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { StructureType, type Structure } from "@/types/Structure";
import structureDefs from "@/data/structureDefinitions.json";
import { useCameraStore } from "./camera";
import { useWorldStore } from "./world";
import { distanceToPolyline } from "@/utils/geometry";

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
  const worldStore = useWorldStore();
  const MAP_CENTER_X = cameraStore.mapWidth / 2;
  const MAP_CENTER_Y = cameraStore.mapHeight / 2;
  let fortPosition = getRandomFortPosition(MAP_CENTER_X, MAP_CENTER_Y);

  // Ensure fort is at least 150 units away from any lake edge or river centerline
  const MIN_DIST = 150;
  const MAX_TRIES = 100;

  for (let tries = 0; tries < MAX_TRIES; tries++) {
    let tooClose = false;

    for (const lake of worldStore.allLakes) {
      const d = Math.hypot(fortPosition.x - lake.center.x, fortPosition.y - lake.center.y);

      if (d <= lake.radius + MIN_DIST) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      for (const river of worldStore.rivers) {
        if (river.path && distanceToPolyline(fortPosition, river.path) <= MIN_DIST) {
          tooClose = true;
          break;
        }
      }
    }

    if (!tooClose) break;

    fortPosition = getRandomFortPosition(MAP_CENTER_X, MAP_CENTER_Y);
  }

  return [
    {
      id: "fort-1",
      type: StructureType.Fort,
      position: fortPosition,
      health: fortDef.maxHealth,
      maxHealth: fortDef.maxHealth,
      iconName: fortDef.iconName,
      iconSize: fortDef.iconSize,
    },
  ];
}

let initialState: Structure[] = [];

export const useStructureStore = defineStore("structures", () => {
  const structures = ref<Map<string, Structure>>(new Map());

  const allStructures = computed(() => Array.from(structures.value.values()));

  const fortPosition = computed(() => {
    const fort = structures.value.get("fort-1");
    return fort ? fort.position : null;
  });

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
    fortPosition,
    addStructure,
    removeStructure,
    getStructure,
    updateStructure,
    initialize,
  };
});
