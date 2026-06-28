<template>
  <div
    class="flex flex-col items-center bg-black/60 backdrop-blur-sm border border-green-500/25 select-none overflow-hidden"
  >
    <Transition name="clock-slide">
      <div v-if="expanded" class="flex flex-col items-center w-full">
        <!-- Speedometer semicircle -->
        <svg viewBox="0 0 80 40" class="w-28 h-14">
          <defs>
            <mask id="crescent-mask">
              <circle cx="40" cy="73" r="4.2" fill="white" />
              <circle cx="42.2" cy="71.6" r="3.4" fill="black" />
            </mask>
          </defs>

          <!-- Outer arc -->
          <path d="M 4,40 A 36,36 0 0,1 76,40" fill="none" stroke="#4ade80" stroke-width="0.7" opacity="0.5" />

          <!-- Inner arc (subtle gauge band) -->
          <path d="M 10,40 A 30,30 0 0,1 70,40" fill="none" stroke="#166534" stroke-width="0.4" opacity="0.5" />

          <!-- Tick marks — speedometer lines -->
          <line
            v-for="tick in tickLines"
            :key="`tick-${tick.i}`"
            :x1="tick.x1"
            :y1="tick.y1"
            :x2="tick.x2"
            :y2="tick.y2"
            :stroke="tick.major ? '#ffffff' : '#4ade80'"
            :stroke-width="tick.major ? '1' : '0.5'"
            :opacity="tick.major ? '0.75' : '0.35'"
          />

          <!-- Rotating wheel (sun + moon) -->
          <g :transform="`rotate(${wheelRotation}, 40, 40)`">
            <!-- Sun: outline circle + rays -->
            <circle cx="40" cy="7" r="3.8" fill="none" stroke="#ffffff" stroke-width="1.1" />
            <line
              v-for="(ray, i) in sunRays"
              :key="`sun-ray-${i}`"
              :x1="ray.x1"
              :y1="ray.y1"
              :x2="ray.x2"
              :y2="ray.y2"
              stroke="#4ade80"
              stroke-width="0.8"
              stroke-linecap="round"
              opacity="0.85"
            />

            <!-- Moon: crescent via mask -->
            <circle cx="40" cy="73" r="4.2" fill="#4ade80" mask="url(#crescent-mask)" />
          </g>

          <!-- 12 o'clock notch -->
          <line x1="40" y1="3.5" x2="40" y2="8" stroke="#ffffff" stroke-width="1.5" />

          <!-- Horizon line -->
          <line x1="4" y1="39.5" x2="76" y2="39.5" stroke="#4ade80" stroke-width="0.5" opacity="0.45" />
        </svg>

        <!-- Day + phase label -->
        <div class="flex items-center justify-center gap-2 w-full px-3 py-1 border-b border-green-500/20">
          <span class="text-xs font-mono font-bold text-white tabular-nums tracking-widest">
            DIA {{ String(timeStore.day).padStart(2, "0") }}
          </span>
          <span class="text-green-800">|</span>
          <span class="text-xs font-mono uppercase tracking-widest" :style="{ color: phaseColor }">
            {{ timeStore.phaseLabel }}
          </span>
        </div>
      </div>
    </Transition>

    <!-- Controls row -->
    <div class="flex items-center gap-0.5 px-2 py-1 font-mono">
      <template v-if="!expanded">
        <UIcon
          :name="timeStore.isDay ? 'i-lucide-sun' : 'i-lucide-moon'"
          class="size-3.5 mr-1"
          :style="{ color: phaseColor }"
        />
        <span class="text-xs text-green-300 tabular-nums mr-1">D{{ String(timeStore.day).padStart(2, "0") }}</span>
        <span class="text-green-800 mr-0.5">|</span>
      </template>

      <button
        v-for="s in speeds"
        :key="s"
        class="px-1.5 py-0.5 text-xs font-mono font-bold transition-all duration-100 min-w-7 text-center border"
        :class="
          timeStore.speed === s
            ? 'border-green-500/50 bg-green-500/10 text-green-300'
            : 'border-transparent text-green-900 hover:text-green-500 hover:border-green-900/50'
        "
        @click="timeStore.setSpeed(s)"
      >
        {{ speedLabel(s) }}
      </button>

      <span class="text-green-800 mx-0.5">|</span>

      <button
        class="p-0.5 text-green-900 hover:text-green-400 transition-colors"
        :title="expanded ? 'Recolher' : 'Expandir'"
        @click="expanded = !expanded"
      >
        <UIcon :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTimeStore, type TimeSpeed } from "@/stores/time";

const timeStore = useTimeStore();
const expanded = ref(true);
const speeds: TimeSpeed[] = [0, 1, 2, 5, 10];

function speedLabel(s: TimeSpeed): string {
  if (s === 0) return "||";
  if (s === 1) return ">";
  return `${s}x`;
}

/** Wheel rotation: noon (0.5) = 0°, midnight (0) = -180° */
const wheelRotation = computed(() => (timeStore.timeOfDay - 0.5) * 360);

const phaseColor = computed(() => {
  const ph = timeStore.phase;
  if (ph === "day") return "#4ade80";
  if (ph === "dawn" || ph === "dusk") return "#ffffff";
  return "#22c55e";
});

// Speedometer tick marks: 9 lines from -90° to +90° around the arc
const TICK_ANGLES = [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90];
const MAJOR_ANGLES = new Set([-90, -45, 0, 45, 90]);

const tickLines = TICK_ANGLES.map((deg, i) => {
  const rad = (deg * Math.PI) / 180;
  const major = MAJOR_ANGLES.has(deg);
  const rOuter = 36;
  const rInner = major ? 30 : 33;
  return {
    i,
    major,
    x1: 40 + rOuter * Math.sin(rad),
    y1: 40 - rOuter * Math.cos(rad),
    x2: 40 + rInner * Math.sin(rad),
    y2: 40 - rInner * Math.cos(rad),
  };
});

// 8 sun rays around (40, 7)
const sunRays = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * 2 * Math.PI;
  return {
    x1: 40 + 5.8 * Math.sin(a),
    y1: 7 - 5.8 * Math.cos(a),
    x2: 40 + 8 * Math.sin(a),
    y2: 7 - 8 * Math.cos(a),
  };
});
</script>

<style scoped>
.clock-slide-enter-active,
.clock-slide-leave-active {
  transition:
    max-height 0.22s ease,
    opacity 0.18s ease;
  max-height: 100px;
  overflow: hidden;
}
.clock-slide-enter-from,
.clock-slide-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
