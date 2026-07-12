import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { EnemyType, type Enemy, type Position } from "@/types/Enemy";
import enemyDefs from "@/data/enemyDefinitions.json";
import { useStructureStore } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore } from "./resources";
import { useCameraStore } from "./camera";
import { isInWater } from "@/utils/geometry";

type EnemyDefKey = keyof typeof enemyDefs;

const AMBIENT_CAP_PER_TYPE = 4;
const HORDE_BASE_COUNT = 3;
const HORDE_PER_DAY = 1.5;
const HORDE_MAX = 20;
const TARGET_FRAME_TIME = 1000 / 60;

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

  /** Rolls for opportunistic ambient spawns: a piranha inside a lake, a wolf near a wood cluster. */
  function spawnAmbient() {
    const worldStore = useWorldStore();
    const resourceStore = useResourceStore();

    if (worldStore.allLakes.length > 0 && ambientCountByType(EnemyType.Piranha) < AMBIENT_CAP_PER_TYPE) {
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
    if (woodResources.length > 0 && ambientCountByType(EnemyType.Wolf) < AMBIENT_CAP_PER_TYPE) {
      const tree = woodResources[Math.floor(Math.random() * woodResources.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 100;
      const pos = { x: tree.position.x + Math.cos(angle) * dist, y: tree.position.y + Math.sin(angle) * dist };

      addEnemy(createEnemy(EnemyType.Wolf, pos, "ambient"));
    }
  }

  /** Called every frame with the scaled game delta. Marches hordes toward the fort and lets ambient enemies wander. */
  function updateEnemyAI(gameDeltaMs: number) {
    const worldStore = useWorldStore();
    const structureStore = useStructureStore();
    const fort = structureStore.getStructure("fort-1");
    const lakesCache = worldStore.allLakes;
    const deltaMultiplier = gameDeltaMs / TARGET_FRAME_TIME;

    for (const enemy of enemies.value.values()) {
      if (enemy.actionLock || enemy.combatTargetId) continue;

      let dest: Position | undefined;

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
