import { ref, computed } from "vue";
import { defineStore } from "pinia";

export type TimeSpeed = 0 | 1 | 2 | 5 | 10;
export type TimePhase = "dawn" | "day" | "dusk" | "night";

/** At x1 speed, one full day cycle lasts 5 real minutes. */
const FULL_DAY_MS_AT_X1 = 300_000;

export const useTimeStore = defineStore("time", () => {
  /** Fraction of the current day: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. */
  const timeOfDay = ref(0.33); // start at early morning
  const day = ref(1);
  const speed = ref<TimeSpeed>(1);

  /** Current phase of the day. */
  const phase = computed<TimePhase>(() => {
    const t = timeOfDay.value;

    if (t >= 0.8 || t < 0.2) return "night";
    if (t < 0.28) return "dawn";
    if (t < 0.72) return "day";

    return "dusk";
  });

  const phaseLabel = computed(() => {
    const labels: Record<TimePhase, string> = {
      dawn: "Amanhecer",
      day: "Dia",
      dusk: "Entardecer",
      night: "Noite",
    };

    return labels[phase.value];
  });

  const isDay = computed(() => phase.value !== "night");
  const isNight = computed(() => phase.value === "night");

  /**
   * Advance time by `deltaMs` real milliseconds.
   * Call this every frame from the game loop.
   */
  function tick(deltaMs: number) {
    if (speed.value === 0) return;

    const increment = (deltaMs * speed.value) / FULL_DAY_MS_AT_X1;

    timeOfDay.value += increment;

    if (timeOfDay.value >= 1) {
      timeOfDay.value -= 1;
      day.value += 1;
    }
  }

  function setSpeed(s: TimeSpeed) {
    speed.value = s;
  }

  function reset() {
    timeOfDay.value = 0.33;
    day.value = 1;
    speed.value = 1;
  }

  /**
   * Returns the scaled game-time delta for a real `deltaMs`.
   * Returns 0 when paused so all simulation systems simply freeze.
   */
  function gameDelta(realDeltaMs: number): number {
    if (speed.value === 0) return 0;

    return realDeltaMs * speed.value;
  }

  return {
    timeOfDay,
    day,
    speed,
    phase,
    phaseLabel,
    isDay,
    isNight,
    tick,
    setSpeed,
    gameDelta,
    reset,
  };
});
