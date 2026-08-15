/**
 * Simplex-like noise implementation for organic terrain generation
 * Simplified Perlin noise using gradient interpolation
 */

// Seeded random number generator for reproducibility
export class SeededRandom {
  private seed: number;

  constructor(seed: number = Date.now()) {
    this.seed = seed;
  }

  // Mulberry32 PRNG algorithm
  next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Get random in range
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Get random integer in range
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  // Reset seed
  reset(seed?: number): void {
    this.seed = seed ?? Date.now();
  }
}

// Global seeded random instance
let globalRng = new SeededRandom();

export function setGlobalSeed(seed: number): void {
  globalRng = new SeededRandom(seed);
  // Re-shuffle the permutation table too — otherwise the noise field itself never changes between
  // worlds (only the RNG-driven placement does), since it was previously only ever initialized once.
  initPermutation(globalRng);
}

export function getSeededRandom(): SeededRandom {
  return globalRng;
}

// Permutation table for noise
const PERM_SIZE = 256;
let permutation: number[] = [];

function initPermutation(rng: SeededRandom): void {
  permutation = [];
  for (let i = 0; i < PERM_SIZE; i++) {
    permutation[i] = i;
  }
  // Fisher-Yates shuffle with seeded random
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
  }
  // Duplicate for overflow handling
  for (let i = 0; i < PERM_SIZE; i++) {
    permutation[PERM_SIZE + i] = permutation[i]!;
  }
}

// 2D gradient vectors
const GRADIENTS_2D = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function dot2D(g: number[], x: number, y: number): number {
  return g[0]! * x + g[1]! * y;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * 2D Perlin noise function
 * Returns value between -1 and 1
 */
export function noise2D(x: number, y: number): number {
  if (permutation.length === 0) {
    initPermutation(globalRng);
  }

  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;

  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = fade(xf);
  const v = fade(yf);

  const aa = permutation[permutation[X]! + Y]! & 7;
  const ab = permutation[permutation[X]! + Y + 1]! & 7;
  const ba = permutation[permutation[X + 1]! + Y]! & 7;
  const bb = permutation[permutation[X + 1]! + Y + 1]! & 7;

  const x1 = lerp(dot2D(GRADIENTS_2D[aa]!, xf, yf), dot2D(GRADIENTS_2D[ba]!, xf - 1, yf), u);
  const x2 = lerp(dot2D(GRADIENTS_2D[ab]!, xf, yf - 1), dot2D(GRADIENTS_2D[bb]!, xf - 1, yf - 1), u);

  return lerp(x1, x2, v);
}

/**
 * Fractal Brownian Motion (fBm) for more natural looking terrain
 * Combines multiple octaves of noise
 */
export function fbm(
  x: number,
  y: number,
  octaves: number = 4,
  lacunarity: number = 2.0,
  persistence: number = 0.5,
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxValue;
}

/**
 * Normalized noise (0 to 1 range)
 */
export function normalizedNoise(x: number, y: number, scale: number = 1): number {
  return (noise2D(x * scale, y * scale) + 1) / 2;
}

/**
 * Normalized fBm (0 to 1 range)
 */
export function normalizedFbm(x: number, y: number, scale: number = 1, octaves: number = 4): number {
  return (fbm(x * scale, y * scale, octaves) + 1) / 2;
}
