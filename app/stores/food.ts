import { computed } from "vue";
import { defineStore } from "pinia";
import { FOOD_RESOURCE_TYPES, type ResourceType } from "@/types/Resource";
import { useUnitStore } from "./units";
import { useInventoryStore } from "./inventory";
import { useSelectionStore } from "./selection";
import { useEffectsStore } from "./effects";

/** Share of max health a unit loses for each day it goes unfed. */
const STARVATION_DAMAGE_RATIO = 0.15;

export const useFoodStore = defineStore("food", () => {
  /** Rations the whole population eats per day, sheltered units included. */
  const dailyFoodNeed = computed(() =>
    useUnitStore().allUnits.reduce((total, unit) => total + unit.foodPerDay, 0),
  );

  const foodStock = computed(() => {
    const inventoryStore = useInventoryStore();

    return FOOD_RESOURCE_TYPES.reduce((total, type) => total + inventoryStore.getResourceAmount(type), 0);
  });

  /** Whole days the current stock covers at the current population. */
  const daysOfFoodLeft = computed(() => {
    if (dailyFoodNeed.value <= 0) return Infinity;

    return Math.floor(foodStock.value / dailyFoodNeed.value);
  });

  /** Stock won't cover the next day rollover — someone is going to starve. */
  const hasFoodShortage = computed(() => dailyFoodNeed.value > 0 && foodStock.value < dailyFoodNeed.value);

  const starvingUnitCount = computed(() => useUnitStore().allUnits.filter((unit) => unit.starving).length);

  /** Takes `amount` rations from the inventory, draining the largest stock first. Returns what it couldn't cover. */
  function takeFood(amount: number): number {
    const inventoryStore = useInventoryStore();
    let remaining = amount;

    while (remaining > 0) {
      let richestType: ResourceType | null = null;
      let richestStock = 0;

      for (const type of FOOD_RESOURCE_TYPES) {
        const stock = inventoryStore.getResourceAmount(type);

        if (stock > richestStock) {
          richestType = type;
          richestStock = stock;
        }
      }

      if (!richestType) break;

      const taken = Math.min(remaining, richestStock);

      inventoryStore.removeResource(richestType, taken);
      remaining -= taken;
    }

    return remaining;
  }

  /**
   * Feeds every unit its daily ration. Whoever goes unfed loses a slice of max health and stays
   * flagged as starving until it eats again; a unit whose health hits zero this way dies.
   * Called once per day rollover from the game store's day watcher.
   */
  function consumeDailyFood() {
    const unitStore = useUnitStore();
    const selectionStore = useSelectionStore();
    const effectsStore = useEffectsStore();
    const starvedToDeath: string[] = [];

    for (const unit of unitStore.allUnits) {
      const missingRations = takeFood(unit.foodPerDay);

      if (missingRations <= 0) {
        unit.starving = false;
        continue;
      }

      unit.starving = true;

      const damage = unit.maxHealth * STARVATION_DAMAGE_RATIO;
      unit.health = Math.max(0, unit.health - damage);

      if (!unit.insideFortId) {
        effectsStore.spawn({
          kind: "damageNumber",
          x: unit.position.x,
          y: unit.position.y,
          offsetX: (Math.random() - 0.5) * 24,
          amount: Math.round(damage),
          durationMs: 1200,
        });
      }

      if (unit.health <= 0) starvedToDeath.push(unit.id);
    }

    for (const id of starvedToDeath) {
      selectionStore.deselectUnit(id);
      unitStore.removeUnit(id);
    }
  }

  return {
    dailyFoodNeed,
    foodStock,
    daysOfFoodLeft,
    hasFoodShortage,
    starvingUnitCount,
    consumeDailyFood,
  };
});
