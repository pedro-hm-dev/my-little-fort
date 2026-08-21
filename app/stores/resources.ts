import { ref, computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { RESOURCE_ICONS, ResourceType, type Position, type Resource, TerrainType } from "@/types/Resource";
import resourceDefs from "@/data/resourceDefinitions.json";
import { useCameraStore } from "@/stores/camera";
import { useWorldStore } from "@/stores/world";
import { useNavigationStore } from "@/stores/navigation";
import type { BiomeType } from "@/types/Terrain";
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

// Dropped goods: piles this close to each other merge instead of stacking up as separate icons.
const PILE_MERGE_RADIUS = 60;
const PILE_ICON_SIZE = 34;
/** Quick to pick up: it is already processed goods, not a tree to be felled. */
const PILE_GATHER_TIME = 2;

// Applied to a resource's own clusterChance/clusterSize when the cluster center falls in one of its `denseBiomes`.
const DENSE_CLUSTER_CHANCE_MULTIPLIER = 1.4;
const DENSE_CLUSTER_SIZE_MULTIPLIER = 1.7;

// Keyed by resource type, not by def key: the two differ ("mushrooms" holds type "mushroom").
const SECONDARY_YIELDS = new Map<string, { type: ResourceType; chance: number }>();

for (const [, def] of Object.entries(resourceDefs) as [string, ResourceDefinition][]) {
  if (!def.secondaryYield) continue;

  SECONDARY_YIELDS.set(def.type, { type: def.secondaryYield.type as ResourceType, chance: def.secondaryYield.chance });
}

/** The extra type this resource sometimes drops, or null. Rolled per gather tick by the caller. */
export function rollSecondaryYield(type: ResourceType): ResourceType | null {
  const yield_ = SECONDARY_YIELDS.get(type);
  if (!yield_) return null;

  return Math.random() < yield_.chance ? yield_.type : null;
}

export const useResourceStore = defineStore("resources", () => {
  const resources = ref<Map<string, Resource>>(new Map());
  const spatialGrid = shallowRef<SpatialGrid<Resource>>(new SpatialGrid(150));
  let nextPileId = 1;

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

  /**
   * Puts goods on the ground because there was nowhere to store them. Merges into a nearby pile of
   * the same type so a worker emptying a full colony does not litter the map with piles of one.
   */
  function dropPile(type: ResourceType, amount: number, position: Position): Resource {
    if (amount <= 0) throw new Error("dropPile needs a positive amount");

    // Never inside a solid body: a pile no one can walk up to is a pile that never comes back.
    const spot = useNavigationStore().freeSpotNear(position);

    for (const nearby of spatialGrid.value.queryRadius(spot.x, spot.y, PILE_MERGE_RADIUS)) {
      if (!nearby.dropped || nearby.type !== type) continue;

      nearby.amount += amount;
      nearby.maxAmount = Math.max(nearby.maxAmount, nearby.amount);

      return nearby;
    }

    const pile: Resource = {
      id: `pile-${type}-${nextPileId++}`,
      type,
      position: { x: spot.x, y: spot.y },
      amount,
      maxAmount: amount,
      iconName: RESOURCE_ICONS[type],
      iconSize: PILE_ICON_SIZE,
      gatherTime: PILE_GATHER_TIME,
      possibleTerrainTypes: ["land", "water"],
      dropped: true,
    };

    addResource(pile);

    return pile;
  }

  /** Everything sitting on the ground waiting to be hauled back in. */
  const droppedPiles = computed(() => allResources.value.filter((resource) => resource.dropped));

  /** Ages carcasses by the game delta and clears the ones that rotted through. Called every frame. */
  function decayCarcasses(gameDeltaMs: number) {
    if (gameDeltaMs <= 0) return;

    for (const resource of resources.value.values()) {
      if (resource.decayRemainingMs === undefined) continue;

      resource.decayRemainingMs -= gameDeltaMs;

      if (resource.decayRemainingMs <= 0) removeResource(resource.id);
    }
  }

  function initialize(fortPosition: { x: number; y: number }) {
    const camera = useCameraStore();
    const worldStore = useWorldStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    resources.value.clear();
    spatialGrid.value.clear();

    const generatedResources = generateResources(width, height, worldStore.allWaterBodies, fortPosition, worldStore.biomeAt);

    for (const res of generatedResources) {
      resources.value.set(res.id, res);
      spatialGrid.value.insert(res);
    }
  }

  return {
    resources,
    allResources,
    droppedPiles,
    addResource,
    dropPile,
    removeResource,
    getResource,
    getResourcesInRadius,
    getNearestResource,
    depleteResource,
    decayCarcasses,
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
  /** Biomes this resource is common in — outside of these it can still spawn, just much rarer. */
  preferredBiomes?: string[];
  /** Biomes this resource can NEVER spawn in — a hard gate, unlike preferredBiomes' soft rarity. */
  excludedBiomes?: string[];
  /** If set, this resource can ONLY spawn in these biomes — the inverse of excludedBiomes. */
  requiredBiomes?: string[];
  /** Biomes where this resource clusters more densely (bigger/likelier clusters). */
  denseBiomes?: string[];
  /** Rolled on every gather tick on top of the resource's own type — plant matter yields fibre. */
  secondaryYield?: { type: string; chance: number };
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
  biomeAt: (x: number, y: number) => BiomeType,
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
      biomeAt,
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
  biomeAt: (x: number, y: number) => BiomeType;
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
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions, biomeAt } = ctx;
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

    // Denser clustering in this resource's favorite biomes (e.g. trees in forest, wolves-adjacent
    // wood too) — bigger clusters, and more likely to cluster at all instead of a lone spawn.
    const isDense = def.denseBiomes?.includes(biomeAt(cx, cy)) ?? false;
    const effectiveChance = isDense ? Math.min(1, clusterChance * DENSE_CLUSTER_CHANCE_MULTIPLIER) : clusterChance;
    const effectiveSize: [number, number] = isDense
      ? [
          Math.round(clusterSize[0] * DENSE_CLUSTER_SIZE_MULTIPLIER),
          Math.round(clusterSize[1] * DENSE_CLUSTER_SIZE_MULTIPLIER),
        ]
      : clusterSize;

    // Decide se vai fazer cluster ou spawn individual
    const doCluster = rng.next() < effectiveChance;
    const itemsInCluster = doCluster ? rng.intRange(effectiveSize[0], effectiveSize[1]) : 1;

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
        biomeAt,
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
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions, biomeAt } = ctx;
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
      biomeAt,
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
  const { width, height, lakes, fortPosition, def, spawning, targetCount, rng, placedPositions, biomeAt } = ctx;
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
      biomeAt,
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
  biomeAt: (x: number, y: number) => BiomeType,
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

  const biome = biomeAt(x, y);

  // Hard gates: some resources simply never appear in certain biomes (e.g. no trees in the desert),
  // or only ever appear in one (e.g. cactus is desert-exclusive) — unlike preferredBiomes below, no leak.
  if (def.excludedBiomes?.includes(biome)) return null;
  if (def.requiredBiomes && !def.requiredBiomes.includes(biome)) return null;

  // Biome affinity — soft preference, not a hard rule: still allowed outside its home biome, just
  // much rarer there, so deserts/tundra don't end up completely empty of everything.
  if (def.preferredBiomes && def.preferredBiomes.length > 0) {
    if (!def.preferredBiomes.includes(biome) && rng.next() > 0.15) return null;
  }

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
