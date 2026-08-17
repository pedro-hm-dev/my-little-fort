import iconsJson from "@iconify-json/game-icons/icons.json";
import { StructureType, type Structure, type Position as StructurePosition } from "@/types/Structure";
import { UnitType, type Unit, type Position as UnitPosition } from "@/types/Unit";
import { type Resource, type Position as ResourcePosition } from "@/types/Resource";
import { type Enemy, type Position as EnemyPosition } from "@/types/Enemy";
import structureDefinitions from "~/data/structureDefinitions.json";
import unitDefinitions from "~/data/unitDefinitions.json";
import resourceDefinitions from "~/data/resourceDefinitions.json";
import enemyDefinitions from "~/data/enemyDefinitions.json";

// Reuse shared shape for both Unit and Structure positions
export type Point = StructurePosition | UnitPosition | ResourcePosition | EnemyPosition;

type IconifyIconEntry = {
  body: string;
  width?: number;
  height?: number;
};

type IconifyJson = {
  icons: Record<string, IconifyIconEntry>;
};

// Optimized caches with WeakRef support for memory efficiency
const iconImageCache = new Map<string, HTMLImageElement>();
const iconPromiseCache = new Map<string, Promise<HTMLImageElement | null>>();
const failedIcons = new Set<string>(); // Track failed icons to avoid retries

const DEFAULT_ICON = "sand-castle";

// Color palette for different entity types
const ENTITY_COLORS = {
  unit: "#90EE90", // Light green
  structure: "#FFFFFF", // White
  resource: "#F0E68C", // Khaki/gold
  enemy: "#ef4444", // Red — hostile
} as const;

/** Status markers drawn over an entity rather than as one — preloaded so the render loop never waits. */
export const STATUS_ICONS = {
  starving: { name: "stomach", color: "#fb923c" },
} as const;

function resolveIconName(entity: Structure | Unit | Resource | Enemy): string {
  if (entity.iconName) return entity.iconName;
  return DEFAULT_ICON;
}

function getEntityColor(entity: Structure | Unit | Resource | Enemy): string {
  if (isEnemy(entity)) return ENTITY_COLORS.enemy;
  if (isUnit(entity)) return ENTITY_COLORS.unit;
  if (isStructure(entity)) return ENTITY_COLORS.structure;
  return ENTITY_COLORS.resource;
}

function buildIconImage(iconName: string, color: string = "white"): Promise<HTMLImageElement | null> {
  const cacheKey = `${iconName}-${color}`;

  // Check if this icon previously failed
  if (failedIcons.has(cacheKey)) {
    return Promise.resolve(null);
  }

  const cachedPromise = iconPromiseCache.get(cacheKey);
  if (cachedPromise) return cachedPromise;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const iconEntry = (iconsJson as IconifyJson).icons?.[iconName];

    if (!iconEntry || !iconEntry.body) {
      failedIcons.add(cacheKey);
      return resolve(null);
    }

    const width = iconEntry.width ?? 512;
    const height = iconEntry.height ?? 512;

    // Replace currentColor with specified color
    const body = iconEntry.body.replace(/currentColor/g, color);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="${color}">${body}</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      iconImageCache.set(cacheKey, img);
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      failedIcons.add(cacheKey);
      resolve(null);
    };

    img.src = url;
  });

  iconPromiseCache.set(cacheKey, promise);

  return promise;
}

function isUnit(entity: Structure | Unit | Resource | Enemy): entity is Unit {
  return "baseSpeed" in entity && "speed" in entity;
}

function isEnemy(entity: Structure | Unit | Resource | Enemy): entity is Enemy {
  return "behavior" in entity && "combatRange" in entity;
}

function isStructure(entity: Structure | Unit | Resource | Enemy): entity is Structure {
  return "health" in entity && "maxHealth" in entity && !("baseSpeed" in entity) && !("behavior" in entity);
}

export async function drawEntityIcon(
  ctx: CanvasRenderingContext2D,
  entity: Structure | Unit | Resource | Enemy,
  position: Point,
  options?: { size?: number },
): Promise<void> {
  const size = options?.size ?? 80;
  const iconName = resolveIconName(entity);
  const color = getEntityColor(entity);
  const cacheKey = `${iconName}-${color}`;

  const cached = iconImageCache.get(cacheKey);

  if (cached) {
    ctx.drawImage(cached, position.x - size / 2, position.y - size / 2, size, size);
    return;
  }

  const img = await buildIconImage(iconName, color);

  if (!img) return;

  ctx.drawImage(img, position.x - size / 2, position.y - size / 2, size, size);
}

/**
 * Synchronous draw for cached icons (use in render loops)
 * Returns false if icon not cached yet
 */
export function drawEntityIconSync(
  ctx: CanvasRenderingContext2D,
  entity: Structure | Unit | Resource | Enemy,
  position: Point,
  options?: { size?: number },
): boolean {
  const size = options?.size ?? 80;
  const iconName = resolveIconName(entity);
  const color = getEntityColor(entity);
  const cacheKey = `${iconName}-${color}`;

  const cached = iconImageCache.get(cacheKey);

  if (cached) {
    ctx.drawImage(cached, position.x - size / 2, position.y - size / 2, size, size);
    return true;
  }

  // Start loading in background if not already
  buildIconImage(iconName, color);
  return false;
}

/** Synchronous draw of a named icon (status markers). Returns false if it isn't cached yet. */
export function drawIconSync(
  ctx: CanvasRenderingContext2D,
  icon: { name: string; color: string },
  position: Point,
  size: number,
): boolean {
  const cached = iconImageCache.get(`${icon.name}-${icon.color}`);

  if (cached) {
    ctx.drawImage(cached, position.x - size / 2, position.y - size / 2, size, size);
    return true;
  }

  buildIconImage(icon.name, icon.color);
  return false;
}

/**
 * Preload all icons from structure, unit, and resource definitions
 */
export async function preloadAllIcons(): Promise<void> {
  const iconColorPairs: Array<{ name: string; color: string }> = [];

  // Collect all icon names from structures (white)
  for (const structureDef of Object.values(structureDefinitions)) {
    iconColorPairs.push({ name: structureDef.iconName, color: ENTITY_COLORS.structure });
  }

  // Collect all icon names from units (light green)
  for (const unitDef of Object.values(unitDefinitions)) {
    iconColorPairs.push({ name: unitDef.iconName, color: ENTITY_COLORS.unit });
  }

  // Collect all icon names from resources (khaki)
  for (const resourceDef of Object.values(resourceDefinitions)) {
    iconColorPairs.push({
      name: (resourceDef as { iconName: string }).iconName,
      color: ENTITY_COLORS.resource,
    });
  }

  // Collect all icon names from enemies (red)
  for (const enemyDef of Object.values(enemyDefinitions)) {
    iconColorPairs.push({ name: enemyDef.iconName, color: ENTITY_COLORS.enemy });
  }

  // Status markers (own colors, not tied to an entity type)
  for (const icon of Object.values(STATUS_ICONS)) {
    iconColorPairs.push({ name: icon.name, color: icon.color });
  }

  // Preload all unique icon+color combinations
  const uniquePairs = new Map<string, { name: string; color: string }>();
  for (const pair of iconColorPairs) {
    const key = `${pair.name}-${pair.color}`;
    uniquePairs.set(key, pair);
  }

  await Promise.all(Array.from(uniquePairs.values()).map(({ name, color }) => buildIconImage(name, color)));
}

/**
 * Clear all caches (useful for memory management)
 */
export function clearIconCache(): void {
  iconImageCache.clear();
  iconPromiseCache.clear();
  failedIcons.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getIconCacheStats(): { cached: number; pending: number; failed: number } {
  return {
    cached: iconImageCache.size,
    pending: iconPromiseCache.size - iconImageCache.size,
    failed: failedIcons.size,
  };
}
