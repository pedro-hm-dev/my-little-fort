<template>
  <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 border border-green-500/25 bg-black/90 p-2">
    <div class="flex gap-1.5">
      <UTooltip
        v-for="option in options"
        :key="option.type"
        :ui="{ content: 'h-auto items-start py-2' }"
      >
        <template #content>
          <div class="font-mono text-xs space-y-1 max-w-56">
            <div class="text-green-300 uppercase tracking-widest">{{ option.def.label }}</div>

            <div class="text-green-700">{{ option.def.description }}</div>

            <div class="flex flex-wrap gap-x-2 gap-y-0.5 pt-1">
              <span
                v-for="material in option.materials"
                :key="material.type"
                :class="material.enough ? 'text-green-400' : 'text-red-400'"
              >
                {{ material.label }} {{ material.have }}/{{ material.need }}
              </span>
            </div>

            <div class="text-green-700">{{ option.def.buildTimeHours }}h de obra</div>
          </div>
        </template>

        <button
          type="button"
          class="relative w-11 h-11 flex items-center justify-center border transition-colors"
          :class="buttonClass(option)"
          @click="pick(option.type)"
        >
          <UIcon :name="`i-game-icons-${option.def.iconName}`" class="size-6" />
        </button>
      </UTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useSelectionStore } from "@/stores/selection";
import { useInventoryStore } from "@/stores/inventory";
import { buildableDefinitions, type StructureDefinition } from "@/stores/structures";
import type { StructureType } from "@/types/Structure";
import { ResourceType } from "@/types/Resource";

interface BuildOption {
  type: StructureType;
  def: StructureDefinition;
  materials: Array<{ type: ResourceType; label: string; need: number; have: number; enough: boolean }>;
  affordable: boolean;
}

const RESOURCE_LABELS: Partial<Record<ResourceType, string>> = {
  [ResourceType.Wood]: "Madeira",
  [ResourceType.Stone]: "Pedra",
  [ResourceType.Metal]: "Metal",
  [ResourceType.PlantFiber]: "Fibra",
};

const selectionStore = useSelectionStore();
const inventoryStore = useInventoryStore();

const options = computed<BuildOption[]>(() =>
  buildableDefinitions().map(({ type, def }) => {
    const materials = Object.entries(def.buildCost ?? {}).map(([resource, need]) => {
      const have = inventoryStore.getResourceAmount(resource as ResourceType);

      return {
        type: resource as ResourceType,
        label: RESOURCE_LABELS[resource as ResourceType] ?? resource,
        need: need ?? 0,
        have,
        enough: have >= (need ?? 0),
      };
    });

    return { type, def, materials, affordable: materials.every((material) => material.enough) };
  }),
);

function buttonClass(option: BuildOption) {
  const armed = selectionStore.placementType === option.type;

  return {
    "border-yellow-400 bg-yellow-900/30 text-yellow-300": armed,
    "border-green-500/30 bg-green-900/10 text-green-400 hover:bg-green-900/30 hover:border-green-400/50":
      !armed && option.affordable,
    "border-green-900/40 bg-green-900/5 text-green-800 hover:border-green-700/50": !armed && !option.affordable,
  };
}

function pick(type: StructureType) {
  selectionStore.setPlacementType(selectionStore.placementType === type ? null : type);
}
</script>
