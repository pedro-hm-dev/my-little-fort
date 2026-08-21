import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { EnemyType, type Enemy, type EnemyHabitat, type Position } from "@/types/Enemy";
import enemyDefs from "@/data/enemyDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useCameraStore } from "./camera";
import { useUnitStore } from "./units";
import { isInWater, approachPoint, distance, outlineBounds } from "@/utils/geometry";
import { useNavigationStore } from "./navigation";
import { combatRangeFor } from "@/utils/combatEngine";
import actionDefs from "@/data/actionDefinitions.json";
import type { ActionDefinition } from "@/types/Combat";
import { generatePatrolRoute } from "@/utils/patrol";
import type { BiomeRegion, BiomeType } from "@/types/Terrain";

type EnemyDefKey = keyof typeof enemyDefs;
const ACTION_DEFS = actionDefs as unknown as Record<string, ActionDefinition>;
/** The bits of an enemy def spawnAmbient cares about beyond the strictly-typed JSON fields. */
interface AmbientSpawnConfig {
  habitat?: EnemyHabitat;
  /** If the habitat roll lands in this biome, spawn a pack (packSizeRange) instead of a lone enemy. */
  packBiome?: string;
  packSizeRange?: [number, number];
  /** Chance per game hour, per habitat instance, of one more appearing. Low value = rare animal. */
  spawnRate?: number;
  /** Cap per habitat instance — a map with two deserts holds twice as many desert animals. */
  biomeCap?: number;
}

const DEFAULT_SPAWN_RATE = 0.2;
const DEFAULT_BIOME_CAP = 4;

/**
 * One place a habitat exists on this map. A biome habitat has one instance per region, a lake habitat
 * one per lake — which is what makes the cap scale with the generated geography instead of being a
 * single map-wide number.
 *
 * `contains` decides whether an enemy standing somewhere counts against this instance's cap. It is
 * evaluated at roll time rather than stored on the enemy, because animals wander: a `regionId` copied
 * at spawn goes stale the moment the bear walks out of the tundra.
 */
interface HabitatInstance {
  id: string;
  contains: (position: Position) => boolean;
  sample: () => Position | null;
}

const HORDE_BASE_COUNT = 3;
const HORDE_PER_DAY = 1.5;
const HORDE_MAX = 20;
const TARGET_FRAME_TIME = 1000 / 60;

/** How far (world units) or how long (game ms) an enemy will chase a target it can't catch before giving up. */
const MAX_CHASE_DISTANCE = 400;
const MAX_CHASE_TIME_MS = 10_000;

// Territorial semi-boss tuning (PLANS.md section 5)
const PATROL_WAYPOINT_RANGE: [number, number] = [5, 7];
/** Close enough to a waypoint to start walking to the next one. */
const WAYPOINT_ARRIVAL_RADIUS = 30;
const NEST_ARRIVAL_RADIUS = 25;
/** Share of max health regained per game second while resting at the nest. */
const NEST_HEAL_RATIO_PER_SECOND = 0.02;

let enemyIdCounter = 100;

function createEnemy(type: EnemyType, position: Position, behavior: Enemy["behavior"]): Enemy {
  const def = enemyDefs[type as EnemyDefKey];
  return {
    id: `${type}-${++enemyIdCounter}`,
    type,
    position: { ...position },
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    iconName: def.iconName,
    iconSize: def.iconSize,
    speed: def.speed,
    swimSpeed: def.swimSpeed,
    aquatic: (def as { aquatic?: boolean }).aquatic ?? false,
    hostileToAll: (def as { hostileToAll?: boolean }).hostileToAll ?? false,
    passive: (def as { passive?: boolean }).passive ?? false,
    baseAttack: def.attack,
    attack: def.attack,
    baseDefense: def.defense,
    defense: def.defense,
    combatRange: combatRangeFor(def.actionIds, ACTION_DEFS),
    actionIds: [...def.actionIds],
    actionCooldowns: {},
    behavior,
    homePosition: behavior === "ambient" ? { ...position } : undefined,
  };
}

function randomEdgePosition(width: number, height: number): Position {
  const edge = Math.floor(Math.random() * 4);
  const margin = 40;

  switch (edge) {
    case 0:
      return { x: Math.random() * width, y: margin };
    case 1:
      return { x: width - margin, y: Math.random() * height };
    case 2:
      return { x: Math.random() * width, y: height - margin };
    default:
      return { x: margin, y: Math.random() * height };
  }
}

export const useEnemyStore = defineStore("enemies", () => {
  const enemies = ref<Map<string, Enemy>>(new Map());

  const allEnemies = computed(() => Array.from(enemies.value.values()));

  function addEnemy(enemy: Enemy) {
    enemies.value.set(enemy.id, enemy);
  }

  function removeEnemy(id: string) {
    enemies.value.delete(id);
  }

  function getEnemy(id: string): Enemy | undefined {
    return enemies.value.get(id);
  }

  /** Spawns a horde at a random map edge, marching on the fort. Scales with the day count. */
  function spawnHorde(day: number) {
    const structureStore = useStructureStore();
    const camera = useCameraStore();
    const fort = structureStore.getStructure("fort-1");
    if (!fort) return;

    const count = Math.min(HORDE_MAX, Math.round(HORDE_BASE_COUNT + day * HORDE_PER_DAY));
    const scatterRadius = 60 + count * 10;

    for (let i = 0; i < count; i++) {
      const type = Math.random() < 0.7 ? EnemyType.Raider : EnemyType.RaiderArcher;
      const enemy = createEnemy(type, randomEdgePosition(camera.mapWidth, camera.mapHeight), "horde");

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * scatterRadius;
      enemy.targetPosition = {
        x: fort.position.x + Math.cos(angle) * dist,
        y: fort.position.y + Math.sin(angle) * dist,
      };

      addEnemy(enemy);
    }
  }

  /** Tries once to find a spawn point for this habitat kind — declared per-type in enemyDefinitions.json. */
  function sampleHabitatPosition(
    habitat: EnemyHabitat,
    worldStore: ReturnType<typeof useWorldStore>,
    resourceStore: ReturnType<typeof useResourceStore>,
    camera: ReturnType<typeof useCameraStore>,
  ): Position | null {
    if (habitat.kind === "lake") {
      const lakes = worldStore.allLakes;
      if (lakes.length === 0) return null;
      const lake = lakes[Math.floor(Math.random() * lakes.length)]!;

      for (let tries = 0; tries < 10; tries++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * lake.radius * 0.6;
        const pos = { x: lake.center.x + Math.cos(angle) * dist, y: lake.center.y + Math.sin(angle) * dist };
        if (isInWater(pos.x, pos.y, lakes)) return pos;
      }
      return null;
    }

    if (habitat.kind === "resource") {
      const candidates = resourceStore.allResources.filter((r) => r.type === habitat.resourceType);
      if (candidates.length === 0) return null;
      const anchor = candidates[Math.floor(Math.random() * candidates.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 100;
      return { x: anchor.position.x + Math.cos(angle) * dist, y: anchor.position.y + Math.sin(angle) * dist };
    }

    // habitat.kind === "biome"
    for (let tries = 0; tries < 20; tries++) {
      const pos = { x: Math.random() * camera.mapWidth, y: Math.random() * camera.mapHeight };
      if (worldStore.biomeAt(pos.x, pos.y) === habitat.biome && !isInWater(pos.x, pos.y, worldStore.allWaterBodies)) {
        return pos;
      }
    }
    return null;
  }

  /**
   * Where a territorial enemy walks when it is not fighting. Wounded and unengaged, it retreats to
   * the nest and heals there; otherwise it walks its patrol loop. Being enraged suppresses resting,
   * so a raided nest can't send it home mid-rampage.
   */
  function territorialDestination(enemy: Enemy, gameDeltaMs: number): Position | undefined {
    const wounded = enemy.health < enemy.maxHealth;

    if (!enemy.enraged && (enemy.resting || wounded)) {
      enemy.resting = true;

      if (!enemy.nestPosition) return undefined;
      if (distance(enemy.position, enemy.nestPosition) > NEST_ARRIVAL_RADIUS) return { ...enemy.nestPosition };

      const healed = (enemy.maxHealth * NEST_HEAL_RATIO_PER_SECOND * gameDeltaMs) / 1000;
      enemy.health = Math.min(enemy.maxHealth, enemy.health + healed);

      if (enemy.health >= enemy.maxHealth) enemy.resting = false;

      return undefined;
    }

    const route = enemy.patrolRoute;
    if (!route || route.length === 0) return undefined;

    const index = (enemy.patrolIndex ?? 0) % route.length;
    const waypoint = route[index]!;

    if (distance(enemy.position, waypoint) < WAYPOINT_ARRIVAL_RADIUS) {
      enemy.patrolIndex = (index + 1) % route.length;
    }

    return { ...waypoint };
  }

  /**
   * Places one territorial enemy in a region: a fresh patrol route, nest position defaulting to the
   * route's center. `pinnedNestPosition` lets a nest respawn (stores/nests.ts) keep the nest at
   * its original spot even though the new patrol loop has a different center.
   */
  function spawnTerritorialInRegion(type: EnemyType, region: BiomeRegion, pinnedNestPosition?: Position): Enemy | null {
    const worldStore = useWorldStore();
    const [minWaypoints, maxWaypoints] = PATROL_WAYPOINT_RANGE;
    const waypointCount = minWaypoints + Math.floor(Math.random() * (maxWaypoints - minWaypoints + 1));

    // A rota é amostrada do `outline`, que é só o anel externo — numa região com buraco ele engloba
    // pedaço de outra região. A grade é a verdade, então descartamos o waypoint que caiu fora.
    let route = generatePatrolRoute(region.outline, waypointCount);

    for (let attempt = 0; attempt < 5 && route; attempt++) {
      const inside = route.waypoints.filter((wp) => worldStore.regionAt(wp.x, wp.y)?.id === region.id);
      if (inside.length === route.waypoints.length) break;
      if (inside.length >= 3) {
        route = { waypoints: inside, center: route.center };
        break;
      }
      route = generatePatrolRoute(region.outline, waypointCount);
    }

    if (!route) return null;

    const enemy = createEnemy(type, route.center, "territorial");
    enemy.regionId = region.id;
    enemy.patrolRoute = route.waypoints;
    enemy.patrolIndex = 0;
    enemy.nestPosition = { ...(pinnedNestPosition ?? route.center) };

    addEnemy(enemy);

    return enemy;
  }

  /**
   * Territorial enemies are placed deterministically — one per matching biome region, on world init —
   * instead of going through spawnAmbient's probabilistic roll. Two deserts means two worms.
   */
  function spawnTerritorial() {
    const worldStore = useWorldStore();

    for (const type of Object.values(EnemyType)) {
      const def = enemyDefs[type as EnemyDefKey] as unknown as { behavior?: string; habitat?: EnemyHabitat };
      if (def.behavior !== "territorial" || def.habitat?.kind !== "biome") continue;

      for (const region of worldStore.regionsOfBiome(def.habitat.biome as BiomeType)) {
        if (allEnemies.value.some((enemy) => enemy.regionId === region.id && enemy.type === type)) continue;

        spawnTerritorialInRegion(type, region);
      }
    }
  }

  /**
   * Every place this habitat exists. Grassland is the default fill and has no placed regions, so it
   * becomes a single implicit instance covering the map — without that, anything living in grassland
   * (the capybara) would have zero instances and never spawn at all.
   */
  function habitatInstances(habitat: EnemyHabitat): HabitatInstance[] {
    const worldStore = useWorldStore();
    const resourceStore = useResourceStore();
    const camera = useCameraStore();

    const wholeMap = (id: string): HabitatInstance => ({
      id,
      contains: () => true,
      sample: () => sampleHabitatPosition(habitat, worldStore, resourceStore, camera),
    });

    if (habitat.kind === "lake") {
      return worldStore.allLakes.map((lake, index) => ({
        id: `lake-${index}`,
        contains: (position) => distance(position, lake.center) <= lake.radius * 1.5,
        sample: () => {
          for (let tries = 0; tries < 10; tries++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * lake.radius * 0.6;
            const pos = { x: lake.center.x + Math.cos(angle) * dist, y: lake.center.y + Math.sin(angle) * dist };
            if (isInWater(pos.x, pos.y, worldStore.allLakes)) return pos;
          }
          return null;
        },
      }));
    }

    // A resource habitat has no natural instance to divide by (wolves follow trees, which are
    // scattered), so it keeps a single map-wide cap.
    if (habitat.kind === "resource") return [wholeMap("resource")];

    const regions = worldStore.regionsOfBiome(habitat.biome as BiomeType);
    if (regions.length === 0) return [wholeMap(`biome-${habitat.biome}`)];

    return regions.map((region) => ({
      id: region.id,
      // Grade, não polígono: o `outline` é o anel externo de uma região que pode ter buracos, então
      // pointInPolygon divergia da verdade em ~30% dos pontos. regionAt consulta a grade de geração.
      contains: (position) => worldStore.regionAt(position.x, position.y)?.id === region.id,
      sample: () => {
        const bounds = region.bounds ?? outlineBounds(region.outline);
        for (let tries = 0; tries < 30; tries++) {
          const pos = {
            x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
            y: bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
          };
          // Pela grade, não pelo polígono: o anel externo engloba buracos de regiões vizinhas, e
          // amostrar de lá fazia o bicho nascer no bioma errado.
          if (worldStore.regionAt(pos.x, pos.y)?.id !== region.id) continue;
          if (!isInWater(pos.x, pos.y, worldStore.allWaterBodies)) return pos;
        }
        return null;
      },
    }));
  }

  /**
   * Rolls for ambient spawns once per game hour: for every habitat instance, roll that type's
   * `spawnRate` and place one if the instance is under its `biomeCap`. Rarity and density are both
   * per-type data now, instead of every animal sharing one global chance.
   */
  function spawnAmbient() {
    const worldStore = useWorldStore();

    for (const type of Object.values(EnemyType)) {
      const def = enemyDefs[type as EnemyDefKey] as unknown as AmbientSpawnConfig & { behavior: string };
      if (def.behavior !== "ambient" || !def.habitat) continue;

      const spawnRate = def.spawnRate ?? DEFAULT_SPAWN_RATE;
      const biomeCap = def.biomeCap ?? DEFAULT_BIOME_CAP;

      for (const instance of habitatInstances(def.habitat)) {
        if (Math.random() >= spawnRate) continue;

        const countHere = () =>
          allEnemies.value.filter((e) => e.type === type && e.behavior === "ambient" && instance.contains(e.position))
            .length;

        if (countHere() >= biomeCap) continue;

        const anchor = instance.sample();
        if (!anchor) continue;

        const inPackBiome = def.packBiome ? worldStore.biomeAt(anchor.x, anchor.y) === def.packBiome : false;
        const [minPack, maxPack] = def.packSizeRange ?? [1, 1];
        const packSize = inPackBiome ? minPack + Math.floor(Math.random() * (maxPack - minPack + 1)) : 1;

        for (let born = 0; born < packSize && countHere() < biomeCap; born++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 60;
          const scattered = { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
          // O espalhamento da matilha pode cair na região vizinha, e aí o bicho contaria contra o cap
          // dela em vez desta — estourando o teto de lá. Fora da instância, nasce na âncora.
          const pos = born === 0 || !instance.contains(scattered) ? anchor : scattered;

          addEnemy(createEnemy(type, pos, "ambient"));
        }
      }
    }
  }

  /** Called every frame with the scaled game delta. Marches hordes toward the fort and lets ambient enemies wander. */
  function updateEnemyAI(gameDeltaMs: number) {
    const worldStore = useWorldStore();
    const structureStore = useStructureStore();
    const fort = structureStore.getStructure("fort-1");
    const unitStore = useUnitStore();
    const navigationStore = useNavigationStore();
    const lakesCache = worldStore.allWaterBodies;
    const deltaMultiplier = gameDeltaMs / TARGET_FRAME_TIME;

    for (const enemy of enemies.value.values()) {
      if (enemy.actionLock) continue;

      if (!enemy.combatTargetId) {
        enemy.combatAnchor = undefined;
        enemy.combatAnchorTargetId = undefined;
        enemy.chaseElapsedMs = undefined;
      }

      let dest: Position | undefined;

      if (enemy.combatTargetId && !enemy.combatTargetIsStructure) {
        if (enemy.combatAnchorTargetId !== enemy.combatTargetId) {
          enemy.combatAnchorTargetId = enemy.combatTargetId;
          enemy.combatAnchor = { ...enemy.position };
          enemy.chaseElapsedMs = 0;
        }

        // Chase whoever it's fighting — including a unit that hit it from outside its own range — but
        // an aquatic enemy never steps onto land to do it; it just holds position until back in range.
        // A hostileToAll enemy can be locked onto a rival enemy, so resolve the target from both pools.
        const target = unitStore.getUnit(enemy.combatTargetId) ?? enemies.value.get(enemy.combatTargetId);
        if (target) {
          const outOfRange = distance(enemy.position, target.position) > enemy.combatRange;
          enemy.chaseElapsedMs = outOfRange ? (enemy.chaseElapsedMs ?? 0) + gameDeltaMs : 0;

          const distFromAnchor = enemy.combatAnchor ? distance(enemy.position, enemy.combatAnchor) : 0;
          // An enraged territorial enemy has no leash — units have to fight or outrun it.
          const gaveUp =
            !enemy.enraged && (distFromAnchor > MAX_CHASE_DISTANCE || enemy.chaseElapsedMs > MAX_CHASE_TIME_MS);

          if (gaveUp) {
            enemy.combatTargetId = undefined;
            enemy.combatTargetIsStructure = undefined;
            enemy.combatAnchor = undefined;
            enemy.combatAnchorTargetId = undefined;
            enemy.chaseElapsedMs = undefined;
            if (enemy.behavior === "ambient" && enemy.homePosition) enemy.targetPosition = { ...enemy.homePosition };
          } else {
            const approach = approachPoint(enemy.position, target.position, enemy.combatRange * 0.9);
            if (!enemy.aquatic || isInWater(approach.x, approach.y, lakesCache)) dest = approach;
          }
        }
      } else if (!enemy.combatTargetId) {
        if (enemy.fleeing && enemy.targetPosition) {
          // Fugir tem prioridade sobre a vagueação ambient até chegar ao destino.
          dest = enemy.targetPosition;
        } else if (enemy.behavior === "horde") {
          dest = enemy.targetPosition ?? fort?.position;
        } else if (enemy.behavior === "territorial") {
          dest = territorialDestination(enemy, gameDeltaMs);
        } else if (enemy.homePosition) {
          if (!enemy.targetPosition) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * 40;
            enemy.targetPosition = {
              x: enemy.homePosition.x + Math.cos(angle) * dist,
              y: enemy.homePosition.y + Math.sin(angle) * dist,
            };
          }
          dest = enemy.targetPosition;
        }
      }

      if (!dest) continue;

      const steer = navigationStore.routeTo(enemy, dest, gameDeltaMs);
      const dx = steer.x - enemy.position.x;
      const dy = steer.y - enemy.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 4) {
        enemy.position.x = steer.x;
        enemy.position.y = steer.y;
        navigationStore.clearPath(enemy);
        if (enemy.fleeing) enemy.fleeing = false;
        if (enemy.behavior === "ambient") enemy.targetPosition = undefined;
      } else {
        const inLake = isInWater(enemy.position.x, enemy.position.y, lakesCache);
        const effSpeed = inLake ? enemy.swimSpeed : enemy.speed;
        const frameSpeed = effSpeed * deltaMultiplier;
        const actualSpeed = Math.min(frameSpeed, dist);
        enemy.position.x += (dx / dist) * actualSpeed;
        enemy.position.y += (dy / dist) * actualSpeed;
      }
    }
  }

  function initialize() {
    enemies.value.clear();
    spawnTerritorial();
  }

  return {
    enemies,
    allEnemies,
    addEnemy,
    removeEnemy,
    getEnemy,
    spawnHorde,
    spawnAmbient,
    habitatInstances,
    spawnTerritorial,
    spawnTerritorialInRegion,
    updateEnemyAI,
    initialize,
  };
});
