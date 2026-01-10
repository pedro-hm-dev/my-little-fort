import iconsJson from "@iconify-json/game-icons/icons.json";
import { StructureType, type Structure, type Position as StructurePosition } from "@/types/Structure";
import { UnitType, type Unit, type Position as UnitPosition } from "@/types/Unit";
import { type Resource, type Position as ResourcePosition } from "@/types/Resource";
import structureDefinitions from "~/data/structureDefinitions.json";
import unitDefinitions from "~/data/unitDefinitions.json";

// Reuse shared shape for both Unit and Structure positions
export type Point = StructurePosition | UnitPosition | ResourcePosition;

type IconifyIconEntry = {
  body: string;
  width?: number;
  height?: number;
};

type IconifyJson = {
  icons: Record<string, IconifyIconEntry>;
};

const iconImageCache = new Map<string, HTMLImageElement>();
const iconPromiseCache = new Map<string, Promise<HTMLImageElement | null>>();

const DEFAULT_ICON = "sand-castle";

function resolveIconName(entity: Structure | Unit | Resource): string {
  if (entity.iconName) return entity.iconName;

  return DEFAULT_ICON;
}

function buildIconImage(iconName: string, color: string = "white"): Promise<HTMLImageElement | null> {
  const cacheKey = `${iconName}-${color}`;
  const cachedPromise = iconPromiseCache.get(cacheKey);

  if (cachedPromise) return cachedPromise;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const iconEntry = (iconsJson as IconifyJson).icons?.[iconName];

    if (!iconEntry || !iconEntry.body) return resolve(null);

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
      resolve(null);
    };

    img.src = url;
  });

  iconPromiseCache.set(cacheKey, promise);

  return promise;
}

function isUnit(entity: Structure | Unit | Resource): entity is Unit {
  return "baseSpeed" in entity && "speed" in entity;
}

export async function drawEntityIcon(
  ctx: CanvasRenderingContext2D,
  entity: Structure | Unit | Resource,
  position: Point,
  options?: { size?: number }
): Promise<void> {
  const size = options?.size ?? 80;
  const iconName = resolveIconName(entity);

  // Use light green for units, white for others
  const color = isUnit(entity) ? "#90EE90" : "white";
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
 * Preload all icons from structure and unit definitions
 */
export async function preloadAllIcons(): Promise<void> {
  const iconNames = new Set<string>();

  // Collect all icon names from structures
  for (const structureDef of Object.values(structureDefinitions)) {
    iconNames.add(structureDef.iconName);
  }

  // Collect all icon names from units
  for (const unitDef of Object.values(unitDefinitions)) {
    iconNames.add(unitDef.iconName);
  }

  // Preload all unique icons
  await Promise.all(Array.from(iconNames).map((iconName) => buildIconImage(iconName)));
}
