import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { ResourceType, type Resource, TerrainType } from "@/types/Resource";
import resourceDefs from "@/data/resourceDefinitions.json";
import { useCameraStore } from "@/stores/camera";
import { useWorldStore } from "@/stores/world";
import { randRange, distance, isInWater, pointInPolygon } from "@/utils/geometry";

export const useResourceStore = defineStore("resources", () => {
  const resources = ref<Map<string, Resource>>(new Map());
  const allResources = computed(() => Array.from(resources.value.values()));

  function addResource(resource: Resource) {
    resources.value.set(resource.id, resource);
  }

  function removeResource(id: string) {
    resources.value.delete(id);
  }

  function getResource(id: string): Resource | undefined {
    return resources.value.get(id);
  }

  function depleteResource(id: string, amount: number): boolean {
    const resource = resources.value.get(id);

    if (!resource) return false;

    resource.amount = Math.max(0, resource.amount - amount);

    if (resource.amount <= 0) {
      resources.value.delete(id);

      return true; // Resource depleted
    }

    return false; // Resource still has amount
  }

  function initialize(fortPosition: { x: number; y: number }) {
    const camera = useCameraStore();
    const worldStore = useWorldStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    resources.value.clear();

    const generatedResources = generateResources(width, height, worldStore.allLakes, fortPosition);

    for (const res of generatedResources) {
      resources.value.set(res.id, res);
    }
  }

  return {
    resources,
    allResources,
    addResource,
    removeResource,
    getResource,
    depleteResource,
    initialize,
  };
});

function generateResources(
  width: number,
  height: number,
  lakes: Array<{
    center: { x: number; y: number };
    radius: number;
    outline?: Array<{ x: number; y: number }>;
  }>,
  fortPosition: { x: number; y: number }
): Resource[] {
  const resources: Resource[] = [];
  const margin = 100;
  const fortClearRadius = 150;

  // Iterate over each resource type
  for (const [key, def] of Object.entries(resourceDefs)) {
    const resType = def.type as ResourceType;
    const rarity = def.rarity || 1;
    const scatterRadius = def.scatterRadius || 50;
    const terrainTypes = def.possibleTerrainTypes || ["land"];

    // Calculate count inversely proportional to rarity (higher rarity = fewer spawns)
    const baseCount = 30;
    const count = Math.floor(baseCount / rarity);

    const typeResources: Resource[] = [];

    let attempts = 0;

    const maxAttempts = count * 20;

    while (typeResources.length < count && attempts < maxAttempts) {
      attempts++;

      const x = randRange(margin, width - margin);
      const y = randRange(margin, height - margin);

      // Check fort proximity
      const distToFort = distance({ x, y }, fortPosition);

      if (distToFort < fortClearRadius) continue;

      // Check terrain compatibility
      const inWater = isInWater(x, y, lakes);
      const terrain = inWater ? TerrainType.Water : TerrainType.Land;

      if (!terrainTypes.includes(terrain)) continue;

      // Check overlap with existing resources (any type)
      let overlapAny = false;

      for (const r of resources) {
        const d = distance({ x, y }, r.position);

        if (d < (r.iconSize + def.iconSize) / 2) {
          overlapAny = true;
          break;
        }
      }

      if (overlapAny) continue;

      // Check scatter distance with same type
      let tooCloseToSameType = false;

      for (const tr of typeResources) {
        const d = distance({ x, y }, tr.position);

        if (d < scatterRadius) {
          tooCloseToSameType = true;
          break;
        }
      }

      if (tooCloseToSameType) continue;

      // Valid position found
      const amountRange = def.amountRange || [10, 50];
      const amount = Math.floor(randRange(amountRange[0] ?? 10, amountRange[1] ?? 50));
      const resource: Resource = {
        id: `${resType}-${typeResources.length + 1}`,
        type: resType,
        position: { x, y },
        amount,
        maxAmount: amount,
        iconName: def.iconName,
        iconSize: def.iconSize,
        gatherTime: def.gatherTime,
        possibleTerrainTypes: terrainTypes,
      };

      typeResources.push(resource);
    }

    resources.push(...typeResources);
  }

  return resources;
}
