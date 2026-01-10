import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { useCameraStore } from "@/stores/camera";
import type { Lake, Position } from "@/types/Terrain";
import { randRange, distance } from "@/utils/geometry";

export const useWorldStore = defineStore("world", () => {
  const lakes = ref<Lake[]>([]);
  const allLakes = computed(() => lakes.value);

  function initialize() {
    const camera = useCameraStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    lakes.value = generateLakes(width, height);
  }

  return {
    lakes,
    allLakes,
    initialize,
  };
});

function generateLakes(width: number, height: number): Lake[] {
  // Mix of sizes: small, medium, large

  const count = Math.floor(randRange(4, 9));
  const lakes: Lake[] = [];
  const minGap = 60; // Separation gap between lake edges

  for (let i = 0; i < count; i++) {
    // Choose category
    const roll = Math.random();
    const isLarge = roll < 0.3; // ~30% large
    const isSmall = roll > 0.75; // ~25% small
    const radius = isLarge ? randRange(260, 420) : isSmall ? randRange(90, 160) : randRange(170, 280);

    // Margin scales with radius to avoid clipping
    const margin = Math.max(160, radius + 60);

    let cx = randRange(margin, width - margin);
    let cy = randRange(margin, height - margin);

    // Try to place without overlapping existing lakes
    let tries = 0;

    const maxTries = 50;

    while (tries < maxTries) {
      let overlaps = false;

      for (const l of lakes) {
        const d = distance({ x: cx, y: cy }, l.center);

        if (d < radius + l.radius + minGap) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) break;

      cx = randRange(margin, width - margin);
      cy = randRange(margin, height - margin);

      tries++;
    }

    if (tries >= maxTries) {
      // Skip this lake if we couldn't place it reasonably
      continue;
    }

    // Rounded outline with very gentle noise (more rounded for large)
    const outline: Position[] = [];
    const segments = 36 + Math.floor(Math.random() * 16); // 36-52 points for smoothness
    const baseNoiseMin = isLarge ? 0.94 : 0.9;
    const baseNoiseMax = isLarge ? 1.06 : 1.1;

    for (let k = 0; k < segments; k++) {
      const angle = (Math.PI * 2 * k) / segments;
      const noise = randRange(baseNoiseMin, baseNoiseMax);
      const r = radius * noise;

      outline.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }

    lakes.push({ center: { x: cx, y: cy }, radius, outline });
  }

  return lakes;
}
