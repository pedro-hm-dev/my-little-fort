<template>
  <USlideover
    :close="{ onClick: () => emit('close') }"
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
          <UIcon name="i-game-icons-open-chest" class="size-4 text-green-400" />
        </div>
        <span>INVENTÁRIO</span>
      </div>
    </template>

    <template #description>
      <span class="font-mono text-green-400">{{ inventoryStore.totalResources }}</span>
      <span class="text-green-800"> unidades</span>
    </template>

    <template #body>
      <div class="px-4 py-4 space-y-1.5 font-mono">
        <!-- empty state -->
        <div
          v-if="sortedInventory.length === 0"
          class="flex flex-col items-center justify-center py-16 space-y-3 text-center"
        >
          <UIcon name="i-game-icons-chest" class="size-14 text-green-900 opacity-60" />
          <p class="text-green-600 text-xs font-mono tracking-widest uppercase">Inventário vazio</p>
          <p class="text-green-900 text-xs leading-relaxed max-w-52 font-mono">
            Clique com o botão direito em recursos no mapa para coletar
          </p>
        </div>

        <!-- resource rows -->
        <div
          v-for="item in sortedInventory"
          :key="item.type"
          class="flex items-center gap-3 p-3 border transition-colors duration-150 cursor-default select-none"
          :style="{
            backgroundColor: getResourceColor(item.type) + '0a',
            borderColor: getResourceColor(item.type) + '30',
          }"
        >
          <!-- icon -->
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center border"
            :style="{
              borderColor: getResourceColor(item.type) + '40',
              backgroundColor: getResourceColor(item.type) + '15',
            }"
          >
            <UIcon :name="getResourceIcon(item.type)" class="size-6" :style="{ color: getResourceColor(item.type) }" />
          </div>

          <!-- label + bar -->
          <div class="flex-1 min-w-0 space-y-1.5">
            <p class="text-xs font-mono uppercase tracking-widest leading-none" :style="{ color: getResourceColor(item.type) }">
              {{ getResourceName(item.type) }}
            </p>
            <div class="h-px w-full bg-green-950 overflow-hidden">
              <div
                class="h-full transition-all duration-500 ease-out"
                :style="{
                  width: getRelativeWidth(item.amount) + '%',
                  backgroundColor: getResourceColor(item.type),
                }"
              />
            </div>
          </div>

          <!-- amount -->
          <div
            class="shrink-0 min-w-10 text-right text-lg font-mono font-bold tabular-nums leading-none"
            :style="{ color: getResourceColor(item.type) }"
          >
            {{ item.amount }}
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full font-mono">
        <div class="flex items-center gap-2 text-green-800">
          <UIcon name="i-game-icons-open-chest" class="size-4" />
          <span class="text-xs tracking-widest uppercase">Total</span>
        </div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-xl font-bold text-green-300 tabular-nums">
            {{ inventoryStore.totalResources }}
          </span>
          <span class="text-xs text-green-800 uppercase tracking-widest font-mono">un</span>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { useInventoryStore } from "@/stores/inventory";
import { RESOURCE_ICONS, ResourceType } from "@/types/Resource";

const inventoryStore = useInventoryStore();

const emit = defineEmits<{ close: [] }>();

const resourceColors: Record<ResourceType, string> = {
  [ResourceType.Wood]: "#a16207",
  [ResourceType.Stone]: "#94a3b8",
  [ResourceType.Metal]: "#71717a",
  [ResourceType.Gold]: "#fbbf24",
  [ResourceType.Fish]: "#38bdf8",
  [ResourceType.Mushroom]: "#4ade80",
  [ResourceType.Cactus]: "#65a30d",
  [ResourceType.Meat]: "#ef4444",
  [ResourceType.Leather]: "#92400e",
  [ResourceType.Algae]: "#0d9488",
  [ResourceType.WhiteMeat]: "#fda4af",
  [ResourceType.Fat]: "#fef3c7",
  [ResourceType.LegendaryFang]: "#c084fc",
  [ResourceType.Poison]: "#65a30d",
  [ResourceType.Egg]: "#fef08a",
  [ResourceType.Carcass]: "#7f1d1d",
};

const resourceNames: Record<ResourceType, string> = {
  [ResourceType.Wood]: "Madeira",
  [ResourceType.Stone]: "Pedra",
  [ResourceType.Metal]: "Metal",
  [ResourceType.Gold]: "Ouro",
  [ResourceType.Fish]: "Peixe",
  [ResourceType.Mushroom]: "Cogumelo",
  [ResourceType.Cactus]: "Cacto",
  [ResourceType.Meat]: "Carne",
  [ResourceType.Leather]: "Couro",
  [ResourceType.Algae]: "Alga",
  [ResourceType.WhiteMeat]: "Carne Branca",
  [ResourceType.Fat]: "Gordura",
  [ResourceType.LegendaryFang]: "Presa Lendária",
  [ResourceType.Poison]: "Veneno",
  [ResourceType.Egg]: "Ovo",
  [ResourceType.Carcass]: "Carcaça",
};

const sortedInventory = computed(() =>
  [...inventoryStore.allInventory].sort((a, b) => b.amount - a.amount),
);

function getRelativeWidth(amount: number): number {
  const max = Math.max(...inventoryStore.allInventory.map((i) => i.amount), 1);
  return Math.round((amount / max) * 100);
}

function getResourceIcon(type: ResourceType): string {
  const icon = RESOURCE_ICONS[type];

  return icon ? `i-game-icons-${icon}` : "i-game-icons-chest";
}

function getResourceColor(type: ResourceType): string {
  return resourceColors[type] ?? "#4ade80";
}

function getResourceName(type: ResourceType): string {
  return resourceNames[type] ?? type;
}
</script>
