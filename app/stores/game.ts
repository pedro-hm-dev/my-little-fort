import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { useTimeStore } from "./time";
import { useEnemyStore } from "./enemies";
import { useStructureStore } from "./structures";
import { useFoodStore } from "./food";
import { useNestStore } from "./nests";

// Must match FULL_DAY_MS_AT_X1 in time.ts
const FULL_DAY_GAME_MS = 300_000;
const AMBIENT_CHECK_INTERVAL_MS = FULL_DAY_GAME_MS / 24; // ~once per in-game hour
const AMBIENT_SPAWN_CHANCE = 0.35;

export const useGameStore = defineStore("game", () => {
  const gameOver = ref(false);
  let ambientTimer = 0;
  let dayWatcherStarted = false;

  function reset() {
    gameOver.value = false;
    ambientTimer = 0;
  }

  /** Called every frame with the scaled game delta: checks for defeat and rolls ambient spawns. */
  function updateGame(gameDeltaMs: number) {
    if (gameOver.value) return;

    const fort = useStructureStore().getStructure("fort-1");
    if (fort && fort.health <= 0) {
      gameOver.value = true;
      useTimeStore().setSpeed(0);
      return;
    }

    ambientTimer += gameDeltaMs;
    if (ambientTimer >= AMBIENT_CHECK_INTERVAL_MS) {
      ambientTimer = 0;
      if (Math.random() < AMBIENT_SPAWN_CHANCE) {
        useEnemyStore().spawnAmbient();
      }
    }
  }

  /**
   * Wires the once-per-app day triggers: the "end of day" horde (dusk -> night) and the
   * daily food ration on each day rollover. Safe to call more than once.
   */
  function startDayWatcher() {
    if (dayWatcherStarted) return;
    dayWatcherStarted = true;

    const timeStore = useTimeStore();

    watch(
      () => timeStore.phase,
      (next, prev) => {
        if (prev === "dusk" && next === "night") {
          useEnemyStore().spawnHorde(timeStore.day);
        }
      },
    );

    watch(
      () => timeStore.day,
      (day) => {
        useFoodStore().consumeDailyFood();
        useNestStore().checkRespawns(day);
      },
    );
  }

  return { gameOver, reset, updateGame, startDayWatcher };
});
