import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { ResourceType } from "@/types/Resource";

export interface InventoryItem {
  type: ResourceType;
  amount: number;
}

export const useInventoryStore = defineStore("inventory", () => {
  const inventory = ref<Map<ResourceType, number>>(new Map());

  const allInventory = computed(() => {
    const items: InventoryItem[] = [];

    for (const [type, amount] of inventory.value.entries()) {
      items.push({ type, amount });
    }

    return items;
  });

  const totalResources = computed(() => {
    let total = 0;

    for (const amount of inventory.value.values()) {
      total += amount;
    }

    return total;
  });

  function addResource(type: ResourceType, amount: number = 1) {
    const current = inventory.value.get(type) || 0;

    inventory.value.set(type, current + amount);
  }

  function getResourceAmount(type: ResourceType): number {
    return inventory.value.get(type) || 0;
  }

  function removeResource(type: ResourceType, amount: number = 1): boolean {
    const current = inventory.value.get(type) || 0;

    if (current < amount) return false;

    const newAmount = current - amount;

    if (newAmount <= 0) {
      inventory.value.delete(type);
    } else {
      inventory.value.set(type, newAmount);
    }

    return true;
  }

  function clear() {
    inventory.value.clear();
  }

  return {
    inventory,
    allInventory,
    totalResources,
    addResource,
    getResourceAmount,
    removeResource,
    clear,
  };
});
