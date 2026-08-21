import { computed } from "vue";
import { defineStore } from "pinia";
import { ResourceType, type Position } from "@/types/Resource";
import { useStructureStore } from "./structures";

export interface InventoryItem {
  type: ResourceType;
  amount: number;
}

/**
 * Not a pot of its own any more: every item lives in some structure's inventory, and this store is
 * the aggregated view over them (PLANS.md section 12). The old API is kept so callers that only care
 * about "how much does the settlement have" do not need to know where it physically sits.
 */
export const useInventoryStore = defineStore("inventory", () => {
  const structureStore = useStructureStore();

  const allInventory = computed(() => {
    const totals = new Map<ResourceType, number>();

    for (const structure of structureStore.allStructures) {
      for (const [type, amount] of Object.entries(structure.inventory ?? {})) {
        if (!amount) continue;

        totals.set(type as ResourceType, (totals.get(type as ResourceType) ?? 0) + amount);
      }
    }

    return [...totals].map(([type, amount]): InventoryItem => ({ type, amount }));
  });

  const totalResources = computed(() => allInventory.value.reduce((total, item) => total + item.amount, 0));

  const capacity = computed(() => structureStore.storageCapacity);

  function getResourceAmount(type: ResourceType): number {
    let total = 0;

    for (const structure of structureStore.allStructures) total += structure.inventory?.[type] ?? 0;

    return total;
  }

  /**
   * Files the resource into the closest storage that will take it, spilling into the next one when
   * that fills. When every storage is full it still goes to the fort: refusing it would mean losing
   * a gathered resource, and what to do at capacity is section 13's call, not this store's.
   */
  function addResource(type: ResourceType, amount: number = 1, near: Position | null = null): number {
    let left = amount;

    while (left > 0) {
      const destination = structureStore.nearestStorageAccepting(type, near);
      if (!destination) break;

      const stored = structureStore.depositInto(destination.id, type, left);
      if (stored <= 0) break;

      left -= stored;
    }

    if (left > 0) {
      const fort = structureStore.getStructure("fort-1");

      if (fort) {
        if (!fort.inventory) fort.inventory = {};
        fort.inventory[type] = (fort.inventory[type] ?? 0) + left;
        left = 0;
      }
    }

    return amount - left;
  }

  /** Takes the amount out of the settlement, closest storage first. False if there was not enough. */
  function removeResource(type: ResourceType, amount: number = 1, near: Position | null = null): boolean {
    if (getResourceAmount(type) < amount) return false;

    let left = amount;

    while (left > 0) {
      const source = structureStore.nearestStorageHolding(type, near) ?? holderOf(type);
      if (!source) break;

      left -= structureStore.withdrawFrom(source.id, type, left);
    }

    return left <= 0;
  }

  /** Fallback for stock sitting in a structure that is not a storage building, like the starting fort. */
  function holderOf(type: ResourceType) {
    return structureStore.allStructures.find((structure) => (structure.inventory?.[type] ?? 0) > 0) ?? null;
  }

  function hasResources(cost: Partial<Record<ResourceType, number>>): boolean {
    return Object.entries(cost).every(([type, needed]) => getResourceAmount(type as ResourceType) >= (needed ?? 0));
  }

  function clear() {
    for (const structure of structureStore.allStructures) {
      if (structure.inventory) structure.inventory = {};
    }
  }

  return {
    allInventory,
    totalResources,
    capacity,
    addResource,
    getResourceAmount,
    removeResource,
    hasResources,
    clear,
  };
});
