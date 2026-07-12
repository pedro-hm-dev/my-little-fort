<template>
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <div class="combat-effects-world" :style="{ transform }">
      <div
        v-for="fx in effectsStore.effects"
        :key="fx.id"
        class="fx"
        :class="[`fx-${fx.kind}`, { 'fx-crit': fx.crit }]"
        :style="fxStyle(fx)"
        @animationend="effectsStore.remove(fx.id)"
      >
        <span v-if="fx.kind === 'damageNumber'" class="fx-damage-text">{{ fx.crit ? `-${fx.amount}!` : `-${fx.amount}` }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEffectsStore } from "@/stores/effects";
import type { EffectSpec } from "@/types/Combat";

defineProps<{ transform: string }>();

const effectsStore = useEffectsStore();

function fxStyle(fx: EffectSpec) {
  const dx = (fx.targetX ?? fx.x) - fx.x;
  const dy = (fx.targetY ?? fx.y) - fx.y;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const dist = Math.hypot(dx, dy);

  return {
    left: `${fx.x}px`,
    top: `${fx.y}px`,
    "--angle": `${angle}deg`,
    "--dist": `${dist}px`,
    "--duration": `${fx.durationMs}ms`,
  };
}
</script>

<style scoped>
.combat-effects-world {
  position: relative;
  width: 0;
  height: 0;
}

.fx {
  position: absolute;
  pointer-events: none;
  will-change: transform, opacity;
}

/* Estocada — jab curto na direção do alvo */
.fx-thrust {
  width: 42px;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(248, 250, 252, 0), #f8fafc 55%, #ffffff);
  transform-origin: left center;
  animation: fx-thrust-anim var(--duration) ease-out forwards;
}
@keyframes fx-thrust-anim {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(-8px) scaleX(0.4); }
  30% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(28px) scaleX(1); }
}

/* Corte — arco girando sobre o alvo */
.fx-slash {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 4px solid transparent;
  border-top-color: #f8fafc;
  border-right-color: #f8fafc;
  transform-origin: center;
  animation: fx-slash-anim var(--duration) ease-out forwards;
}
@keyframes fx-slash-anim {
  0% { opacity: 0; transform: translate(-50%, -50%) rotate(calc(var(--angle) - 50deg)) scale(0.6); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(calc(var(--angle) + 70deg)) scale(1.1); }
}

/* Flecha — projétil viajando até o alvo */
.fx-arrow {
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, rgba(226, 232, 240, 0), #e2e8f0 60%, #f8fafc);
  transform-origin: left center;
  animation: fx-arrow-anim var(--duration) linear forwards;
}
@keyframes fx-arrow-anim {
  0% { transform: rotate(var(--angle)) translateX(0); opacity: 1; }
  100% { transform: rotate(var(--angle)) translateX(var(--dist)); opacity: 1; }
}

/* Flecha bomba — explosão estacionária no ponto de impacto */
.fx-bombArrow {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, #fb923c 25%, #ef4444 55%, rgba(239, 68, 68, 0) 75%);
  animation: fx-explosion-anim var(--duration) ease-out forwards;
}
@keyframes fx-explosion-anim {
  0% { transform: translate(-50%, -50%) scale(0.15); opacity: 1; }
  55% { opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1.35); opacity: 0; }
}

/* Mordida — impacto rápido no alvo */
.fx-bite {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, #f87171 40%, rgba(239, 68, 68, 0) 70%);
  animation: fx-bite-anim var(--duration) ease-out forwards;
}
@keyframes fx-bite-anim {
  0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0.9; }
  100% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
}

.fx-thrust.fx-crit,
.fx-slash.fx-crit,
.fx-arrow.fx-crit {
  filter: drop-shadow(0 0 5px #ef4444);
}

/* Número de dano flutuante */
.fx-damageNumber {
  animation: fx-damage-anim var(--duration) ease-out forwards;
}
.fx-damage-text {
  display: inline-block;
  transform: translate(-50%, -100%);
  font-family: ui-monospace, monospace;
  font-weight: 700;
  font-size: 13px;
  color: #f8fafc;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
}
.fx-damageNumber.fx-crit .fx-damage-text {
  color: #ef4444;
  font-size: 17px;
  text-shadow: 0 0 6px rgba(239, 68, 68, 0.85), 0 1px 2px rgba(0, 0, 0, 0.9);
}
@keyframes fx-damage-anim {
  0% { opacity: 0; transform: translateY(0) scale(0.8); }
  15% { opacity: 1; transform: translateY(-6px) scale(1.1); }
  100% { opacity: 0; transform: translateY(-38px) scale(1); }
}
</style>
