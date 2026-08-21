<template>
  <div class="font-mono px-4 py-4 space-y-3">
    <div class="flex items-baseline justify-between text-xs uppercase tracking-widest">
      <span class="text-green-800">Ocupação</span>

      <span class="text-green-300">{{ stored }} / {{ capacity }}</span>
    </div>

    <div class="h-1 w-full bg-green-950">
      <div class="h-full bg-green-500 transition-all duration-300" :style="{ width: fillPercent + '%' }" />
    </div>

    <p v-if="kind === 'nonEdible'" class="text-xs text-green-800">Não guarda comida — ela estraga a céu aberto.</p>

    <div v-if="contents.length === 0" class="text-xs text-green-800 uppercase tracking-widest pt-2">Vazio</div>

    <div v-else class="space-y-1.5 pt-1">
      <div
        v-for="item in contents"
        :key="item.type"
        class="flex items-center gap-3 p-2 border border-green-500/20 bg-green-900/10"
      >
        <UIcon :name="`i-game-icons-${item.icon}`" class="size-5 shrink-0 text-green-400" />

        <span class="flex-1 text-xs text-green-300 uppercase tracking-widest">{{ item.label }}</span>

        <span class="text-xs text-green-500 tabular-nums">{{ item.amount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStructureStore, structureDefinitionOf } from "@/stores/structures";
import { RESOURCE_ICONS, ResourceType } from "@/types/Resource";
import type { Structure } from "@/types/Structure";
import { RESOURCE_LABELS } from "@/utils/resourceLabels";

const props = defineProps<{ structure: Structure }>();

const structureStore = useStructureStore();

const def = computed(() => structureDefinitionOf(props.structure.type));
const capacity = computed(() => def.value?.storage ?? 0);
const kind = computed(() => def.value?.storageKind ?? "all");
const stored = computed(() => structureStore.storedCountOf(props.structure));
const fillPercent = computed(() => (capacity.value === 0 ? 0 : Math.round((stored.value / capacity.value) * 100)));

const contents = computed(() =>
  Object.entries(props.structure.inventory ?? {})
    .filter(([, amount]) => (amount ?? 0) > 0)
    .map(([type, amount]) => ({
      type,
      amount: amount ?? 0,
      icon: RESOURCE_ICONS[type as ResourceType],
      label: RESOURCE_LABELS[type as ResourceType] ?? type,
    }))
    .sort((first, second) => second.amount - first.amount),
);
</script>
