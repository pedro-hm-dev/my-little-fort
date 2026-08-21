import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { UnitType, type Unit, type Position } from "@/types/Unit";
import type { Structure } from "@/types/Structure";
import type { Enemy } from "@/types/Enemy";
import { RESOURCE_ICONS, type Resource, type ResourceType } from "@/types/Resource";
import unitDefs from "@/data/unitDefinitions.json";
import structureDefs from "@/data/structureDefinitions.json";
import { useStructureStore, solidRadiusOf, structureDefinitionOf, occupantTypesOf } from "./structures";
import { useWorldStore } from "./world";
import { useResourceStore, rollSecondaryYield } from "./resources";
import { useInventoryStore } from "./inventory";
import { useSelectionStore } from "./selection";
import { useEnemyStore } from "./enemies";
import { useEffectsStore } from "./effects";
import { isInWater, distance, approachPoint, evenlySpacedAngles } from "@/utils/geometry";
import { useNavigationStore } from "./navigation";
import { combatRangeFor } from "@/utils/combatEngine";
import actionDefs from "@/data/actionDefinitions.json";
import type { ActionDefinition } from "@/types/Combat";

const TARGET_FRAME_TIME = 1000 / 60;

// Must match FULL_DAY_MS_AT_X1 in time.ts
const FULL_DAY_GAME_MS = 300_000;

/** How far around a resource a gathering unit stands, so a group rings it instead of stacking on top. */
const GATHER_STANDOFF_RADIUS = 35;

type UnitDefKey = keyof typeof unitDefs;
const ACTION_DEFS = actionDefs as unknown as Record<string, ActionDefinition>;

let unitIdCounter = 100;

function spawnUnit(type: UnitType, position: Position): Unit {
  const def = unitDefs[type as UnitDefKey];
  return {
    id: `${type}-${++unitIdCounter}`,
    type,
    position: { ...position },
    health: def.maxHealth,
    maxHealth: def.maxHealth,
    iconName: def.iconName,
    iconBaseSize: def.iconBaseSize,
    iconSize: def.iconSize,
    baseSpeed: def.baseSpeed,
    speed: def.speed,
    baseSwimSpeed: def.baseSwimSpeed,
    swimSpeed: def.swimSpeed,
    baseEfficiency: def.baseEfficiency,
    efficiency: def.efficiency,
    foodPerDay: def.foodPerDay,
    reproductionTimeHours: def.reproductionTimeHours,
    // Um valor no dado, dois no runtime: nada duplicado no JSON, ao contrário de speed/efficiency.
    baseAttack: def.attack,
    attack: def.attack,
    baseDefense: def.defense,
    defense: def.defense,
    actionIds: (def as { actionIds?: string[] }).actionIds ?? [],
    combatRange: combatRangeFor((def as { actionIds?: string[] }).actionIds ?? [], ACTION_DEFS),
    actionCooldowns: {},
  };
}

function createInitialState(): Unit[] {
  const structureStore = useStructureStore();
  const fort = structureStore.getStructure("fort-1");

  if (!fort) throw new Error("Fort must be initialized before units");

  const fx = fort.position.x;
  const fy = fort.position.y;

  const make = (type: UnitType, x: number, y: number, id: string): Unit => ({
    ...spawnUnit(type, { x, y }),
    id,
  });

  return [
    make(UnitType.Worker,  fx - 80,  fy - 80,  "worker-1"),
    make(UnitType.Worker,  fx + 80,  fy - 80,  "worker-2"),
    make(UnitType.Worker,  fx - 80,  fy + 80,  "worker-3"),
    make(UnitType.Worker,  fx + 80,  fy + 80,  "worker-4"),
    make(UnitType.Soldier, fx,       fy - 110, "soldier-1"),
    make(UnitType.Archer,  fx + 110, fy,       "archer-1"),
    make(UnitType.Hunter,  fx - 110, fy,       "hunter-1"),
  ];
}

export const useUnitStore = defineStore("units", () => {
  const units = ref<Map<string, Unit>>(new Map());
  const worldStore = useWorldStore();

  const pendingReproduction = ref<{ fortId: string; targetType: UnitType } | null>(null);
  let idleHaulTimer = 0;

  function startPendingReproduction(fortId: string, targetType: UnitType) {
    if (isAtPopulationCap()) return;

    pendingReproduction.value = { fortId, targetType };
  }

  function clearPendingReproduction() {
    pendingReproduction.value = null;
  }

  /** All units including those inside a fort */
  const allUnits = computed(() => Array.from(units.value.values()));

  /** Only units present on the map (not inside a fort) */
  const mapUnits = computed(() => allUnits.value.filter((u) => !u.insideFortId));

  /** Units currently inside a specific fort */
  function unitsInsideFort(fortId: string): Unit[] {
    return allUnits.value.filter((u) => u.insideFortId === fortId);
  }

  function addUnit(unit: Unit) {
    units.value.set(unit.id, unit);
  }

  function removeUnit(id: string) {
    units.value.delete(id);
  }

  function getUnit(id: string): Unit | undefined {
    return units.value.get(id);
  }

  function updateUnit(id: string, updates: Partial<Unit>) {
    const unit = units.value.get(id);
    if (unit) units.value.set(id, { ...unit, ...updates });
  }

  /**
   * Live units, counting the ones sheltered inside structures. Reproduction is the only way a unit
   * enters the game, so the housing cap only has to be checked there (PLANS.md section 14).
   */
  const population = computed(() => allUnits.value.length);

  function isAtPopulationCap(): boolean {
    return population.value >= useStructureStore().housingCapacity;
  }

  /** Send a selected map unit into the fort to reproduce, creating a new unit of targetType. */
  function startReproduction(unitId: string, targetType: UnitType, fortId: string) {
    const unit = units.value.get(unitId);
    const selectionStore = useSelectionStore();
    if (!unit || unit.insideFortId) return;

    const structureStore = useStructureStore();
    const fort = structureStore.getStructure(fortId);
    if (!fort) return;

    const def = structureDefOf(fort);
    if (structureOccupancy(fortId) >= (def.maxOccupancy ?? Infinity)) return;
    if (isAtPopulationCap()) return;

    pendingReproduction.value = null;

    selectionStore.deselectUnit(unitId);

    units.value.set(unitId, {
      ...unit,
      insideFortId: fortId,
      reproductionProgress: 0,
      reproductionTargetType: targetType,
      targetPosition: undefined,
      targetResource: undefined,
      gatherProgress: undefined,
    });
  }

  /** Exit the fort immediately at its entrance — cancels any in-progress reproduction too. */
  function exitShelter(unitId: string) {
    const unit = units.value.get(unitId);
    if (!unit || !unit.insideFortId) return;

    const structureStore = useStructureStore();
    const fort = structureStore.getStructure(unit.insideFortId);
    const base = fort ? fort.position : unit.position;

    units.value.set(unitId, {
      ...unit,
      insideFortId: undefined,
      reproductionProgress: undefined,
      reproductionTargetType: undefined,
      position: { x: base.x + 60 + Math.random() * 40, y: base.y + (Math.random() - 0.5) * 80 },
    });
  }

  /**
   * Called every frame with the scaled game delta.
   * Advances reproduction progress and heals units inside forts.
   */
  function updateFortUnits(gameDeltaMs: number) {
    const structureStore = useStructureStore();

    for (const unit of units.value.values()) {
      if (!unit.insideFortId) continue;

      // Heal: 1% maxHealth per game hour — suspended while starving, so shelter can't outheal hunger.
      const healPerMs = unit.starving ? 0 : unit.maxHealth / (100 * (FULL_DAY_GAME_MS / 24));
      const newHealth = Math.min(unit.maxHealth, unit.health + healPerMs * gameDeltaMs);

      // Advance reproduction
      let newProgress = unit.reproductionProgress;
      let complete = false;

      if (newProgress !== undefined && unit.reproductionTargetType !== undefined) {
        const progressPerMs = 1 / (unit.reproductionTimeHours * (FULL_DAY_GAME_MS / 24));
        newProgress = newProgress + progressPerMs * gameDeltaMs;
        if (newProgress >= 1) complete = true;
      }

      if (complete && unit.reproductionTargetType) {
        const fort = structureStore.getStructure(unit.insideFortId);
        const base = fort ? fort.position : unit.position;
        const angle = Math.random() * Math.PI * 2;
        const spawnPos = {
          x: base.x + Math.cos(angle) * (70 + Math.random() * 40),
          y: base.y + Math.sin(angle) * (70 + Math.random() * 40),
        };

        // Spawn new unit
        const newUnit = spawnUnit(unit.reproductionTargetType, spawnPos);
        units.value.set(newUnit.id, newUnit);

        // Original unit exits fort (opposite side from spawn)
        units.value.set(unit.id, {
          ...unit,
          health: newHealth,
          insideFortId: undefined,
          reproductionProgress: undefined,
          reproductionTargetType: undefined,
          position: { x: base.x - Math.cos(angle) * 80, y: base.y - Math.sin(angle) * 80 },
        });
      } else {
        units.value.set(unit.id, { ...unit, health: newHealth, reproductionProgress: newProgress });
      }
    }
  }

  /** How much material a unit carries per trip to a building site. */
  const HAUL_LOAD = 12;
  /** How often idle units are offered dropped goods to haul. */
  const IDLE_HAUL_CHECK_MS = 400;
  /** Each extra worker in a structure contributes this share of the previous one. */
  const WORKER_DIMINISHING_RETURN = 0.6;
  /** Slack on top of the site's solid body: how close counts as "at the site". */
  const WORK_REACH = 55;

  /**
   * Sends units to work a building site: they fetch what it still owes, then raise it.
   * Any other order cancels it, and whatever was in hand goes back to storage.
   */
  function buildStructure(unitIds: string[], structureId: string) {
    const structureStore = useStructureStore();
    const site = structureStore.getStructure(structureId);
    if (!site?.construction) return;

    const angles = evenlySpacedAngles(unitIds.length);
    const standoff = solidRadiusOf(site.type) + WORK_REACH * 0.6;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;

      const angle = angles[index]!;

      units.value.set(id, {
        ...unit,
        buildTargetId: structureId,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        combatTargetId: undefined,
        combatTargetIsStructure: undefined,
        combatQueue: undefined,
        shelterTargetId: undefined,
        targetPosition: {
          x: site.position.x + Math.cos(angle) * standoff,
          y: site.position.y + Math.sin(angle) * standoff,
        },
      });
    });
  }

  /** Puts whatever the unit is carrying back into storage and returns the fields that clear the order. */
  function releaseBuildOrder(unit: Unit): Partial<Unit> {
    if (unit.hauling) {
      useInventoryStore().addResource(unit.hauling.type, unit.hauling.amount, unit.position);
    }

    return { buildTargetId: undefined, hauling: undefined, haulSourceId: undefined };
  }

  function moveUnitsTo(unitIds: string[], targetX: number, targetY: number) {
    if (unitIds.length === 1) {
      const id = unitIds[0];
      if (!id) return;
      const unit = units.value.get(id);
      if (unit) {
        units.value.set(id, {
          ...unit,
          ...releaseBuildOrder(unit),
          targetPosition: { x: targetX, y: targetY },
          targetResource: undefined,
          gatherProgress: undefined,
        });
      }
    } else {
      const scatterRadius = 50 + unitIds.length * 15;
      unitIds.forEach((id) => {
        const unit = units.value.get(id);
        if (unit) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * scatterRadius;
          units.value.set(id, {
            ...unit,
            ...releaseBuildOrder(unit),
            targetPosition: { x: targetX + Math.cos(angle) * dist, y: targetY + Math.sin(angle) * dist },
            targetResource: undefined,
            gatherProgress: undefined,
          });
        }
      });
    }
  }

  function gatherResource(unitIds: string[], resourceId: string) {
    const resourceStore = useResourceStore();
    const resource = resourceStore.getResource(resourceId);
    if (!resource) return;

    if (unitIds.length === 1) {
      const id = unitIds[0];
      if (!id) return;
      const unit = units.value.get(id);
      if (unit) {
        units.value.set(id, {
          ...unit,
          targetPosition: { x: resource.position.x, y: resource.position.y },
          targetResource: resourceId,
          gatherProgress: 0,
        });
      }
    } else {
      const angles = evenlySpacedAngles(unitIds.length);
      unitIds.forEach((id, index) => {
        const unit = units.value.get(id);
        if (unit) {
          const angle = angles[index]!;
          units.value.set(id, {
            ...unit,
            targetPosition: {
              x: resource.position.x + Math.cos(angle) * GATHER_STANDOFF_RADIUS,
              y: resource.position.y + Math.sin(angle) * GATHER_STANDOFF_RADIUS,
            },
            targetResource: resourceId,
            gatherProgress: 0,
          });
        }
      });
    }
  }

  /** Order units to engage an enemy: close to 90% of their combat range, then let the combat store take over.
   * A group spreads around the enemy in a ring (each at its own combat range) instead of converging on one spot. */
  function attackTarget(unitIds: string[], enemyId: string) {
    const enemyStore = useEnemyStore();
    const enemy = enemyStore.getEnemy(enemyId);
    if (!enemy) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (unit.combatRange <= 0 || unit.actionIds.length === 0) return;

      const standoff = unit.combatRange * 0.9;
      const targetPosition = angles
        ? { x: enemy.position.x + Math.cos(angles[index]!) * standoff, y: enemy.position.y + Math.sin(angles[index]!) * standoff }
        : approachPoint(unit.position, enemy.position, standoff);

      units.value.set(id, {
        ...unit,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        shelterTargetId: undefined,
        combatTargetId: enemyId,
        combatTargetIsStructure: false,
        combatQueue: undefined,
        targetPosition,
      });
    });
  }

  /** Queue a set of enemies (e.g. from an area selection) for each unit, nearest first, and engage the closest.
   * A group spreads around its (usually shared) nearest enemy in a ring instead of converging on one spot. */
  function attackArea(unitIds: string[], enemyIds: string[]) {
    const enemyStore = useEnemyStore();
    const enemies = enemyIds.map((id) => enemyStore.getEnemy(id)).filter((e): e is Enemy => !!e);
    if (enemies.length === 0) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (unit.combatRange <= 0 || unit.actionIds.length === 0) return;

      const sorted = [...enemies].sort(
        (a, b) => distance(unit.position, a.position) - distance(unit.position, b.position),
      );
      const [first, ...rest] = sorted;
      if (!first) return;

      const standoff = unit.combatRange * 0.9;
      const targetPosition = angles
        ? { x: first.position.x + Math.cos(angles[index]!) * standoff, y: first.position.y + Math.sin(angles[index]!) * standoff }
        : approachPoint(unit.position, first.position, standoff);

      units.value.set(id, {
        ...unit,
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        shelterTargetId: undefined,
        combatTargetId: first.id,
        combatTargetIsStructure: false,
        combatQueue: rest.map((e) => e.id),
        targetPosition,
      });
    });
  }

  /** Pops the next reachable resource off a unit's gather queue, or clears gathering state if none remain. */
  function nextGatherState(gatherQueue: string[] | undefined): Partial<Unit> {
    const resourceStore = useResourceStore();
    const queue = gatherQueue ? [...gatherQueue] : [];

    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) continue;

      const resource = resourceStore.getResource(nextId);
      if (resource) {
        // No sibling-unit context here (this runs per-unit as its own queue advances), so just a
        // random offset rather than a full ring — still keeps it off the resource's exact center.
        const angle = Math.random() * Math.PI * 2;
        return {
          targetResource: nextId,
          targetPosition: {
            x: resource.position.x + Math.cos(angle) * GATHER_STANDOFF_RADIUS,
            y: resource.position.y + Math.sin(angle) * GATHER_STANDOFF_RADIUS,
          },
          gatherProgress: 0,
          gatherQueue: queue.length > 0 ? queue : undefined,
        };
      }
    }

    return { targetResource: undefined, targetPosition: undefined, gatherProgress: undefined, gatherQueue: undefined };
  }

  /** Queue a set of resources (e.g. from an area selection) for each unit, nearest first, and start gathering.
   * A group rings its (usually shared) nearest resource instead of every unit stacking on the exact same spot. */
  function gatherResources(unitIds: string[], resourceIds: string[]) {
    const resourceStore = useResourceStore();
    const resources = resourceIds.map((id) => resourceStore.getResource(id)).filter((r): r is Resource => !!r);
    if (resources.length === 0) return;

    const angles = unitIds.length > 1 ? evenlySpacedAngles(unitIds.length) : null;

    unitIds.forEach((id, index) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;

      const sorted = [...resources].sort(
        (a, b) => distance(unit.position, a.position) - distance(unit.position, b.position),
      );
      const [first, ...rest] = sorted;
      if (!first) return;

      const targetPosition = angles
        ? {
            x: first.position.x + Math.cos(angles[index]!) * GATHER_STANDOFF_RADIUS,
            y: first.position.y + Math.sin(angles[index]!) * GATHER_STANDOFF_RADIUS,
          }
        : { ...first.position };

      units.value.set(id, {
        ...unit,
        combatTargetId: undefined,
        combatTargetIsStructure: undefined,
        combatQueue: undefined,
        shelterTargetId: undefined,
        targetPosition,
        targetResource: first.id,
        gatherProgress: 0,
        gatherQueue: rest.map((r) => r.id),
      });
    });
  }

  /** Queue every resource currently on the map for each unit, nearest first, and start gathering. */
  function gatherAll(unitIds: string[]) {
    const resourceStore = useResourceStore();
    gatherResources(unitIds, resourceStore.allResources.map((r) => r.id));
  }

  /** Definition of a structure's type, for capacity/eligibility lookups. */
  function structureDefOf(structure: Structure) {
    return structureDefs[structure.type as keyof typeof structureDefs] as {
      canReproduce?: string[];
      maxOccupancy?: number;
    };
  }

  /**
   * How hard a worked structure is running: 0 with nobody inside, and rising with each extra worker
   * at diminishing returns, so a second smith helps a lot and a fourth barely shows.
   */
  function workerEfficiencyAt(structureId: string): number {
    const workers = unitsInsideFort(structureId);
    if (workers.length === 0) return 0;

    return workers
      .slice()
      .sort((first, second) => second.efficiency - first.efficiency)
      .reduce((total, worker, index) => total + worker.efficiency * WORKER_DIMINISHING_RETURN ** index, 0);
  }

  /** Units currently occupying a structure: already inside it, plus those already walking toward it to shelter. */
  function structureOccupancy(structureId: string): number {
    return allUnits.value.filter((u) => u.insideFortId === structureId || u.shelterTargetId === structureId).length;
  }

  /** Send units to take shelter inside a specific structure, skipping any that don't fit or that it doesn't have room for. */
  function shelterUnitsAt(unitIds: string[], structureId: string) {
    const structureStore = useStructureStore();
    const structure = structureStore.getStructure(structureId);
    if (!structure) return;

    const def = structureDefOf(structure);
    const maxOccupancy = def.maxOccupancy ?? Infinity;
    const allowed = occupantTypesOf(structure.type);
    let occupancy = structureOccupancy(structureId);

    // A site is not a building yet: nobody moves in until it is finished.
    if (structure.construction) return;

    unitIds.forEach((id) => {
      const unit = units.value.get(id);
      if (!unit || unit.insideFortId) return;
      if (!allowed.includes(unit.type)) return;
      if (occupancy >= maxOccupancy) return;

      occupancy++;

      units.value.set(id, {
        ...unit,
        ...releaseBuildOrder(unit),
        targetResource: undefined,
        gatherProgress: undefined,
        gatherQueue: undefined,
        combatTargetId: undefined,
        combatTargetIsStructure: undefined,
        shelterTargetId: structure.id,
        targetPosition: { ...structure.position },
      });
    });
  }

  /**
   * One tick of a unit working a building site: fetch what the site owes, deliver it, then raise it.
   * Returns the point to walk to, or undefined when there is nothing useful to do this tick.
   */
  function tickBuilder(unit: Unit, gameDeltaMs: number): Position | undefined {
    const structureStore = useStructureStore();
    const site = structureStore.getStructure(unit.buildTargetId!);

    if (!site?.construction) {
      units.value.set(unit.id, { ...unit, ...releaseBuildOrder(unit) });
      return undefined;
    }

    const reach = solidRadiusOf(site.type) + WORK_REACH;

    if (unit.hauling) {
      if (distance(unit.position, site.position) > reach) return site.position;

      const delivered = structureStore.deliverToSite(site.id, unit.hauling.type, unit.hauling.amount);
      const leftOver = unit.hauling.amount - delivered;

      // The site's debt may have been paid by someone else while this load was in transit.
      if (leftOver > 0) useInventoryStore().addResource(unit.hauling.type, leftOver, unit.position);

      unit.hauling = undefined;

      return undefined;
    }

    if (!structureStore.isSiteStocked(site.id)) {
      const source = unit.haulSourceId ? structureStore.getStructure(unit.haulSourceId) : null;

      if (source) {
        if (distance(unit.position, source.position) > solidRadiusOf(source.type) + WORK_REACH) return source.position;

        const needed = structureStore.pendingMaterialsOf(site.id).find((material) => material.type === wantedFrom(source, site.id));
        const taken = needed ? structureStore.withdrawFrom(source.id, needed.type, Math.min(HAUL_LOAD, needed.amount)) : 0;

        unit.haulSourceId = undefined;
        if (taken > 0) unit.hauling = { type: needed!.type, amount: taken };

        return undefined;
      }

      for (const material of structureStore.pendingMaterialsOf(site.id)) {
        const holder = structureStore.nearestStorageHolding(material.type, unit.position);
        if (!holder) continue;

        unit.haulSourceId = holder.id;

        return holder.position;
      }

      // Nothing in store to fetch: wait at the site instead of walking off.
      return distance(unit.position, site.position) > reach ? site.position : undefined;
    }

    if (distance(unit.position, site.position) > reach) return site.position;

    const buildHours = structureDefinitionOf(site.type)?.buildTimeHours ?? 1;
    const progressPerMs = unit.efficiency / (buildHours * (FULL_DAY_GAME_MS / 24));

    structureStore.advanceConstruction(site.id, progressPerMs * gameDeltaMs);

    return undefined;
  }

  /** Which pending material this source can actually supply — the one it holds most of. */
  function wantedFrom(source: Structure, siteId: string): ResourceType | undefined {
    const structureStore = useStructureStore();
    let best: ResourceType | undefined;
    let bestStock = 0;

    for (const material of structureStore.pendingMaterialsOf(siteId)) {
      const stock = source.inventory?.[material.type] ?? 0;
      if (stock <= bestStock) continue;

      bestStock = stock;
      best = material.type;
    }

    return best;
  }

  /** Nothing to do: no order of any kind, and not shut inside a structure. */
  function isIdle(unit: Unit): boolean {
    return (
      !unit.insideFortId &&
      !unit.targetPosition &&
      !unit.targetResource &&
      !unit.combatTargetId &&
      !unit.buildTargetId &&
      !unit.shelterTargetId &&
      !unit.actionLock
    );
  }

  /**
   * Hands dropped goods to whoever has nothing better to do, closest pile first, and only when some
   * store would actually take that type — otherwise the haul would end with the pile back on the
   * ground. Checked a few times a second rather than every frame.
   */
  function assignIdleHauling(gameDeltaMs: number) {
    idleHaulTimer += gameDeltaMs;
    if (idleHaulTimer < IDLE_HAUL_CHECK_MS) return;

    idleHaulTimer = 0;

    const resourceStore = useResourceStore();
    const piles = resourceStore.droppedPiles;
    if (piles.length === 0) return;

    const structureStore = useStructureStore();
    const haulable = piles.filter((pile) => structureStore.nearestStorageAccepting(pile.type, pile.position) !== null);
    if (haulable.length === 0) return;

    const claimed = new Set<string>();

    for (const unit of units.value.values()) {
      if (!isIdle(unit)) continue;

      let target: Resource | null = null;
      let bestDistance = Infinity;

      for (const pile of haulable) {
        if (claimed.has(pile.id)) continue;

        const gap = distance(unit.position, pile.position);
        if (gap >= bestDistance) continue;

        bestDistance = gap;
        target = pile;
      }

      if (!target) break;

      claimed.add(target.id);
      gatherResource([unit.id], target.id);
    }
  }

  function updateUnitPositions(gameDeltaMs: number) {
    const resourceStore = useResourceStore();
    const inventoryStore = useInventoryStore();
    const effectsStore = useEffectsStore();
    const navigationStore = useNavigationStore();
    const deltaMultiplier = gameDeltaMs / TARGET_FRAME_TIME;
    const lakesCache = worldStore.allWaterBodies;

    for (const unit of units.value.values()) {
      // Skip units inside a fort
      if (unit.insideFortId) continue;

      if (unit.buildTargetId) {
        // Any other order wins: gather, attack and shelter all cancel the building order.
        if (unit.targetResource || unit.combatTargetId || unit.shelterTargetId) {
          units.value.set(unit.id, { ...unit, ...releaseBuildOrder(unit) });
        } else {
          const workSpot = tickBuilder(unit, gameDeltaMs);

          unit.targetPosition = workSpot ? { ...workSpot } : undefined;
          if (!unit.targetPosition) continue;
        }
      }

      if (unit.targetResource) {
        const resource = resourceStore.getResource(unit.targetResource);
        if (!resource) {
          units.value.set(unit.id, { ...unit, ...nextGatherState(unit.gatherQueue) });
          continue;
        }

        const dx = resource.position.x - unit.position.x;
        const dy = resource.position.y - unit.position.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < 50 * 50) {
          // Uma pilha caída só faz sentido recolher se existe onde guardar; senão ela voltaria ao chão.
          if (resource.dropped && !useStructureStore().nearestStorageAccepting(resource.type, unit.position)) {
            units.value.set(unit.id, { ...unit, ...nextGatherState(unit.gatherQueue) });
            continue;
          }

          const gatherRate = (unit.efficiency / resource.gatherTime) * deltaMultiplier;
          const newProgress = (unit.gatherProgress || 0) + gatherRate;

          if (newProgress >= 1) {
            // A carcass yields whatever loot is left inside it; every other resource yields its own type.
            const collected = resource.contents?.shift() ?? resource.type;
            const depleted = resourceStore.depleteResource(unit.targetResource, 1);
            const secondary = rollSecondaryYield(resource.type);

            inventoryStore.addResource(collected, 1, unit.position);
            effectsStore.spawn({
              kind: "gatherNumber",
              x: unit.position.x,
              y: unit.position.y,
              offsetX: (Math.random() - 0.5) * 20,
              amount: 1,
              iconName: RESOURCE_ICONS[collected] ?? resource.iconName,
              durationMs: 900,
            });

            if (secondary) {
              inventoryStore.addResource(secondary, 1, unit.position);
              effectsStore.spawn({
                kind: "gatherNumber",
                x: unit.position.x,
                y: unit.position.y,
                offsetX: (Math.random() - 0.5) * 20 + 18,
                amount: 1,
                iconName: RESOURCE_ICONS[secondary],
                durationMs: 900,
              });
            }

            if (depleted) {
              units.value.set(unit.id, { ...unit, ...nextGatherState(unit.gatherQueue) });
            } else {
              units.value.set(unit.id, { ...unit, gatherProgress: 0 });
            }
          } else {
            units.value.set(unit.id, { ...unit, gatherProgress: newProgress });
          }
          continue;
        }
      }

      // Chase an attack order to 90% of combat range; stand still mid-swing.
      if (unit.combatTargetId && !unit.combatTargetIsStructure && !unit.actionLock) {
        const enemyStore = useEnemyStore();
        const target = enemyStore.getEnemy(unit.combatTargetId);
        if (target) {
          unit.targetPosition = approachPoint(unit.position, target.position, unit.combatRange * 0.9);
        }
      }

      if (!unit.targetPosition) continue;

      // The immediate step, which is the destination itself unless something solid is in the way.
      const steer = navigationStore.routeTo(unit, unit.targetPosition, gameDeltaMs);
      const dx = steer.x - unit.position.x;
      const dy = steer.y - unit.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        unit.position.x = steer.x;
        unit.position.y = steer.y;
        navigationStore.clearPath(unit);

        if (unit.shelterTargetId) {
          units.value.set(unit.id, { ...unit, insideFortId: unit.shelterTargetId, shelterTargetId: undefined, targetPosition: undefined });
          continue;
        }

        if (!unit.targetResource) unit.targetPosition = undefined;
      } else {
        const inLake = isInWater(unit.position.x, unit.position.y, lakesCache);
        const effSpeed = inLake ? unit.swimSpeed : unit.speed;
        const frameSpeed = effSpeed * deltaMultiplier;
        const actualSpeed = Math.min(frameSpeed, dist);
        unit.position.x += (dx / dist) * actualSpeed;
        unit.position.y += (dy / dist) * actualSpeed;
      }
    }
  }

  function initialize() {
    units.value.clear();
    for (const unit of createInitialState()) {
      units.value.set(unit.id, unit);
    }
  }

  return {
    units,
    allUnits,
    mapUnits,
    unitsInsideFort,
    addUnit,
    removeUnit,
    getUnit,
    updateUnit,
    startReproduction,
    buildStructure,
    exitShelter,
    updateFortUnits,
    moveUnitsTo,
    gatherResource,
    gatherResources,
    attackTarget,
    attackArea,
    gatherAll,
    shelterUnitsAt,
    assignIdleHauling,
    structureOccupancy,
    workerEfficiencyAt,
    updateUnitPositions,
    initialize,
    population,
    isAtPopulationCap,
    pendingReproduction,
    startPendingReproduction,
    clearPendingReproduction,
  };
});
