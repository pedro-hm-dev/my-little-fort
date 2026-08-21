<template>
  <UModal
    :open="true"
    :close="{ onClick: closeModal }"
    @update:open="handleUpdateOpen"
    :ui="{
      content: 'bg-black border border-green-500/20',
      header: 'border-b border-green-500/20 bg-black',
      body: 'bg-black',
      footer: 'border-t border-green-500/20 bg-black',
      title: 'text-green-300 font-mono font-bold tracking-wider',
      description: 'text-green-800 text-sm mt-0.5 font-mono',
      close: 'top-4 end-4 text-green-800 hover:text-green-300',
    }"
  >
    <template #title>
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center border border-green-500/30 bg-green-500/10">
          <UIcon name="i-game-icons-nest-eggs" class="size-4 text-green-400" />
        </div>
        <span>NINHO — {{ enemyLabel.toUpperCase() }}</span>
      </div>
    </template>

    <template #body>
      <div v-if="nest.state === 'cooldown'" class="px-1 py-2 font-mono text-sm text-green-700 space-y-2">
        <p>O ninho está vazio.</p>
        <p class="text-green-800">Respawna no dia <span class="text-green-400">{{ nest.respawnAtDay }}</span>.</p>
      </div>

      <div v-else class="px-1 py-2 font-mono space-y-3">
        <p class="text-sm text-green-700">O que fazer com o ninho?</p>

        <div class="flex flex-col gap-2">
          <UButton
            @click="collectEggs()"
            icon="i-game-icons-egg-clutch"
            color="neutral"
            variant="outline"
            class="justify-start border-green-500/30 text-green-300 hover:bg-green-900/20"
          >
            Coletar ovos
          </UButton>

          <UButton
            @click="keepAndLoot()"
            icon="i-game-icons-open-treasure-chest"
            color="neutral"
            variant="outline"
            class="justify-start border-green-500/30 text-green-300 hover:bg-green-900/20"
          >
            Manter e saquear
          </UButton>

          <UButton
            @click="cancelRaid()"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            class="justify-start text-green-800 hover:text-green-300"
          >
            Cancelar
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useNestStore, type Nest } from "@/stores/nests";
import enemyDefs from "@/data/enemyDefinitions.json";

type EnemyDefKey = keyof typeof enemyDefs;

const props = defineProps<{ nest: Nest }>();
const emit = defineEmits<{ close: [] }>();

const nestStore = useNestStore();

const enemyLabel = computed(() => (enemyDefs[props.nest.enemyType as EnemyDefKey] as { label: string }).label);

function closeModal() {
  emit("close");
}

function handleUpdateOpen(open: boolean) {
  if (!open) closeModal();
}

function collectEggs() {
  nestStore.raid(props.nest.id, "eggs");
  closeModal();
}

function keepAndLoot() {
  nestStore.raid(props.nest.id, "loot");
  closeModal();
}

function cancelRaid() {
  nestStore.raid(props.nest.id, "cancel");
  closeModal();
}
</script>
