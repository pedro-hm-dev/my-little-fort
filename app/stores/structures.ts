import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { StructureType, type Construction, type Structure, type StorageKind } from "@/types/Structure";
import { FOOD_RESOURCE_TYPES, ResourceType, type Position } from "@/types/Resource";
import structureDefs from "@/data/structureDefinitions.json";
import { useCameraStore } from "./camera";
import { useWorldStore } from "./world";
import { distance, distanceToPolyline } from "@/utils/geometry";

const fortDef = structureDefs.fort;

export interface StructureDefinition {
  type: string;
  label: string;
  description: string;
  maxHealth: number;
  iconName: string;
  iconSize: number;
  solidRadius?: number;
  category?: string;
  /** Materials the site has to be fed before building can start. Absent means it cannot be built. */
  buildCost?: Partial<Record<ResourceType, number>>;
  buildTimeHours?: number;
  /** Population this structure houses — see PLANS.md section 14. */
  housing?: number;
  storage?: number;
  storageKind?: StorageKind;
  /** Workers it takes to operate. Zero occupants means it does nothing at all. */
  workerSlots?: number;
  maxOccupancy?: number;
  canReproduce?: string[];
  /** Unit types allowed inside. Falls back to canReproduce, which is what the fort uses. */
  occupants?: string[];
  tabs?: string[];
}

const DEFS = structureDefs as unknown as Record<string, StructureDefinition>;
/** A building site stands at a fraction of its health — unfinished work is fragile. */
const SITE_HEALTH_FRACTION = 0.25;
const EDIBLE = new Set<ResourceType>(FOOD_RESOURCE_TYPES);

export function structureDefinitionOf(type: string): StructureDefinition | undefined {
  return DEFS[type];
}

/** Every type the build menu can offer, in menu order. */
export function buildableDefinitions(): Array<{ type: StructureType; def: StructureDefinition }> {
  return Object.entries(DEFS)
    .filter(([, def]) => def.buildCost !== undefined)
    .map(([type, def]) => ({ type: type as StructureType, def }));
}

/** Radius of the structure's impassable body, 0 when it can be walked through. */
export function solidRadiusOf(type: string): number {
  return DEFS[type]?.solidRadius ?? 0;
}

/** Unit types this structure lets in. */
export function occupantTypesOf(type: string): string[] {
  const def = DEFS[type];

  return def?.occupants ?? def?.canReproduce ?? [];
}

function getRandomFortPosition(centerX: number, centerY: number): { x: number; y: number } {
  const MAX_DISTANCE = Math.min(centerX, centerY) * 0.5; // 50% of distance from center

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * MAX_DISTANCE;

  const x = centerX + Math.cos(angle) * radius;
  const y = centerY + Math.sin(angle) * radius;

  return { x, y };
}

function createInitialState(): Structure[] {
  const cameraStore = useCameraStore();
  const worldStore = useWorldStore();
  const MAP_CENTER_X = cameraStore.mapWidth / 2;
  const MAP_CENTER_Y = cameraStore.mapHeight / 2;
  let fortPosition = getRandomFortPosition(MAP_CENTER_X, MAP_CENTER_Y);

  // Ensure fort is at least 150 units away from any lake edge or river centerline
  const MIN_DIST = 150;
  const MAX_TRIES = 100;

  for (let tries = 0; tries < MAX_TRIES; tries++) {
    let tooClose = false;

    for (const lake of worldStore.allLakes) {
      const d = Math.hypot(fortPosition.x - lake.center.x, fortPosition.y - lake.center.y);

      if (d <= lake.radius + MIN_DIST) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      for (const river of worldStore.rivers) {
        if (river.path && distanceToPolyline(fortPosition, river.path) <= MIN_DIST) {
          tooClose = true;
          break;
        }
      }
    }

    if (!tooClose) break;

    fortPosition = getRandomFortPosition(MAP_CENTER_X, MAP_CENTER_Y);
  }

  return [
    {
      id: "fort-1",
      type: StructureType.Fort,
      position: fortPosition,
      health: fortDef.maxHealth,
      maxHealth: fortDef.maxHealth,
      iconName: fortDef.iconName,
      iconSize: fortDef.iconSize,
      inventory: {},
    },
  ];
}

let initialState: Structure[] = [];

export const useStructureStore = defineStore("structures", () => {
  const structures = ref<Map<string, Structure>>(new Map());
  let nextId = 1;

  const allStructures = computed(() => Array.from(structures.value.values()));

  /** Finished structures. A building site provides nothing until it is done. */
  const readyStructures = computed(() => allStructures.value.filter((structure) => !structure.construction));

  const fortPosition = computed(() => {
    const fort = structures.value.get("fort-1");
    return fort ? fort.position : null;
  });

  /** Total population the settlement has room for — see PLANS.md section 14. */
  const housingCapacity = computed(() =>
    readyStructures.value.reduce((total, structure) => total + (DEFS[structure.type]?.housing ?? 0), 0),
  );

  const storageStructures = computed(() =>
    readyStructures.value.filter((structure) => (DEFS[structure.type]?.storage ?? 0) > 0),
  );

  const storageCapacity = computed(() =>
    storageStructures.value.reduce((total, structure) => total + (DEFS[structure.type]?.storage ?? 0), 0),
  );

  function addStructure(structure: Structure) {
    structures.value.set(structure.id, structure);
  }

  function removeStructure(id: string) {
    structures.value.delete(id);
  }

  function getStructure(id: string): Structure | undefined {
    return structures.value.get(id);
  }

  function updateStructure(id: string, updates: Partial<Structure>) {
    const structure = structures.value.get(id);

    if (structure) {
      structures.value.set(id, { ...structure, ...updates });
    }
  }

  function storedCountOf(structure: Structure): number {
    let total = 0;

    for (const amount of Object.values(structure.inventory ?? {})) total += amount ?? 0;

    return total;
  }

  function freeSpaceOf(structure: Structure): number {
    return Math.max(0, (DEFS[structure.type]?.storage ?? 0) - storedCountOf(structure));
  }

  /** Whether this structure is willing to hold the type at all, ignoring how full it is. */
  function acceptsResource(structure: Structure, type: ResourceType): boolean {
    const def = DEFS[structure.type];
    if (!def?.storage || structure.construction) return false;

    return def.storageKind === "all" || !EDIBLE.has(type);
  }

  /**
   * Stores what fits and returns how much was taken. The caller decides what to do with the rest —
   * see PLANS.md section 13 for the open question of what happens when the settlement is full.
   */
  function depositInto(structureId: string, type: ResourceType, amount: number): number {
    const structure = structures.value.get(structureId);
    if (!structure || amount <= 0 || !acceptsResource(structure, type)) return 0;

    const stored = Math.min(amount, freeSpaceOf(structure));
    if (stored <= 0) return 0;

    if (!structure.inventory) structure.inventory = {};
    structure.inventory[type] = (structure.inventory[type] ?? 0) + stored;

    return stored;
  }

  /** Takes what is there and returns how much came out. */
  function withdrawFrom(structureId: string, type: ResourceType, amount: number): number {
    const structure = structures.value.get(structureId);
    if (!structure?.inventory || amount <= 0) return 0;

    const available = structure.inventory[type] ?? 0;
    const taken = Math.min(amount, available);
    if (taken <= 0) return 0;

    if (taken >= available) delete structure.inventory[type];
    else structure.inventory[type] = available - taken;

    return taken;
  }

  /** Closest finished storage that would take this type and still has room for it. */
  function nearestStorageAccepting(type: ResourceType, near: Position | null): Structure | null {
    let best: Structure | null = null;
    let bestDistance = Infinity;

    for (const structure of storageStructures.value) {
      if (!acceptsResource(structure, type) || freeSpaceOf(structure) <= 0) continue;

      const gap = near ? distance(near, structure.position) : 0;
      if (gap >= bestDistance) continue;

      bestDistance = gap;
      best = structure;
    }

    return best;
  }

  /** Closest finished storage that actually has some of this type in it. */
  function nearestStorageHolding(type: ResourceType, near: Position | null): Structure | null {
    let best: Structure | null = null;
    let bestDistance = Infinity;

    for (const structure of storageStructures.value) {
      if ((structure.inventory?.[type] ?? 0) <= 0) continue;

      const gap = near ? distance(near, structure.position) : 0;
      if (gap >= bestDistance) continue;

      bestDistance = gap;
      best = structure;
    }

    return best;
  }

  /**
   * Drops a building site at this spot. It starts owing its full cost and at a fraction of its
   * health, so an unfinished site is a fragile thing standing in the open.
   */
  function placeBlueprint(type: StructureType, position: Position): Structure | null {
    const def = DEFS[type];
    if (!def?.buildCost) return null;

    const structure: Structure = {
      id: `${type}-${nextId++}`,
      type,
      position: { x: position.x, y: position.y },
      health: Math.max(1, Math.round(def.maxHealth * SITE_HEALTH_FRACTION)),
      maxHealth: def.maxHealth,
      iconName: def.iconName,
      iconSize: def.iconSize,
      construction: { pending: { ...def.buildCost }, progress: 0 },
      inventory: {},
    };

    structures.value.set(structure.id, structure);

    return structure;
  }

  function cancelBlueprint(structureId: string) {
    const structure = structures.value.get(structureId);
    if (!structure?.construction) return;

    structures.value.delete(structureId);
  }

  /** What the site still needs, largest debt first, so haulers fetch the bottleneck. */
  function pendingMaterialsOf(structureId: string): Array<{ type: ResourceType; amount: number }> {
    const construction = structures.value.get(structureId)?.construction;
    if (!construction) return [];

    return Object.entries(construction.pending)
      .filter(([, amount]) => (amount ?? 0) > 0)
      .map(([type, amount]) => ({ type: type as ResourceType, amount: amount ?? 0 }))
      .sort((first, second) => second.amount - first.amount);
  }

  /** Books delivered material against the site's debt and returns how much it took. */
  function deliverToSite(structureId: string, type: ResourceType, amount: number): number {
    const construction = structures.value.get(structureId)?.construction;
    if (!construction || amount <= 0) return 0;

    const owed = construction.pending[type] ?? 0;
    const accepted = Math.min(amount, owed);
    if (accepted <= 0) return 0;

    if (accepted >= owed) delete construction.pending[type];
    else construction.pending[type] = owed - accepted;

    return accepted;
  }

  function isSiteStocked(structureId: string): boolean {
    return pendingMaterialsOf(structureId).length === 0;
  }

  /** Advances a fully stocked site and finishes it at 1. Returns true on the frame it completes. */
  function advanceConstruction(structureId: string, progressDelta: number): boolean {
    const structure = structures.value.get(structureId);
    if (!structure?.construction || !isSiteStocked(structureId)) return false;

    const progress = structure.construction.progress + progressDelta;

    if (progress < 1) {
      structure.construction.progress = progress;
      return false;
    }

    structures.value.set(structureId, { ...structure, construction: undefined, health: structure.maxHealth });

    return true;
  }

  function initialize() {
    initialState = createInitialState();
    structures.value.clear();
    nextId = 1;

    for (const structure of initialState) {
      structures.value.set(structure.id, structure);
    }
  }

  return {
    structures,
    allStructures,
    readyStructures,
    fortPosition,
    housingCapacity,
    storageStructures,
    storageCapacity,
    addStructure,
    removeStructure,
    getStructure,
    updateStructure,
    storedCountOf,
    freeSpaceOf,
    acceptsResource,
    depositInto,
    withdrawFrom,
    nearestStorageAccepting,
    nearestStorageHolding,
    placeBlueprint,
    cancelBlueprint,
    pendingMaterialsOf,
    deliverToSite,
    isSiteStocked,
    advanceConstruction,
    initialize,
  };
});
