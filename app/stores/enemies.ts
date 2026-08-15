import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { EnemyType, type Enemy, type Position } from "@/types/Enemy";
import { BiomeType } from "@/types/Terrain";
import enemyDefs from "@/data/enemyDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useCameraStore } from "./camera";
import { useUnitStore } from "./units";
import { isInWater, approachPoint, distance } from "@/utils/geometry";

type EnemyDefKey = keyof typeof enemyDefs;

const DEFAULT_AMBIENT_CAP = 4;
// Wolves pack up in forests, so they need more headroom than the other solitary ambient types.
const AMBIENT_CAP_BY_TYPE: Partial<Record<EnemyType, number>> = {
  [EnemyType.Wolf]: 8,
};

function ambientCapFor(type: EnemyType): number {
  return AMBIENT_CAP_BY_TYPE[type] ?? DEFAULT_AMBIENT_CAP;
}

const HORDE_BASE_COUNT = 3;
const HORDE_PER_DAY = 1.5;
const HORDE_MAX = 20;
const TARGET_FRAME_TIME = 1000 / 60;

/** How far (world units) or how long (game ms) an enemy will chase a target it can't catch before giving up. */
const MAX_CHASE_DISTANCE = 400;
const MAX_CHASE_TIME_MS = 10_000;

let enemyIdCounter = 100;

function createEnemy(type: EnemyType, position: Position, behavior: "horde" | "ambient"): Enemy {
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
    combatRange: def.combatRange,
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

  function ambientCountByType(type: EnemyType): number {
    return allEnemies.value.filter((e) => e.type === type && e.behavior === "ambient").length;
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

  /** Rolls for opportunistic ambient spawns: a piranha inside a lake, a wolf pack near forest wood, a bear in the tundra. */
  function spawnAmbient() {
    const worldStore = useWorldStore();
    const resourceStore = useResourceStore();
    const camera = useCameraStore();

    if (worldStore.allLakes.length > 0 && ambientCountByType(EnemyType.Piranha) < ambientCapFor(EnemyType.Piranha)) {
      const lake = worldStore.allLakes[Math.floor(Math.random() * worldStore.allLakes.length)]!;

      for (let tries = 0; tries < 10; tries++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * lake.radius * 0.6;
        const pos = { x: lake.center.x + Math.cos(angle) * dist, y: lake.center.y + Math.sin(angle) * dist };

        if (isInWater(pos.x, pos.y, worldStore.allLakes)) {
          addEnemy(createEnemy(EnemyType.Piranha, pos, "ambient"));
          break;
        }
      }
    }

    const woodResources = resourceStore.allResources.filter((r) => r.type === "wood");
    if (woodResources.length > 0 && ambientCountByType(EnemyType.Wolf) < ambientCapFor(EnemyType.Wolf)) {
      const tree = woodResources[Math.floor(Math.random() * woodResources.length)]!;
      const inForest = worldStore.biomeAt(tree.position.x, tree.position.y) === BiomeType.Forest;
      // Forests get wolf packs; everywhere else it's a lone wolf, same as before.
      const packSize = inForest ? 1 + Math.floor(Math.random() * 3) : 1;

      for (let i = 0; i < packSize && ambientCountByType(EnemyType.Wolf) < ambientCapFor(EnemyType.Wolf); i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 100;
        const pos = { x: tree.position.x + Math.cos(angle) * dist, y: tree.position.y + Math.sin(angle) * dist };

        addEnemy(createEnemy(EnemyType.Wolf, pos, "ambient"));
      }
    }

    if (ambientCountByType(EnemyType.Bear) < ambientCapFor(EnemyType.Bear)) {
      for (let tries = 0; tries < 20; tries++) {
        const pos = { x: Math.random() * camera.mapWidth, y: Math.random() * camera.mapHeight };

        if (worldStore.biomeAt(pos.x, pos.y) === BiomeType.Tundra && !isInWater(pos.x, pos.y, worldStore.allWaterBodies)) {
          addEnemy(createEnemy(EnemyType.Bear, pos, "ambient"));
          break;
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
        const target = unitStore.getUnit(enemy.combatTargetId);
        if (target) {
          const outOfRange = distance(enemy.position, target.position) > enemy.combatRange;
          enemy.chaseElapsedMs = outOfRange ? (enemy.chaseElapsedMs ?? 0) + gameDeltaMs : 0;

          const distFromAnchor = enemy.combatAnchor ? distance(enemy.position, enemy.combatAnchor) : 0;
          const gaveUp = distFromAnchor > MAX_CHASE_DISTANCE || enemy.chaseElapsedMs > MAX_CHASE_TIME_MS;

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
        if (enemy.behavior === "horde") {
          dest = enemy.targetPosition ?? fort?.position;
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

      const dx = dest.x - enemy.position.x;
      const dy = dest.y - enemy.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 4) {
        enemy.position.x = dest.x;
        enemy.position.y = dest.y;
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
  }

  return {
    enemies,
    allEnemies,
    addEnemy,
    removeEnemy,
    getEnemy,
    spawnHorde,
    spawnAmbient,
    updateEnemyAI,
    initialize,
  };
});
