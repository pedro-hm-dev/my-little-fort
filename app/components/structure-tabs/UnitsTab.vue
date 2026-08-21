<template>
  <div class="font-mono">
    <!-- Units inside fort -->
    <div v-if="inFort.length > 0" class="px-4 pt-4 pb-2 space-y-2">
      <p class="text-xs text-green-800 uppercase tracking-widest mb-2 flex items-baseline justify-between">
        <span>Dentro</span>
        <span v-if="maxOccupancy !== undefined" class="text-green-700">{{ inFort.length }} / {{ maxOccupancy }}</span>
      </p>
      <div
        v-for="unit in inFort"
        :key="unit.id"
        class="flex items-center gap-3 p-2.5 border border-green-500/20 bg-green-900/10"
      >
        <UIcon
          :name="`i-game-icons-${unit.iconName}`"
          class="size-7 shrink-0"
          :style="{ color: unitColor(unit.type) }"
        />
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="flex justify-between items-baseline">
            <span class="text-xs text-green-300 uppercase tracking-widest">{{ unitLabel(unit.type) }}</span>
            <span class="text-xs text-green-700">{{ reproTimeLeft(unit) }}</span>
          </div>
          <template v-if="unit.reproductionProgress !== undefined">
            <div class="h-px w-full bg-green-950">
              <div
                class="h-full bg-green-500 transition-all duration-300"
                :style="{ width: Math.round(unit.reproductionProgress * 100) + '%' }"
              />
            </div>
            <div class="flex items-center gap-3 text-xs text-green-800">
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-heart" class="size-3 text-red-800" />
                {{ Math.round(unit.health) }}/{{ unit.maxHealth }}
              </span>
              <span>{{ Math.round(unit.reproductionProgress * 100) }}% reproduzido</span>
            </div>
          </template>
          <div v-else class="flex items-center gap-3 text-xs text-green-800">
            <span class="flex items-center gap-1">
              <UIcon name="i-lucide-heart" class="size-3 text-red-800" />
              {{ Math.round(unit.health) }}/{{ unit.maxHealth }}
            </span>
            <span class="uppercase tracking-widest text-green-700">Abrigado</span>
          </div>
        </div>
        <button
          class="p-1 text-green-900 hover:text-red-500 transition-colors shrink-0"
          :title="unit.reproductionProgress !== undefined ? 'Cancelar' : 'Sair'"
          @click="unitStore.exitShelter(unit.id)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
    </div>

    <div v-if="inFort.length > 0 && canReproduce.length > 0" class="mx-4 border-t border-green-900/40 my-1" />

    <div v-if="inFort.length === 0 && canReproduce.length === 0" class="px-4 py-4 text-xs text-green-800 uppercase tracking-widest">
      Ninguém dentro
    </div>

    <!-- Recruitable unit types -->
    <div v-if="canReproduce.length > 0" class="px-4 pb-4 pt-3 space-y-1.5">
      <p class="text-xs text-green-800 uppercase tracking-widest mb-3 flex items-baseline justify-between">
        <span>Recrutar</span>

        <span v-if="atPopulationCap" class="text-red-800">Sem moradia</span>

        <span v-else-if="isFull" class="text-red-800">Lotado</span>
      </p>

      <p class="text-xs text-green-800 flex items-baseline justify-between pb-1">
        <span class="uppercase tracking-widest">População</span>

        <span :class="atPopulationCap ? 'text-red-400' : 'text-green-500'">
          {{ unitStore.population }} / {{ structureStore.housingCapacity }}
        </span>
      </p>

      <div
        v-for="type in canReproduce"
        :key="type"
        class="flex items-center gap-3 p-2.5 border border-green-900/30 bg-green-900/5"
      >
        <UIcon
          :name="`i-game-icons-${unitIconName(type)}`"
          class="size-8 shrink-0"
          :style="{ color: unitColor(type) }"
        />
        <div class="flex-1 min-w-0 space-y-0.5">
          <p class="text-xs text-green-300 uppercase tracking-widest">{{ unitLabel(type) }}</p>
          <div class="flex gap-3 text-xs text-green-700">
            <span>{{ unitDefOf(type)?.foodPerDay ?? 0 }} comida/dia</span>
            <span>{{ unitDefOf(type)?.reproductionTimeHours ?? 0 }}h</span>
          </div>
        </div>
        <button
          class="shrink-0 px-2 py-1 text-xs font-mono border transition-colors uppercase tracking-widest"
          :class="
            cannotRecruit
              ? 'border-green-900/30 text-green-900 opacity-40 cursor-not-allowed'
              : 'border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20'
          "
          :disabled="cannotRecruit"
          @click="unitStore.startPendingReproduction(structure.id, type as UnitType)"
        >
          reproduzir
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUnitStore } from "@/stores/units";
import { useStructureStore } from "@/stores/structures";
import { UnitType, type Unit } from "@/types/Unit";
import { type Structure } from "@/types/Structure";
import unitDefs from "@/data/unitDefinitions.json";
import structureDefs from "@/data/structureDefinitions.json";

type UnitDefKey = keyof typeof unitDefs;

const props = defineProps<{ structure: Structure }>();

const unitStore = useUnitStore();
const structureStore = useStructureStore();

const structureDef = computed(() => structureDefs[props.structure.type as keyof typeof structureDefs]);
const canReproduce = computed(() => (structureDef.value as { canReproduce?: string[] }).canReproduce ?? []);
const maxOccupancy = computed(() => (structureDef.value as { maxOccupancy?: number }).maxOccupancy);

const inFort = computed(() => unitStore.unitsInsideFort(props.structure.id));
const isFull = computed(() => maxOccupancy.value !== undefined && inFort.value.length >= maxOccupancy.value);
const atPopulationCap = computed(() => unitStore.population >= structureStore.housingCapacity);
const cannotRecruit = computed(() => isFull.value || atPopulationCap.value);

function unitLabel(type: string): string {
  return (unitDefs[type as UnitDefKey] as { label: string })?.label ?? type;
}

function unitIconName(type: string): string {
  return (unitDefs[type as UnitDefKey] as { iconName: string })?.iconName ?? "roman-toga";
}

function unitDefOf(type: string) {
  return unitDefs[type as UnitDefKey] as { foodPerDay: number; reproductionTimeHours: number } | undefined;
}

const UNIT_COLORS: Record<string, string> = {
  worker: "#90EE90",
  soldier: "#ffffff",
  archer: "#7dd3fc",
  hunter: "#fde68a",
  miner: "#94a3b8",
};

function unitColor(type: string): string {
  return UNIT_COLORS[type] ?? "#4ade80";
}

function reproTimeLeft(unit: Unit): string {
  if (unit.reproductionProgress === undefined) return "";
  const remainHours = unit.reproductionTimeHours * (1 - unit.reproductionProgress);
  const h = Math.floor(remainHours);
  const min = Math.round((remainHours - h) * 60);
  return `${h}h ${min}min`;
}
</script>
