import { ref, computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { ResourceType, type Resource, TerrainType } from "@/types/Resource";
import resourceDefs from "@/data/resourceDefinitions.json";
import { useCameraStore } from "@/stores/camera";
import { useWorldStore } from "@/stores/world";
import { distance, isInWater, circlesOverlap } from "@/utils/geometry";
import { getSeededRandom } from "@/utils/noise";
import { SpatialGrid } from "@/utils/spatialGrid";

// Global generation config (não específico de recurso)
const GENERATION_CONFIG = {
  baseCount: 35,
  fortClearRadius: 180,
  mapMargin: 120,
  maxPlacementAttempts: 30,
} as const;

export const useResourceStore = defineStore("resources", () => {
  const resources = ref<Map<string, Resource>>(new Map());
  const spatialGrid = shallowRef<SpatialGrid<Resource>>(new SpatialGrid(150));

  const allResources = computed(() => Array.from(resources.value.values()));

  function addResource(resource: Resource) {
    resources.value.set(resource.id, resource);
    spatialGrid.value.insert(resource);
  }

  function removeResource(id: string) {
    const resource = resources.value.get(id);
    if (resource) {
      spatialGrid.value.remove(id);
    }
    resources.value.delete(id);
  }

  function getResource(id: string): Resource | undefined {
    return resources.value.get(id);
  }

  function getResourcesInRadius(x: number, y: number, radius: number): Resource[] {
    return spatialGrid.value.queryRadius(x, y, radius);
  }

  function getNearestResource(x: number, y: number, maxRadius: number = 500): Resource | null {
    return spatialGrid.value.findNearest(x, y, maxRadius);
  }

  function depleteResource(id: string, amount: number): boolean {
    const resource = resources.value.get(id);
    if (!resource) return false;

    resource.amount = Math.max(0, resource.amount - amount);

    if (resource.amount <= 0) {
      removeResource(id);
      return true;
    }

    return false;
  }

  function initialize(fortPosition: { x: number; y: number }) {
    const camera = useCameraStore();
    const worldStore = useWorldStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    resources.value.clear();
    spatialGrid.value.clear();

    const generatedResources = generateResources(width, height, worldStore.allLakes, fortPosition);

    for (const res of generatedResources) {
      resources.value.set(res.id, res);
      spatialGrid.value.insert(res);
    }
  }

  return {
    resources,
    allResources,
    addResource,
    removeResource,
    getResource,
    getResourcesInRadius,
    getNearestResource,
    depleteResource,
    initialize,
  };
});

// Types para definição de recursos
interface SpawningConfig {
  mode: "random" | "cluster" | "shore";
  clusterSize?: [number, number];
  clusterRadius?: number;
  clusterChance?: number;
  shoreDistance?: [number, number];
  shoreChance?: number;
}

interface ResourceDefinition {
  type: string;
  amountRange: [number, number];
  iconName: string;
  iconSize: number;
  rarity: number;
  gatherTime: number;
  scatterRadius: number;
  possibleTerrainTypes: string[];
  spawning?: SpawningConfig;
}

interface LakeData {
  center: { x: number; y: number };
  radius: number;
  outline?: Array<{ x: number; y: number }>;
}

interface PlacedPosition {
  x: number;
  y: number;
  size: number;
}

type RNG = ReturnType<typeof getSeededRandom>;

/**
 * Gera todos os recursos usando configuração do JSON
 */
function generateResources(
  width: number,
  height: number,
  lakes: LakeData[],
  fortPosition: { x: number; y: number },
): Resource[] {
  const rng = getSeededRandom();
  const allResources: Resource[] = [];
  const placedPositions: PlacedPosition[] = [];

  for (const [, def] of Object.entries(resourceDefs) as [string, ResourceDefinition][]) {
    const targetCount = Math.floor(GENERATION_CONFIG.baseCount / (def.rarity || 1));
    const spawning = def.spawning || { mode: "random" as const };

    const typeResources = generateResourceType({
      width,
      height,
      lakes,
      fortPosition,
      def,
      spawning,
      targetCount,
      rng,
      placedPositions,
    });

    allResources.push(...typeResources);
  }

  return allResources;
}

interface GenerateContext {
  width: number;
  height: number;
  lakes: LakeData[];
  fortPosition: { x: number; y: number };
  def: ResourceDefinition;
  spawning: SpawningConfig;
  targetCount: number;
  rng: RNG;
  placedPositions: PlacedPosition[];
}

/**
 * Gera recursos de um tipo específico baseado na configuração de spawning
 */
function generateResourceType(ctx: GenerateContext): Resource[] {
  const { spawning } = ctx;

  switch (spawning.mode) {
    case "cluster":
      return generateClusterMode(ctx);
    case "shore":
      return generateShoreMode(ctx);
    case "random":
    default:
      return generateRandomMode(ctx);
  }
}

/**
 * Modo CLUSTER: Gera recursos em grupos/clusters
 */
function generateClusterMode(ctx: GenerateContext): Resource[] {
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions } = ctx;
  const resources: Resource[] = [];

  const clusterSize = spawning.clusterSize || [3, 6];
  const clusterRadius = spawning.clusterRadius || 80;
  const clusterChance = spawning.clusterChance ?? 0.6;

  let totalPlaced = 0;
  let clusterAttempts = 0;
  const maxClusterAttempts = 60;

  while (totalPlaced < targetCount && clusterAttempts < maxClusterAttempts) {
    clusterAttempts++;

    // Encontra centro do cluster
    const cx = rng.range(
      GENERATION_CONFIG.mapMargin + clusterRadius,
      width - GENERATION_CONFIG.mapMargin - clusterRadius,
    );
    const cy = rng.range(
      GENERATION_CONFIG.mapMargin + clusterRadius,
      height - GENERATION_CONFIG.mapMargin - clusterRadius,
    );

    // Verifica se o centro é válido para o terreno
    const centerInWater = isInWater(cx, cy, lakes);
    const terrainTypes = def.possibleTerrainTypes || ["land"];
    const centerTerrain = centerInWater ? "water" : "land";

    if (!terrainTypes.includes(centerTerrain)) continue;
    if (distance({ x: cx, y: cy }, fortPosition) < GENERATION_CONFIG.fortClearRadius + clusterRadius)
      continue;

    // Decide se vai fazer cluster ou spawn individual
    const doCluster = rng.next() < clusterChance;
    const itemsInCluster = doCluster ? rng.intRange(clusterSize[0], clusterSize[1]) : 1;

    for (let i = 0; i < itemsInCluster && totalPlaced < targetCount; i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = doCluster ? rng.next() * clusterRadius : 0;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;

      const placed = tryPlaceResource(
        x,
        y,
        def,
        resources,
        placedPositions,
        lakes,
        fortPosition,
        width,
        height,
        rng,
        totalPlaced,
      );
      if (placed) {
        resources.push(placed);
        placedPositions.push({ x, y, size: def.iconSize });
        totalPlaced++;
      }
    }
  }

  return resources;
}

/**
 * Modo SHORE: Gera recursos preferencialmente perto de lagos
 */
function generateShoreMode(ctx: GenerateContext): Resource[] {
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions } = ctx;
  const resources: Resource[] = [];

  const shoreDistance = spawning.shoreDistance || [20, 100];
  const shoreChance = spawning.shoreChance ?? 0.5;
  const clusterChance = spawning.clusterChance ?? 0.3;
  const clusterRadius = spawning.clusterRadius || 60;

  let placed = 0;
  let attempts = 0;
  const maxAttempts = targetCount * GENERATION_CONFIG.maxPlacementAttempts;

  while (placed < targetCount && attempts < maxAttempts) {
    attempts++;

    let x: number, y: number;

    // Tenta spawn perto de costa
    if (lakes.length > 0 && rng.next() < shoreChance) {
      const lake = lakes[rng.intRange(0, lakes.length - 1)]!;
      const angle = rng.next() * Math.PI * 2;
      const dist = lake.radius + rng.range(shoreDistance[0], shoreDistance[1]);
      x = lake.center.x + Math.cos(angle) * dist;
      y = lake.center.y + Math.sin(angle) * dist;
    }
    // Tenta cluster com recurso existente
    else if (resources.length > 0 && rng.next() < clusterChance) {
      const center = resources[rng.intRange(0, resources.length - 1)]!;
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.range(def.scatterRadius, clusterRadius);
      x = center.position.x + Math.cos(angle) * dist;
      y = center.position.y + Math.sin(angle) * dist;
    }
    // Posição aleatória
    else {
      x = rng.range(GENERATION_CONFIG.mapMargin, width - GENERATION_CONFIG.mapMargin);
      y = rng.range(GENERATION_CONFIG.mapMargin, height - GENERATION_CONFIG.mapMargin);
    }

    const resource = tryPlaceResource(
      x,
      y,
      def,
      resources,
      placedPositions,
      lakes,
      fortPosition,
      width,
      height,
      rng,
      placed,
    );
    if (resource) {
      resources.push(resource);
      placedPositions.push({ x, y, size: def.iconSize });
      placed++;
    }
  }

  return resources;
}

/**
 * Modo RANDOM: Gera recursos aleatoriamente com clustering opcional
 */
function generateRandomMode(ctx: GenerateContext): Resource[] {
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions } = ctx;
  const resources: Resource[] = [];

  const clusterChance = spawning.clusterChance ?? 0.3;
  const clusterRadius = spawning.clusterRadius || 60;

  let placed = 0;
  let attempts = 0;
  const maxAttempts = targetCount * GENERATION_CONFIG.maxPlacementAttempts;

  while (placed < targetCount && attempts < maxAttempts) {
    attempts++;

    let x: number, y: number;

    // Tenta cluster com recurso existente
    if (resources.length > 0 && rng.next() < clusterChance) {
      const center = resources[rng.intRange(0, resources.length - 1)]!;
      const angle = rng.next() * Math.PI * 2;
      const dist = rng.range(def.scatterRadius, clusterRadius);
      x = center.position.x + Math.cos(angle) * dist;
      y = center.position.y + Math.sin(angle) * dist;
    }
    // Posição aleatória
    else {
      x = rng.range(GENERATION_CONFIG.mapMargin, width - GENERATION_CONFIG.mapMargin);
      y = rng.range(GENERATION_CONFIG.mapMargin, height - GENERATION_CONFIG.mapMargin);
    }

    const resource = tryPlaceResource(
      x,
      y,
      def,
      resources,
      placedPositions,
      lakes,
      fortPosition,
      width,
      height,
      rng,
      placed,
    );
    if (resource) {
      resources.push(resource);
      placedPositions.push({ x, y, size: def.iconSize });
      placed++;
    }
  }

  return resources;
}

/**
 * Tenta colocar um recurso em uma posição, validando todas as regras
 */
function tryPlaceResource(
  x: number,
  y: number,
  def: ResourceDefinition,
  existingOfType: Resource[],
  allPlaced: PlacedPosition[],
  lakes: LakeData[],
  fortPosition: { x: number; y: number },
  width: number,
  height: number,
  rng: RNG,
  index: number,
): Resource | null {
  const { mapMargin, fortClearRadius } = GENERATION_CONFIG;

  // Bounds check
  if (x < mapMargin || x > width - mapMargin) return null;
  if (y < mapMargin || y > height - mapMargin) return null;

  // Fort proximity
  if (distance({ x, y }, fortPosition) < fortClearRadius) return null;

  // Terrain check
  const inWater = isInWater(x, y, lakes);
  const terrain = inWater ? "water" : "land";
  const terrainTypes = def.possibleTerrainTypes || ["land"];
  if (!terrainTypes.includes(terrain)) return null;

  // Overlap check
  const minDist = def.iconSize * 0.4;
  for (const pos of allPlaced) {
    if (circlesOverlap(x, y, minDist, pos.x, pos.y, pos.size * 0.4)) {
      return null;
    }
  }

  // Same-type scatter distance
  for (const r of existingOfType) {
    if (distance({ x, y }, r.position) < def.scatterRadius) {
      return null;
    }
  }

  // Create resource
  const amount = rng.intRange(def.amountRange[0], def.amountRange[1]);

  return {
    id: `${def.type}-${index + 1}-${Math.floor(rng.next() * 10000)}`,
    type: def.type as ResourceType,
    position: { x, y },
    amount,
    maxAmount: amount,
    iconName: def.iconName,
    iconSize: def.iconSize,
    gatherTime: def.gatherTime,
    possibleTerrainTypes: def.possibleTerrainTypes,
  };
}
