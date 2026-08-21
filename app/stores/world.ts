import { ref, computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { useCameraStore } from "@/stores/camera";
import { BiomeType, type BiomeRegion, type Lake, type Position } from "@/types/Terrain";
import { distance, outlineBounds } from "@/utils/geometry";
import { generateBiomeMap, regionIndexAt, type BiomeMap } from "@/utils/biomeMap";
import { fbm, noise2D, setGlobalSeed, getSeededRandom } from "@/utils/noise";

// Lake generation configuration
const LAKE_CONFIG = {
  minCount: 4,
  maxCount: 9,
  minGap: 100,
  sizes: {
    small: { weight: 0.35, minRadius: 80, maxRadius: 160 },
    medium: { weight: 0.4, minRadius: 180, maxRadius: 320 },
    large: { weight: 0.25, minRadius: 350, maxRadius: 550 },
  },
  baseSegments: 72,
  // Layered deformation — primary/secondary/tertiary are progressively finer wobble on top of the
  // base radius. "bay" is a separate, high-contrast, sparse layer that only kicks in past a threshold,
  // carving occasional inlets/peninsulas instead of a uniformly wobbly edge.
  deformation: {
    primary: { frequency: 2.2, amplitude: 0.4 },
    secondary: { frequency: 5, amplitude: 0.18 },
    tertiary: { frequency: 13, amplitude: 0.07 },
    bay: { frequency: 3.5, amplitude: 0.6, threshold: 0.55 },
  },
  // Domain warp: perturbs the *sampling coordinates* of the deformation noise with a second,
  // independent noise field. This is what actually breaks the "wobbly circle" look — plain
  // multi-octave noise on an angle->radius parameterization still reads as an oval no matter how
  // many octaves you stack, because the radius is always a smooth function of angle around one
  // center. Warping the input coordinates lets bulges/inlets appear at irregular, non-radial spots.
  warp: { frequency: 1.6, strength: 0.9 },
  smoothingPasses: 3,
} as const;

const RIVER_CONFIG = {
  minCount: 1,
  maxCount: 3,
  minWidth: 50,
  maxWidth: 100,
  segmentLength: 90,
  wanderStrength: 130,
  // How fast the wander noise's sampling coordinate advances along the path — higher means more
  // wiggles over the same length, not just bigger swings (that's wanderStrength's job).
  wanderRate: 10,
  smoothingPasses: 4,
} as const;

// A lake can get a single, smooth, deep "bite" on one side plus a matching elongation on the
// opposite axis — reads as a bean/kidney shape instead of a wobbly circle. Only some lakes get it,
// so the map still has a mix of shapes.
const BEAN_CONFIG = {
  chance: 0.55,
  dentDepth: 0.5,
  dentWidth: 0.9,
  elongation: 1.3,
} as const;

// Biome generation lives in utils/biomeMap.ts: a rasterized Voronoi that partitions the whole map.
// Grassland is a biome like any other now, not the value returned when a point misses every blob.
const BIOME_GRID_CELL_SIZE = 50;
const BIOME_SEED_COUNT = 34;
/**
 * Domain warp that ragges up the Voronoi borders. The strength has to be a real fraction of the
 * average cell span (~850 units at 34 seeds) or the borders stay axis-aligned, which is exactly the
 * grid-of-rectangles look we're avoiding. Two octaves of scale give both big lobes and small bites.
 */
const BIOME_WARP_SCALE = 0.00055;
const BIOME_WARP_STRENGTH = 900;
const BIOME_WARP_DETAIL_SCALE = 0.0022;
const BIOME_WARP_DETAIL_STRENGTH = 260;

/** Matches BIOME_GRID_CELL_SIZE: a coarser texture would resample the borders down and blur them. */
const BIOME_TEXTURE_CELL_SIZE = 50;

// Mais separados em matiz e luminosidade do que eram: enquanto grassland era o fundo de tudo, um
// contraste sutil bastava. Com o mapa particionado por inteiro, biomas quase iguais viram um borrão.
const BIOME_COLORS: Record<BiomeType, string> = {
  [BiomeType.Grassland]: "#25321f",
  [BiomeType.Forest]: "#152417",
  [BiomeType.Desert]: "#3b2e18",
  [BiomeType.Tundra]: "#1f3038",
  [BiomeType.Mountain]: "#33333a",
};


function buildBiomeTexture(width: number, height: number, map: BiomeMap): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;

  const cols = Math.ceil(width / BIOME_TEXTURE_CELL_SIZE);
  const rows = Math.ceil(height / BIOME_TEXTURE_CELL_SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Reads the generation grid instead of testing polygons: with a full partition this ran ~4000
  // point-in-polygon queries against large concave rings.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const worldX = (col + 0.5) * BIOME_TEXTURE_CELL_SIZE;
      const worldY = (row + 0.5) * BIOME_TEXTURE_CELL_SIZE;
      const region = map.regions[regionIndexAt(map, worldX, worldY)];

      ctx.fillStyle = BIOME_COLORS[region?.biome ?? BiomeType.Grassland];
      ctx.fillRect(col, row, 1, 1);
    }
  }

  return canvas;
}

export const useWorldStore = defineStore("world", () => {
  // shallowRef, not ref: these hold polygons of 58-96 vertices each, and isInWater walks them for
  // every enemy every frame. Deep reactivity made each vertex access a proxy get — measured at 11x
  // the cost of plain objects, which was ~74% of updateEnemyAI. The arrays are only ever replaced
  // wholesale on world generation, so shallow reactivity is also the semantically correct choice.
  const lakes = shallowRef<Lake[]>([]);
  const rivers = shallowRef<Lake[]>([]);
  const biomeRegions = shallowRef<BiomeRegion[]>([]);
  /** Grid kept from generation: turns biomeAt/regionAt into an array index instead of a polygon walk. */
  const biomeMap = shallowRef<BiomeMap | null>(null);
  const biomeTexture = shallowRef<HTMLCanvasElement | null>(null);
  const worldSeed = ref<number>(Date.now());

  const allLakes = computed(() => lakes.value);
  /** Lakes + rivers together — what movement/placement/AI checks should treat as "water." */
  const allWaterBodies = computed<Lake[]>(() => [...lakes.value, ...rivers.value]);

  /** Biome at a world point. The map is fully partitioned, so this always lands in some region. */
  function biomeAt(x: number, y: number): BiomeType {
    return regionAt(x, y)?.biome ?? BiomeType.Grassland;
  }

  /**
   * How many regions of each biome this generated world ended up with. Every BiomeType is present,
   * zero included, so callers can tell "no desert on this map" apart from "field missing".
   * Grassland is the default fill rather than a placed blob, so it is always 0.
   */
  const regionCountByBiome = computed<Record<BiomeType, number>>(() => {
    const counts = Object.fromEntries(Object.values(BiomeType).map((biome) => [biome, 0])) as Record<BiomeType, number>;

    for (const region of biomeRegions.value) counts[region.biome]++;

    return counts;
  });

  function regionsOfBiome(biome: BiomeType): BiomeRegion[] {
    return biomeRegions.value.filter((region) => region.biome === biome);
  }

  /**
   * The region containing a point. O(1) through the generation grid — with a full partition every
   * point belongs to a region, so walking polygons per call would be far costlier than when most
   * points fell through to a default.
   */
  function regionAt(x: number, y: number): BiomeRegion | null {
    const map = biomeMap.value;
    if (!map) return null;

    const index = regionIndexAt(map, x, y);

    return index < 0 ? null : biomeRegions.value[index] ?? null;
  }

  function initialize(seed?: number) {
    const camera = useCameraStore();
    const width = camera.mapWidth;
    const height = camera.mapHeight;

    worldSeed.value = seed ?? Date.now();
    setGlobalSeed(worldSeed.value);

    const rng = getSeededRandom();

    lakes.value = generateLakes(width, height, rng);
    rivers.value = generateRivers(width, height, rng);
    const generated = generateBiomeMap({
      width,
      height,
      cellSize: BIOME_GRID_CELL_SIZE,
      seedCount: BIOME_SEED_COUNT,
      random: () => rng.next(),
      // Domain warp: displace the sample before the nearest-seed test, so borders wander.
      warp: (x, y) => ({
        x:
          x +
          fbm(x * BIOME_WARP_SCALE, y * BIOME_WARP_SCALE, 3) * BIOME_WARP_STRENGTH +
          fbm(x * BIOME_WARP_DETAIL_SCALE, y * BIOME_WARP_DETAIL_SCALE, 2) * BIOME_WARP_DETAIL_STRENGTH,
        y:
          y +
          fbm((x + 1731) * BIOME_WARP_SCALE, (y - 977) * BIOME_WARP_SCALE, 3) * BIOME_WARP_STRENGTH +
          fbm((x - 611) * BIOME_WARP_DETAIL_SCALE, (y + 409) * BIOME_WARP_DETAIL_SCALE, 2) *
            BIOME_WARP_DETAIL_STRENGTH,
      }),
    });

    biomeMap.value = generated;
    biomeRegions.value = generated.regions;
    biomeTexture.value = buildBiomeTexture(width, height, generated);
  }

  function regenerate(seed?: number) {
    initialize(seed);
  }

  return {
    lakes,
    rivers,
    allLakes,
    allWaterBodies,
    biomeRegions,
    regionCountByBiome,
    regionsOfBiome,
    regionAt,
    biomeTexture,
    worldSeed,
    biomeAt,
    initialize,
    regenerate,
  };
});

type RNG = { next: () => number; range: (min: number, max: number) => number; intRange: (min: number, max: number) => number };

/** Generate organic lake shapes using domain-warped noise. */
function generateLakes(width: number, height: number, rng: RNG): Lake[] {
  const count = rng.intRange(LAKE_CONFIG.minCount, LAKE_CONFIG.maxCount);
  const lakes: Lake[] = [];

  for (let i = 0; i < count; i++) {
    const lake = tryPlaceLake(width, height, lakes, rng);
    if (lake) lakes.push(lake);
  }

  return lakes;
}

function tryPlaceLake(width: number, height: number, existingLakes: Lake[], rng: RNG): Lake | null {
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

    let overlaps = false;
    for (const lake of existingLakes) {
      const d = distance({ x: cx, y: cy }, lake.center);
      if (d < radius + lake.radius + LAKE_CONFIG.minGap) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      const beanAngle = rng.next() < BEAN_CONFIG.chance ? rng.next() * Math.PI * 2 : null;
      const outline = generateOrganicOutline(cx, cy, radius, sizeCategory, rng, beanAngle);
      return { center: { x: cx, y: cy }, radius, outline, bounds: outlineBounds(outline), kind: "lake" };
    }
  }

  return null;
}

/** Shortest signed angular distance from b to a, wrapped to [-pi, pi]. */
function angleDiffWrapped(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Generate an organic blob outline via domain-warped, multi-octave angle->radius sampling. Used for
 * lakes and land biome regions alike — it's a purely geometric shape generator, no water semantics.
 * `beanAngle`, lakes only: carves one smooth deep dent at that angle plus a matching elongation on
 * the perpendicular axis, so the lake reads as a bean/kidney shape instead of a wobbly circle. */
function generateOrganicOutline(
  cx: number,
  cy: number,
  baseRadius: number,
  sizeCategory: "small" | "medium" | "large",
  rng: RNG,
  beanAngle: number | null = null,
): Position[] {
  const { deformation, warp, baseSegments } = LAKE_CONFIG;

  const segments = sizeCategory === "large" ? 96 : sizeCategory === "medium" ? 80 : baseSegments;

  const noiseOffsetX = rng.next() * 1000;
  const noiseOffsetY = rng.next() * 1000;
  const warpOffsetX = rng.next() * 1000;
  const warpOffsetY = rng.next() * 1000;
  const bayOffsetX = rng.next() * 1000;
  const bayOffsetY = rng.next() * 1000;

  const amplitudeScale = sizeCategory === "small" ? 1.2 : sizeCategory === "medium" ? 1.0 : 0.85;

  const outline: Position[] = [];

  for (let k = 0; k < segments; k++) {
    const angle = (Math.PI * 2 * k) / segments;
    const noiseRadius = 3;
    const ax = Math.cos(angle) * noiseRadius;
    const ay = Math.sin(angle) * noiseRadius;

    const warpX = fbm((warpOffsetX + ax) * warp.frequency * 0.01, (warpOffsetY + ay) * warp.frequency * 0.01, 2);
    const warpY = fbm(
      (warpOffsetX + ax + 37) * warp.frequency * 0.01,
      (warpOffsetY + ay + 37) * warp.frequency * 0.01,
      2,
    );

    const nx = noiseOffsetX + ax + warpX * warp.strength;
    const ny = noiseOffsetY + ay + warpY * warp.strength;

    const primary =
      fbm(nx * deformation.primary.frequency * 0.01, ny * deformation.primary.frequency * 0.01, 3, 2.0, 0.5) *
      deformation.primary.amplitude *
      amplitudeScale;

    const secondary =
      noise2D(nx * deformation.secondary.frequency * 0.01, ny * deformation.secondary.frequency * 0.01) *
      deformation.secondary.amplitude *
      amplitudeScale;

    const tertiary =
      noise2D(nx * deformation.tertiary.frequency * 0.01, ny * deformation.tertiary.frequency * 0.01) *
      deformation.tertiary.amplitude *
      amplitudeScale;

    const bayNoise = noise2D(
      (bayOffsetX + ax) * deformation.bay.frequency * 0.01,
      (bayOffsetY + ay) * deformation.bay.frequency * 0.01,
    );
    const bay = bayNoise > deformation.bay.threshold ? -(bayNoise - deformation.bay.threshold) * deformation.bay.amplitude : 0;

    let totalDeformation = 1 + primary + secondary + tertiary + bay;

    if (beanAngle !== null) {
      const dentDiff = angleDiffWrapped(angle, beanAngle);
      const dent =
        Math.exp(-(dentDiff * dentDiff) / (2 * BEAN_CONFIG.dentWidth * BEAN_CONFIG.dentWidth)) * BEAN_CONFIG.dentDepth;
      totalDeformation -= dent;

      const elongationAxis = beanAngle + Math.PI / 2;
      const elongationDiff = Math.cos(angle - elongationAxis);
      totalDeformation *= 1 + (BEAN_CONFIG.elongation - 1) * elongationDiff * elongationDiff;
    }

    const r = baseRadius * totalDeformation;
    // Same 1.5x ceiling regardless of the bean dent/elongation above — isInWater's fast bounding-radius
    // precheck assumes no outline point ever exceeds radius * 1.5, so this clamp must stay in sync.
    const clampedR = Math.max(baseRadius * 0.35, Math.min(baseRadius * 1.5, r));

    outline.push({ x: cx + Math.cos(angle) * clampedR, y: cy + Math.sin(angle) * clampedR });
  }

  return smoothOutline(outline, LAKE_CONFIG.smoothingPasses);
}

/** Laplacian smoothing for smoother lake/river/biome-region outlines. */
function smoothOutline(points: Position[], passes: number): Position[] {
  let current = points;

  for (let p = 0; p < passes; p++) {
    const smoothed: Position[] = [];
    const n = current.length;

    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n]!;
      const curr = current[i]!;
      const next = current[(i + 1) % n]!;

      smoothed.push({
        x: curr.x * 0.5 + (prev.x + next.x) * 0.25,
        y: curr.y * 0.5 + (prev.y + next.y) * 0.25,
      });
    }

    current = smoothed;
  }

  return current;
}

/** Same Laplacian smoothing as smoothOutline, but for an open polyline — endpoints stay put (a river
 * must still meet the map edge exactly) and only the interior points get pulled toward their neighbors. */
function smoothPath(points: Position[], passes: number): Position[] {
  let current = points;
  if (current.length < 3) return current;

  for (let p = 0; p < passes; p++) {
    const smoothed: Position[] = [current[0]!];

    for (let i = 1; i < current.length - 1; i++) {
      const prev = current[i - 1]!;
      const curr = current[i]!;
      const next = current[i + 1]!;

      smoothed.push({
        x: curr.x * 0.5 + (prev.x + next.x) * 0.25,
        y: curr.y * 0.5 + (prev.y + next.y) * 0.25,
      });
    }

    smoothed.push(current[current.length - 1]!);
    current = smoothed;
  }

  return current;
}

/** Rivers behave like lakes for movement (same isInWater/swimSpeed path) — just a long thin polygon instead of a blob. */
function generateRivers(width: number, height: number, rng: RNG): Lake[] {
  const count = rng.intRange(RIVER_CONFIG.minCount, RIVER_CONFIG.maxCount);
  const rivers: Lake[] = [];

  for (let i = 0; i < count; i++) {
    rivers.push(generateRiver(width, height, rng));
  }

  return rivers;
}

function pointOnEdge(edge: number, width: number, height: number, rng: RNG): Position {
  switch (edge) {
    case 0:
      return { x: rng.range(0, width), y: 0 };
    case 1:
      return { x: width, y: rng.range(0, height) };
    case 2:
      return { x: rng.range(0, width), y: height };
    default:
      return { x: 0, y: rng.range(0, height) };
  }
}

function generateRiver(width: number, height: number, rng: RNG): Lake {
  const entryEdge = rng.intRange(0, 3);
  let exitEdge = rng.intRange(0, 3);
  while (exitEdge === entryEdge) exitEdge = rng.intRange(0, 3);

  const entry = pointOnEdge(entryEdge, width, height, rng);
  const exit = pointOnEdge(exitEdge, width, height, rng);

  const wanderOffsetX = rng.next() * 1000;
  const wanderOffsetY = rng.next() * 1000;
  const widthOffset = rng.next() * 1000;

  const dx = exit.x - entry.x;
  const dy = exit.y - entry.y;
  const straightLen = Math.hypot(dx, dy) || 1;
  const perpX = -dy / straightLen;
  const perpY = dx / straightLen;

  const steps = Math.max(8, Math.round(straightLen / RIVER_CONFIG.segmentLength));
  const path: Position[] = [];

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const baseX = entry.x + dx * t;
    const baseY = entry.y + dy * t;

    // Taper the wander to 0 at both ends so the river actually meets the map edge cleanly.
    const taper = Math.sin(Math.PI * t);
    const wander =
      fbm(wanderOffsetX + t * RIVER_CONFIG.wanderRate, wanderOffsetY + t * RIVER_CONFIG.wanderRate, 3) *
      RIVER_CONFIG.wanderStrength *
      taper;

    path.push({ x: baseX + perpX * wander, y: baseY + perpY * wander });
  }

  const smoothedPath = smoothPath(path, RIVER_CONFIG.smoothingPasses);

  const left: Position[] = [];
  const right: Position[] = [];

  for (let i = 0; i < smoothedPath.length; i++) {
    const prev = smoothedPath[Math.max(0, i - 1)]!;
    const next = smoothedPath[Math.min(smoothedPath.length - 1, i + 1)]!;
    const segDx = next.x - prev.x;
    const segDy = next.y - prev.y;
    const segLen = Math.hypot(segDx, segDy) || 1;
    const nx = -segDy / segLen;
    const ny = segDx / segLen;

    const widthT = (noise2D((widthOffset + i) * 0.15, 0) + 1) / 2;
    const halfWidth = (RIVER_CONFIG.minWidth + widthT * (RIVER_CONFIG.maxWidth - RIVER_CONFIG.minWidth)) / 2;

    const p = smoothedPath[i]!;
    left.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth });
    right.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth });
  }

  const outline = [...left, ...right.reverse()];

  const center = smoothedPath[Math.floor(smoothedPath.length / 2)]!;
  let maxDistFromCenter = 0;
  for (const p of smoothedPath) {
    maxDistFromCenter = Math.max(maxDistFromCenter, distance(p, center));
  }

  return {
    center,
    radius: maxDistFromCenter + RIVER_CONFIG.maxWidth,
    outline,
    bounds: outlineBounds(outline),
    path: smoothedPath,
    kind: "river",
  };
}

/** Places one or two large blobs per biome type — reuses the lake's organic-outline generator, avoiding overlap between regions. */
