import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { ResourceType } from "@/types/Resource";
import type { LootDrop } from "@/types/Combat";
import type { EnemyType, Position } from "@/types/Enemy";
import enemyDefs from "@/data/enemyDefinitions.json";
import { useEnemyStore } from "./enemies";
import { useInventoryStore } from "./inventory";
import { useWorldStore } from "./world";
import { useTimeStore } from "./time";

type EnemyDefKey = keyof typeof enemyDefs;

export type NestState = "unclaimed" | "cooldown";
export type RaidChoice = "eggs" | "loot" | "cancel";

/**
 * A territorial enemy's nest — any enemy with `behavior: "territorial"` gets one, purely from its
 * def's data (see PLANS.md section 6). Not specific to the sand worm: `enemyType` is what lets
 * `raid`/`checkRespawns` work for whichever def owns this nest.
 */
export interface Nest {
  id: string;
  regionId: string;
  enemyType: EnemyType;
  position: Position;
  /** The territorial enemy currently guarding this nest, if it's still alive. */
  enemyId: string | null;
  state: NestState;
  respawnAtDay: number | null;
}

const EGGS_YIELD: [number, number] = [15, 30];
/** Respawn windows, in game days — a week is the base unit for both choices. */
const LOOT_RESPAWN_DAYS = 7;
/** Collecting the eggs is gentler on the guardian, so it takes 3x longer to come back — never stacked. */
const EGGS_RESPAWN_DAYS = LOOT_RESPAWN_DAYS * 3;

function randomInRange([min, max]: [number, number]): number {
  return Math.round(min + Math.random() * (max - min));
}

export const useNestStore = defineStore("nests", () => {
  const nests = ref<Map<string, Nest>>(new Map());

  const allNests = computed(() => Array.from(nests.value.values()));

  function getNest(id: string): Nest | undefined {
    return nests.value.get(id);
  }

  /** One nest per territorial enemy already placed by enemies.spawnTerritorial — call after it runs. */
  function initialize() {
    nests.value.clear();

    for (const enemy of useEnemyStore().allEnemies) {
      if (enemy.behavior !== "territorial" || !enemy.nestPosition || !enemy.regionId) continue;

      nests.value.set(enemy.regionId, {
        id: enemy.regionId,
        regionId: enemy.regionId,
        enemyType: enemy.type,
        position: { ...enemy.nestPosition },
        enemyId: enemy.id,
        state: "unclaimed",
        respawnAtDay: null,
      });
    }
  }

  function scheduleRespawn(nest: Nest, days: number) {
    nest.state = "cooldown";
    nest.respawnAtDay = useTimeStore().day + days;
  }

  /** The player can raid a nest at any moment, its guardian alive or not — see PLANS.md section 6. */
  function raid(nestId: string, choice: RaidChoice) {
    if (choice === "cancel") return;

    const nest = nests.value.get(nestId);
    if (!nest || nest.state !== "unclaimed") return;

    const inventoryStore = useInventoryStore();

    if (choice === "eggs") {
      inventoryStore.addResource(ResourceType.Egg, randomInRange(EGGS_YIELD));
      scheduleRespawn(nest, EGGS_RESPAWN_DAYS);
    } else {
      const def = enemyDefs[nest.enemyType as EnemyDefKey] as unknown as { nestLoot?: LootDrop[] };
      for (const drop of def.nestLoot ?? []) {
        if (Math.random() < drop.chance) inventoryStore.addResource(drop.type as ResourceType, randomInRange(drop.amount));
      }
      scheduleRespawn(nest, LOOT_RESPAWN_DAYS);
    }

    // Raiding while the guardian still lives enrages it: it locks onto the player and ignores the leash.
    if (nest.enemyId) {
      const guardian = useEnemyStore().getEnemy(nest.enemyId);
      if (guardian) guardian.enraged = true;
    }
  }

  /** Called from the same daily watcher as consumeDailyFood (stores/game.ts). */
  function checkRespawns(day: number) {
    const worldStore = useWorldStore();
    const enemyStore = useEnemyStore();

    for (const nest of nests.value.values()) {
      if (nest.state !== "cooldown" || nest.respawnAtDay === null || day < nest.respawnAtDay) continue;

      const region = worldStore.biomeRegions.find((candidate) => candidate.id === nest.regionId);
      if (!region) continue;

      const guardian = enemyStore.spawnTerritorialInRegion(nest.enemyType, region, nest.position);
      if (!guardian) continue;

      nest.enemyId = guardian.id;
      nest.state = "unclaimed";
      nest.respawnAtDay = null;
    }
  }

  return { nests, allNests, getNest, initialize, raid, checkRespawns };
});
