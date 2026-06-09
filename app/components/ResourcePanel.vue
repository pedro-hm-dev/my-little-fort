<template>
  <USlideover
    :close="{ onClick: () => emit('close') }"
    :ui="{
      content: 'bg-slate-900',
      header: 'border-b border-slate-700/50 bg-slate-900',
      body: 'bg-slate-900 p-0',
      footer: 'border-t border-slate-700/50 bg-slate-900',
      title: 'text-white font-bold',
      description: 'text-slate-400 text-sm mt-0.5',
      close: 'top-4 end-4 text-slate-400 hover:text-white',
    }"
  >
    <template #title>
      <div class="flex items-center gap-2.5">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30"
        >
          <UIcon name="i-heroicons-cube" class="size-4 text-emerald-400" />
        </div>
        <span>Recursos Coletados</span>
      </div>
    </template>

    <template #description>
      <span class="font-semibold text-emerald-400">{{ inventoryStore.totalResources }}</span>
      unidades no inventário
    </template>

    <template #body>
      <div class="px-5 py-4 space-y-2.5">
        <!-- empty state -->
        <div
          v-if="sortedInventory.length === 0"
          class="flex flex-col items-center justify-center py-16 space-y-3 text-center"
        >
          <div class="text-6xl opacity-20 select-none">📦</div>
          <p class="text-slate-300 text-sm font-semibold">Inventário vazio</p>
          <p class="text-slate-500 text-xs leading-relaxed max-w-52">
            Clique com o botão direito em recursos no mapa para coletar
          </p>
        </div>

        <!-- resource cards -->
        <div
          v-for="item in sortedInventory"
          :key="item.type"
          class="flex items-center gap-3.5 p-3.5 rounded-xl border transition-colors duration-150 cursor-default select-none"
          :style="{
            backgroundColor: getResourceColor(item.type) + '0d',
            borderColor: getResourceColor(item.type) + '33',
          }"
        >
          <!-- icon -->
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-2xl"
            :style="{ backgroundColor: getResourceColor(item.type) + '1a' }"
          >
            {{ getResourceEmoji(item.type) }}
          </div>

          <!-- label + progress -->
          <div class="flex-1 min-w-0 space-y-1.5">
            <p class="text-sm font-semibold text-white leading-none">
              {{ getResourceName(item.type) }}
            </p>
            <div class="h-1 w-full rounded-full bg-slate-700/60 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500 ease-out"
                :style="{
                  width: getRelativeWidth(item.amount) + '%',
                  backgroundColor: getResourceColor(item.type),
                }"
              />
            </div>
          </div>

          <!-- amount -->
          <div
            class="shrink-0 min-w-12 text-right text-xl font-bold tabular-nums leading-none"
            :style="{ color: getResourceColor(item.type) }"
          >
            {{ item.amount }}
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2 text-slate-400">
          <UIcon name="i-heroicons-archive-box" class="size-4" />
          <span class="text-sm">Total coletado</span>
        </div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-2xl font-bold text-white tabular-nums">
            {{ inventoryStore.totalResources }}
          </span>
          <span class="text-xs text-slate-500 uppercase tracking-widest font-medium">un</span>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { useInventoryStore } from "@/stores/inventory";
import { ResourceType } from "@/types/Resource";

const inventoryStore = useInventoryStore();

const emit = defineEmits<{ close: [] }>();

const resourceColors: Record<ResourceType, string> = {
  [ResourceType.Food]: "#4ade80",
  [ResourceType.Wood]: "#a16207",
  [ResourceType.Stone]: "#94a3b8",
  [ResourceType.Metal]: "#71717a",
  [ResourceType.Gold]: "#fbbf24",
};

const resourceNames: Record<ResourceType, string> = {
  [ResourceType.Food]: "Comida",
  [ResourceType.Wood]: "Madeira",
  [ResourceType.Stone]: "Pedra",
  [ResourceType.Metal]: "Metal",
  [ResourceType.Gold]: "Ouro",
};

const resourceEmojis: Record<ResourceType, string> = {
  [ResourceType.Food]: "🍞",
  [ResourceType.Wood]: "🌲",
  [ResourceType.Stone]: "🪨",
  [ResourceType.Metal]: "⛏️",
  [ResourceType.Gold]: "💰",
};

const sortedInventory = computed(() =>
  [...inventoryStore.allInventory].sort((a, b) => b.amount - a.amount),
);

function getRelativeWidth(amount: number): number {
  const max = Math.max(...inventoryStore.allInventory.map((i) => i.amount), 1);
  return Math.round((amount / max) * 100);
}

function getResourceEmoji(type: ResourceType): string {
  return resourceEmojis[type] ?? "📦";
}

function getResourceColor(type: ResourceType): string {
  return resourceColors[type] ?? "#ffffff";
}

function getResourceName(type: ResourceType): string {
  return resourceNames[type] ?? type;
}
</script>
