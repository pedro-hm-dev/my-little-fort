<template>
  <div
    class="flex flex-col items-center bg-slate-900/85 backdrop-blur-sm rounded-2xl border border-slate-700/50 shadow-2xl select-none overflow-hidden"
    :style="{ boxShadow: `0 0 28px ${glowColor}28, 0 4px 20px rgba(0,0,0,0.6)` }"
  >
    <!-- ── Expanded: semicircle + day info ── -->
    <Transition name="clock-slide">
      <div v-if="expanded" class="flex flex-col items-center w-full">
        <!-- Semicircle SVG — viewBox crops exactly at the horizon (y=36) -->
        <svg viewBox="0 0 72 36" class="w-24 h-12" :style="{ filter: `drop-shadow(0 0 6px ${glowColor}70)` }">
          <defs>
            <!-- Clips everything to the upper semicircle -->
            <clipPath id="semi-clip">
              <rect x="0" y="0" width="72" height="36" />
            </clipPath>

            <clipPath id="circle-clip">
              <circle cx="36" cy="36" r="32" />
            </clipPath>

            <radialGradient id="sky-vignette" cx="50%" cy="0%" r="100%">
              <stop offset="60%" stop-color="transparent" />
              <stop offset="100%" stop-color="rgba(0,0,0,0.45)" />
            </radialGradient>
          </defs>

          <!-- Sky fill (upper semicircle, circle-clipped for rounded top) -->
          <rect x="4" y="4" width="64" height="32" :fill="skyColor" clip-path="url(#circle-clip)" />

          <!-- ── Rotating wheel ── -->
          <g :transform="`rotate(${wheelRotation}, 36, 36)`">
            <!-- Sun -->
            <circle cx="36" cy="9" r="5.5" fill="#FCD34D" />

            <circle cx="36" cy="9" r="9" fill="#FCD34D" opacity="0.15" />

            <line
              v-for="(ray, i) in sunRays"
              :key="`ray-${i}`"
              :x1="ray.x1"
              :y1="ray.y1"
              :x2="ray.x2"
              :y2="ray.y2"
              stroke="#FDE68A"
              stroke-width="1.4"
              stroke-linecap="round"
              opacity="0.8"
            />

            <!-- Moon -->
            <circle cx="36" cy="63" r="5.5" fill="#C7D2FE" />
            <circle cx="38.5" cy="61.5" r="4.5" :fill="moonCutoutFill" />
            <circle cx="36" cy="63" r="8.5" fill="#818CF8" opacity="0.10" />
          </g>

          <!-- Static tick marks (upper-half only: i=0,1,2,6,7) -->
          <circle
            v-for="tick in tickMarks"
            :key="`tick-${tick.i}`"
            :cx="tick.cx"
            :cy="tick.cy"
            r="1.3"
            fill="rgba(255,255,255,0.28)"
          />

          <!-- 12-o'clock indicator -->
          <rect x="35" y="4" width="2" height="4" rx="1" fill="rgba(255,255,255,0.75)" />

          <!-- Vignette -->
          <rect x="0" y="0" width="72" height="36" fill="url(#sky-vignette)" clip-path="url(#circle-clip)" />

          <!-- Outer arc ring -->
          <circle
            cx="36"
            cy="36"
            r="32"
            fill="none"
            stroke="rgba(255,255,255,0.13)"
            stroke-width="1.5"
            clip-path="url(#circle-clip)"
          />

          <!-- Horizon glow line (at the very bottom of the viewport) -->
          <line x1="4" y1="35.5" x2="68" y2="35.5" :stroke="horizonColor" stroke-width="0.8" opacity="0.9" />
        </svg>

        <!-- Day + phase label -->
        <div class="flex items-center justify-center gap-2 w-full px-4 py-1.5 border-b border-slate-700/40">
          <span class="text-xs font-bold text-white tabular-nums tracking-wide">
            Dia {{ timeStore.day }}
          </span>

          <div class="w-px h-3 bg-slate-600 rounded-full" />

          <span class="text-xs font-medium" :style="{ color: phaseColor }">
            {{ timeStore.phaseLabel }}
          </span>
        </div>
      </div>
    </Transition>

    <!-- ── Controls row — always visible ── -->
    <div class="flex items-center gap-0.5 px-2 py-1.5">
      <!-- When collapsed: show quick phase + day indicator -->
      <template v-if="!expanded">
        <span class="text-sm leading-none mr-1" :style="{ filter: `drop-shadow(0 0 4px ${glowColor}90)` }">
          {{ timeStore.isDay ? "☀️" : "🌙" }}
        </span>

        <span class="text-xs font-bold text-slate-300 tabular-nums mr-1">D{{ timeStore.day }}</span>

        <div class="w-px h-3.5 bg-slate-700 rounded-full mr-0.5" />
      </template>

      <!-- Speed buttons -->
      <button
        v-for="s in speeds"
        :key="s"
        class="px-2 py-1 rounded-lg text-xs font-mono font-bold transition-all duration-150 min-w-8 text-center"
        :class="
          timeStore.speed === s
            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-500/40'
            : 'text-slate-500 hover:text-slate-200 hover:bg-slate-700/60'
        "
        @click="timeStore.setSpeed(s)"
      >
        {{ speedLabel(s) }}
      </button>

      <!-- Divider + collapse toggle -->
      <div class="w-px h-3.5 bg-slate-700 rounded-full mx-1" />

      <button
        class="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
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
  if (s === 0) return "⏸";

  if (s === 1) return "▶";

  return `${s}×`;
}

/** Wheel rotation: noon (0.5) = 0°, midnight (0) = -180°, dawn (0.25) = -90° */
const wheelRotation = computed(() => (timeStore.timeOfDay - 0.5) * 360);

// ── Sky colour interpolation ──────────────────────────────────────────────

type RGB = [number, number, number];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpRGB(c1: RGB, c2: RGB, t: number): string {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))})`;
}

const skyKeyframes: Array<[number, RGB]> = [
  [0.0, [2, 6, 23]],
  [0.18, [2, 6, 23]],
  [0.22, [30, 15, 5]],
  [0.28, [180, 60, 10]],
  [0.33, [125, 211, 252]],
  [0.5, [14, 165, 233]],
  [0.67, [125, 211, 252]],
  [0.72, [180, 60, 10]],
  [0.78, [30, 15, 5]],
  [0.82, [2, 6, 23]],
  [1.0, [2, 6, 23]],
];

const skyColor = computed<string>(() => {
  const t = timeStore.timeOfDay;

  for (let i = 0; i < skyKeyframes.length - 1; i++) {
    const [t1, c1] = skyKeyframes[i]!;
    const [t2, c2] = skyKeyframes[i + 1]!;

    if (t >= t1 && t <= t2) return lerpRGB(c1, c2, (t - t1) / (t2 - t1));
  }

  return "rgb(2,6,23)";
});

/** Crescent cutout — always matches the sky (moon is only visible at night = dark sky) */
const moonCutoutFill = computed(() => skyColor.value);

const horizonColor = computed(() => {
  const ph = timeStore.phase;
  if (ph === "dawn" || ph === "dusk") return "rgba(251,146,60,0.85)";

  if (ph === "day") return "rgba(125,211,252,0.4)";

  return "rgba(255,255,255,0.18)";
});

const glowColor = computed(() => {
  const ph = timeStore.phase;

  if (ph === "day") return "#38bdf8";

  if (ph === "dawn" || ph === "dusk") return "#f97316";

  return "#4338ca";
});

const phaseColor = computed(() => {
  const ph = timeStore.phase;

  if (ph === "day") return "#7dd3fc";

  if (ph === "dawn" || ph === "dusk") return "#fb923c";

  return "#818cf8";
});

// ── Precomputed geometry ────────────────────────────────────────────────────

/** 8 sun rays centred on the sun at (36, 9). */
const sunRays = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * 2 * Math.PI;

  return {
    x1: 36 + 7 * Math.sin(a),
    y1: 9 - 7 * Math.cos(a),
    x2: 36 + 10.5 * Math.sin(a),
    y2: 9 - 10.5 * Math.cos(a),
  };
});

/**
 * Tick marks for the UPPER semicircle only.
 * Angles where cy ≤ 36: i ∈ {0,1,2,6,7} at radius 30.
 */
const tickMarks = [0, 1, 2, 6, 7].map((i) => ({
  i,
  cx: 36 + 30 * Math.sin((i / 8) * 2 * Math.PI),
  cy: 36 - 30 * Math.cos((i / 8) * 2 * Math.PI),
}));
</script>

<style scoped>
.clock-slide-enter-active,
.clock-slide-leave-active {
  transition:
    max-height 0.28s ease,
    opacity 0.2s ease;
  max-height: 120px;
  overflow: hidden;
}
.clock-slide-enter-from,
.clock-slide-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
