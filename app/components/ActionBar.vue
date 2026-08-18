<template>
  <div
    v-if="selectedUnits.length > 0"
    class="absolute bottom-4 left-4 z-50 flex gap-1.5 p-2 border border-green-500/25 bg-black/90"
  >
    <UTooltip v-for="action in ACTIONS" :key="action.id" :ui="{ content: 'h-auto items-start py-2' }">
      <template #content>
        <div class="font-mono text-xs space-y-1">
          <div class="text-green-300 uppercase tracking-widest">{{ action.label }}</div>
          <div v-if="cooldownOf(action.id).total > 0" class="text-green-700">
            Recarga: {{ Math.ceil(cooldownOf(action.id).remaining / 1000) }}s
          </div>
        </div>
      </template>

      <button
        type="button"
        class="relative w-11 h-11 flex items-center justify-center border transition-colors"
        :class="buttonClass(action.id)"
        :disabled="isDisabled(action.id)"
        @click="handleClick(action.id)"
      >
        <UIcon :name="action.icon" class="size-6" />

        <div
          v-if="cooldownOf(action.id).remaining > 0"
          class="absolute inset-0 pointer-events-none"
          :style="cooldownWedgeStyle(action.id)"
        />
        <UIcon
          v-if="cooldownOf(action.id).remaining > 0"
          name="i-lucide-clock"
          class="absolute -bottom-1 -right-1 size-3.5 text-yellow-400 bg-black rounded-full p-0.5"
        />
      </button>
    </UTooltip>
  </div>
</template>

<script setup lang="ts">
import { useSelectionStore } from "@/stores/selection";
import { useUnitStore } from "@/stores/units";
import type { Unit } from "@/types/Unit";
import actionDefs from "@/data/actionDefinitions.json";

type ActionCommandId = "move" | "attack" | "gather" | "shelter";

const ACTIONS: Array<{ id: ActionCommandId; label: string; icon: string }> = [
  { id: "move", label: "Mover", icon: "i-game-icons-walking-boot" },
  { id: "attack", label: "Atacar", icon: "i-game-icons-crossed-swords" },
  { id: "gather", label: "Coletar", icon: "i-game-icons-backpack" },
  { id: "shelter", label: "Abrigar", icon: "i-game-icons-door" },
];

const ACTION_DEFS = actionDefs as unknown as Record<string, { cooldownMs: number }>;

const selectionStore = useSelectionStore();
const unitStore = useUnitStore();

const selectedUnits = computed<Unit[]>(() =>
  Array.from(selectionStore.selectedUnitIds)
    .map((id) => unitStore.getUnit(id))
    .filter((u): u is Unit => !!u),
);

/** Selected unit used to represent the group's attack cooldown in the tooltip/clock. */
const primaryCombatUnit = computed(() => selectedUnits.value.find((u) => u.actionIds.length > 0) ?? null);

const canAttack = computed(() => primaryCombatUnit.value !== null);

function cooldownOf(actionId: ActionCommandId): { remaining: number; total: number } {
  if (actionId !== "attack") return { remaining: 0, total: 0 };

  const unit = primaryCombatUnit.value;
  if (!unit) return { remaining: 0, total: 0 };

  // Represent the group by whichever of the unit's weapon actions is closest to ready.
  let best: { remaining: number; total: number } | null = null;
  for (const actionId of unit.actionIds) {
    const def = ACTION_DEFS[actionId];
    if (!def) continue;
    const remaining = unit.actionCooldowns[actionId] ?? 0;
    if (!best || remaining < best.remaining) best = { remaining, total: def.cooldownMs };
  }

  return best ?? { remaining: 0, total: 0 };
}

function cooldownWedgeStyle(actionId: ActionCommandId) {
  const { remaining, total } = cooldownOf(actionId);
  const fraction = total > 0 ? Math.min(1, remaining / total) : 0;
  return { background: `conic-gradient(rgba(0, 0, 0, 0.7) ${fraction * 360}deg, transparent 0deg)` };
}

function isDisabled(actionId: ActionCommandId): boolean {
  return actionId === "attack" && !canAttack.value;
}

function buttonClass(actionId: ActionCommandId) {
  const armed = selectionStore.activeCommand === actionId;

  return {
    "border-yellow-400 bg-yellow-900/30 text-yellow-300": armed,
    "border-green-500/30 bg-green-900/10 text-green-400 hover:bg-green-900/30 hover:border-green-400/50":
      !armed && !isDisabled(actionId),
    "border-green-900/30 text-green-900 opacity-40 cursor-not-allowed": isDisabled(actionId),
  };
}

function handleClick(actionId: ActionCommandId) {
  const ids = Array.from(selectionStore.selectedUnitIds);
  if (ids.length === 0 || isDisabled(actionId)) return;

  selectionStore.setActiveCommand(selectionStore.activeCommand === actionId ? null : actionId);
}
</script>
