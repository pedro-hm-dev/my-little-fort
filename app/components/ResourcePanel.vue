<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-50 overflow-hidden">
      <!-- Overlay -->
      <div
        class="absolute inset-0 bg-black/50 transition-opacity"
        @click="$emit('update:modelValue', false)"
      />

      <!-- Slideover Panel -->
      <div class="absolute inset-y-0 right-0 flex max-w-md">
        <div class="relative w-screen max-w-md transform transition-transform duration-300">
          <div class="flex h-full flex-col bg-gray-900 shadow-xl">
            <!-- Header -->
            <div class="px-6 py-6 border-b border-gray-700">
              <div class="flex items-center justify-between">
                <h3 class="text-xl font-bold text-white">Recursos Coletados</h3>

                <button
                  @click="$emit('update:modelValue', false)"
                  class="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
                >
                  <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto px-6 py-6">
              <div class="space-y-3">
                <div v-if="inventoryStore.allInventory.length === 0" class="text-center py-8 text-gray-400">
                  <p>Nenhum recurso coletado ainda</p>

                  <p class="text-sm mt-2">Clique com o botão direito em recursos para coletar</p>
                </div>

                <div
                  v-for="item in inventoryStore.allInventory"
                  :key="item.type"
                  class="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center">
                      <span class="text-2xl" :style="{ color: getResourceColor(item.type) }">
                        {{ getResourceEmoji(item.type) }}
                      </span>
                    </div>

                    <div>
                      <p class="font-semibold text-white capitalize">{{ getResourceName(item.type) }}</p>

                      <p class="text-xs text-gray-400">{{ item.amount }} unidades</p>
                    </div>
                  </div>

                  <div class="text-2xl font-bold" :style="{ color: getResourceColor(item.type) }">
                    {{ item.amount }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div class="border-t border-gray-700 px-6 py-4">
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-400">Total de recursos</span>

                <span class="text-lg font-bold text-white">{{ inventoryStore.totalResources }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useInventoryStore } from "@/stores/inventory";
import { ResourceType } from "@/types/Resource";

const inventoryStore = useInventoryStore();

defineProps<{
  modelValue: boolean;
}>();

defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const resourceColors: Record<ResourceType, string> = {
  [ResourceType.Food]: "#4ade80",
  [ResourceType.Wood]: "#92400e",
  [ResourceType.Stone]: "#6b7280",
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

function getResourceEmoji(type: ResourceType): string {
  return resourceEmojis[type] || "📦";
}

function getResourceColor(type: ResourceType): string {
  return resourceColors[type] || "#ffffff";
}

function getResourceName(type: ResourceType): string {
  return resourceNames[type] || type;
}
</script>
