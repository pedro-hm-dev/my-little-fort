import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { useCameraStore } from "@/stores/camera";
import type { Lake, Position } from "@/types/Terrain";
import { distance } from "@/utils/geometry";
import { fbm, noise2D, setGlobalSeed, getSeededRandom } from "@/utils/noise";

// Lake generation configuration
const LAKE_CONFIG = {
  minCount: 4,
  maxCount: 10,
  minGap: 100,
  // Size categories with weights
  sizes: {
    small: { weight: 0.35, minRadius: 80, maxRadius: 160 },
    medium: { weight: 0.4, minRadius: 180, maxRadius: 320 },
    large: { weight: 0.25, minRadius: 350, maxRadius: 550 },
  },
  // Deformation parameters - aumentados para formas mais orgânicas
  baseSegments: 72, // Mais segmentos para curvas suaves
  // Múltiplas camadas de deformação para forma mais natural
  deformation: {
    // Deformação primária (grandes lobos)
    primary: {
      frequency: 2.5, // Frequência baixa = formas grandes
      amplitude: 0.35, // Amplitude alta = muita deformação
    },
    // Deformação secundária (ondulações médias)
    secondary: {
      frequency: 5,
      amplitude: 0.15,
    },
    // Deformação terciária (detalhes pequenos)
    tertiary: {
      frequency: 12,
      amplitude: 0.06,
    },
  },
  // Elongation - estica o lago em uma direção aleatória
  elongation: {
    min: 1.0,
    max: 1.8, // Pode ser até 80% mais longo em uma direção
  },
  smoothingPasses: 1, // Menos suavização para manter deformação
} as const;

export const useWorldStore = defineStore("world", () => {
  const lakes = ref<Lake[]>([]);
  const worldSeed = ref<number>(Date.now());
  const allLakes = computed(() => lakes.value);

  function initialize(seed?: number) {
    const camera = useCameraStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    // Set seed for reproducibility
    worldSeed.value = seed ?? Date.now();
    setGlobalSeed(worldSeed.value);

    lakes.value = generateLakes(width, height);
  }

  function regenerate(seed?: number) {
    initialize(seed);
  }

  return {
    lakes,
    allLakes,
    worldSeed,
    initialize,
    regenerate,
  };
});

/**
 * Generate organic lake shapes using Perlin noise
 */
function generateLakes(width: number, height: number): Lake[] {
  const rng = getSeededRandom();
  const count = rng.intRange(LAKE_CONFIG.minCount, LAKE_CONFIG.maxCount);
  const lakes: Lake[] = [];

  for (let i = 0; i < count; i++) {
    const lake = tryPlaceLake(width, height, lakes, rng);
    if (lake) {
      lakes.push(lake);
    }
  }

  return lakes;
}

/**
 * Try to place a single lake avoiding overlaps
 */
function tryPlaceLake(
  width: number,
  height: number,
  existingLakes: Lake[],
  rng: { next: () => number; range: (min: number, max: number) => number },
): Lake | null {
  // Determine lake size category
  const sizeRoll = rng.next();
  const { sizes } = LAKE_CONFIG;

  let radius: number;
  let sizeCategory: "small" | "medium" | "large";

  if (sizeRoll < sizes.small.weight) {
    sizeCategory = "small";
    radius = rng.range(sizes.small.minRadius, sizes.small.maxRadius);
  } else if (sizeRoll < sizes.small.weight + sizes.medium.weight) {
    sizeCategory = "medium";
    radius = rng.range(sizes.medium.minRadius, sizes.medium.maxRadius);
  } else {
    sizeCategory = "large";
    radius = rng.range(sizes.large.minRadius, sizes.large.maxRadius);
  }

  const margin = Math.max(180, radius + 80);
  const maxTries = 80;

  for (let tries = 0; tries < maxTries; tries++) {
    const cx = rng.range(margin, width - margin);
    const cy = rng.range(margin, height - margin);

    // Check overlap with existing lakes
    let overlaps = false;
    for (const lake of existingLakes) {
      const d = distance({ x: cx, y: cy }, lake.center);
      if (d < radius + lake.radius + LAKE_CONFIG.minGap) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      const outline = generateOrganicOutline(cx, cy, radius, sizeCategory, rng);
      return { center: { x: cx, y: cy }, radius, outline };
    }
  }

  return null;
}

/**
 * Generate an organic lake outline using multiple layers of noise
 * Creates highly irregular shapes like real lakes
 */
function generateOrganicOutline(
  cx: number,
  cy: number,
  baseRadius: number,
  sizeCategory: "small" | "medium" | "large",
  rng: { next: () => number; range: (min: number, max: number) => number },
): Position[] {
  const { deformation, elongation, baseSegments } = LAKE_CONFIG;

  // Mais segmentos para lagos maiores (curvas mais suaves)
  const segments = sizeCategory === "large" ? 96 : sizeCategory === "medium" ? 80 : baseSegments;

  // Offset único para este lago no espaço de noise
  const noiseOffsetX = rng.next() * 1000;
  const noiseOffsetY = rng.next() * 1000;

  // Ângulo de elongação aleatório
  const elongationAngle = rng.next() * Math.PI * 2;
  const elongationFactor = rng.range(elongation.min, elongation.max);

  // Escala de amplitude baseada no tamanho (lagos menores podem ter mais variação relativa)
  const amplitudeScale = sizeCategory === "small" ? 1.2 : sizeCategory === "medium" ? 1.0 : 0.85;

  const outline: Position[] = [];

  for (let k = 0; k < segments; k++) {
    const angle = (Math.PI * 2 * k) / segments;

    // Calcula ponto no espaço de noise baseado no ângulo
    // Usa um círculo no espaço de noise para variação suave
    const noiseRadius = 3;
    const nx = noiseOffsetX + Math.cos(angle) * noiseRadius;
    const ny = noiseOffsetY + Math.sin(angle) * noiseRadius;

    // Camada 1: Deformação primária (grandes lobos e baías)
    const primary =
      fbm(nx * deformation.primary.frequency * 0.01, ny * deformation.primary.frequency * 0.01, 3, 2.0, 0.5) *
      deformation.primary.amplitude *
      amplitudeScale;

    // Camada 2: Deformação secundária (ondulações médias)
    const secondary =
      noise2D(nx * deformation.secondary.frequency * 0.01, ny * deformation.secondary.frequency * 0.01) *
      deformation.secondary.amplitude *
      amplitudeScale;

    // Camada 3: Deformação terciária (pequenos detalhes/ruído)
    const tertiary =
      noise2D(nx * deformation.tertiary.frequency * 0.01, ny * deformation.tertiary.frequency * 0.01) *
      deformation.tertiary.amplitude *
      amplitudeScale;

    // Combina todas as camadas
    const totalDeformation = 1 + primary + secondary + tertiary;

    // Aplica elongação (estica em uma direção)
    const angleDiff = angle - elongationAngle;
    const elongationEffect = 1 + (elongationFactor - 1) * Math.abs(Math.cos(angleDiff));

    // Raio final com todas as deformações
    const r = (baseRadius * totalDeformation) / elongationEffect;

    // Clamp para evitar valores extremos
    const clampedR = Math.max(baseRadius * 0.4, Math.min(baseRadius * 1.6, r));

    outline.push({
      x: cx + Math.cos(angle) * clampedR,
      y: cy + Math.sin(angle) * clampedR,
    });
  }

  // Suavização leve para remover spikes sem perder a forma orgânica
  return smoothOutline(outline, LAKE_CONFIG.smoothingPasses);
}

/**
 * Laplacian smoothing for smoother lake outlines
 */
function smoothOutline(points: Position[], passes: number): Position[] {
  let current = points;

  for (let p = 0; p < passes; p++) {
    const smoothed: Position[] = [];
    const n = current.length;

    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n]!;
      const curr = current[i]!;
      const next = current[(i + 1) % n]!;

      // Weighted average: 50% current, 25% neighbors
      smoothed.push({
        x: curr.x * 0.5 + (prev.x + next.x) * 0.25,
        y: curr.y * 0.5 + (prev.y + next.y) * 0.25,
      });
    }

    current = smoothed;
  }

  return current;
}
