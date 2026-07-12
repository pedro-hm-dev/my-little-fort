import { ref } from "vue";
import { defineStore } from "pinia";
import type { EffectSpec } from "@/types/Combat";

let effectIdCounter = 0;

export const useEffectsStore = defineStore("effects", () => {
  const effects = ref<EffectSpec[]>([]);

  function spawn(spec: Omit<EffectSpec, "id">) {
    effects.value.push({ ...spec, id: `fx-${++effectIdCounter}` });
  }

  function remove(id: string) {
    const index = effects.value.findIndex((e) => e.id === id);
    if (index !== -1) effects.value.splice(index, 1);
  }

  function clear() {
    effects.value = [];
  }

  return { effects, spawn, remove, clear };
});
