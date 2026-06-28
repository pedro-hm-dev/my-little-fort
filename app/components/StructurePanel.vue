<template>
  <USlideover
    :open="true"
    :close="{ onClick: () => emit('close') }"
    @update:open="(v) => { if (!v) emit('close') }"
    :ui="{
      content: 'bg-black',
      header: 'border-b border-green-500/20 bg-black',
      body: 'bg-black p-0',
      footer: 'border-t border-green-500/20 bg-black',
      title: 'text-green-300 font-mono font-bold tracking-wider',
      description: 'text-green-800 text-sm mt-0.5 font-mono',
      close: 'top-4 end-4 text-green-800 hover:text-green-300',
    }"
  >
    <template #title>
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center border border-green-500/30 bg-green-500/10">
          <UIcon :name="`i-game-icons-${structureDef.iconName}`" class="size-4 text-green-400" />
        </div>
        <span>{{ structureDef.label.toUpperCase() }}</span>
      </div>
    </template>

    <template #description>
      <span class="font-mono text-green-700">{{ structureDef.description }}</span>
    </template>

    <template #body>
      <!-- Tab bar -->
      <div class="flex border-b border-green-500/20">
        <button
          v-for="tab in tabs"
          :key="tab"
          class="px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors border-b-2"
          :class="
            activeTab === tab
              ? 'text-green-300 border-green-400'
              : 'text-green-800 border-transparent hover:text-green-500'
          "
          @click="activeTab = tab"
        >
          {{ tabLabel(tab) }}
        </button>
      </div>

      <!-- Dynamic tab content -->
      <component
        :is="resolveTabComponent(activeTab)"
        :structure="structure"
      />
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full font-mono">
        <div class="flex items-center gap-2 text-green-800">
          <UIcon name="i-lucide-heart" class="size-4 text-red-900" />
          <span class="text-xs tracking-widest uppercase">Saúde</span>
        </div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-lg font-bold text-green-300 tabular-nums">{{ structure.health }}</span>
          <span class="text-xs text-green-800 tracking-widest">/ {{ structure.maxHealth }}</span>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { type Component } from "vue";
import { type Structure } from "@/types/Structure";
import structureDefs from "@/data/structureDefinitions.json";
import UnitsTab from "./structure-tabs/UnitsTab.vue";

const TAB_COMPONENTS: Record<string, Component> = {
  units: UnitsTab,
};

const TAB_LABELS: Record<string, string> = {
  units: "Unidades",
};

const props = defineProps<{ structure: Structure }>();
const emit = defineEmits<{ close: [] }>();

const structureDef = computed(
  () => structureDefs[props.structure.type as keyof typeof structureDefs]
);

const tabs = computed(
  () => (structureDef.value as { tabs?: string[] }).tabs ?? []
);

const activeTab = ref<string>(tabs.value[0] ?? "");

function tabLabel(tab: string): string {
  return TAB_LABELS[tab] ?? tab;
}

function resolveTabComponent(tab: string): Component | undefined {
  return TAB_COMPONENTS[tab];
}
</script>
