<template>
  <div class="font-mono px-4 py-4 space-y-3">
    <div class="flex items-baseline justify-between text-xs uppercase tracking-widest">
      <span class="text-green-800">Trabalhadores</span>

      <span :class="workerCount === 0 ? 'text-red-400' : 'text-green-300'">{{ workerCount }} / {{ slots }}</span>
    </div>

    <div class="flex items-baseline justify-between text-xs uppercase tracking-widest">
      <span class="text-green-800">Rendimento</span>

      <span :class="workerCount === 0 ? 'text-red-400' : 'text-green-300'">{{ efficiencyLabel }}</span>
    </div>

    <p v-if="workerCount === 0" class="text-xs text-red-400/80">
      Parada. Abrigue ao menos uma unidade aqui para ela funcionar.
    </p>

    <p v-else class="text-xs text-green-800">
      Cada trabalhador a mais rende menos que o anterior, mas sempre soma.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUnitStore } from "@/stores/units";
import { structureDefinitionOf } from "@/stores/structures";
import type { Structure } from "@/types/Structure";

const props = defineProps<{ structure: Structure }>();

const unitStore = useUnitStore();

const slots = computed(() => structureDefinitionOf(props.structure.type)?.workerSlots ?? 0);
const workerCount = computed(() => unitStore.unitsInsideFort(props.structure.id).length);
const efficiency = computed(() => unitStore.workerEfficiencyAt(props.structure.id));
const efficiencyLabel = computed(() => (workerCount.value === 0 ? "Ociosa" : `${efficiency.value.toFixed(2)}x`));
</script>
