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

        <span v-else-if="fx.kind === 'gatherNumber'" class="fx-gather-content">
          <UIcon :name="`i-game-icons-${fx.iconName}`" class="fx-gather-icon" />
          <span class="fx-gather-text">+{{ fx.amount }}</span>
        </span>
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
    left: `${fx.x + (fx.offsetX ?? 0)}px`,
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
/* Raio maligno — feixe roxo que aparece inteiro, em vez de viajar como uma flecha */
.fx-magicRay {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(168, 85, 247, 0.15), #a855f7 45%, #d8b4fe 75%, #f5d0fe);
  box-shadow:
    0 0 8px #a855f7,
    0 0 18px rgba(126, 34, 206, 0.75);
  transform-origin: left center;
  animation: fx-magicRay-anim var(--duration) ease-out forwards;
}
.fx-magicRay.fx-crit {
  height: 9px;
  filter: brightness(1.3);
}
@keyframes fx-magicRay-anim {
  0% { width: 0; transform: rotate(var(--angle)); opacity: 0.2; }
  35% { width: var(--dist); transform: rotate(var(--angle)); opacity: 1; }
  100% { width: var(--dist); transform: rotate(var(--angle)); opacity: 0; }
}

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

/* Número de dano flutuante — pop com pequeno overshoot, depois sobe e desvanece (estilo Ragnarok) */
.fx-damageNumber {
  animation: fx-damage-anim var(--duration) cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
}
.fx-damage-text {
  display: inline-block;
  transform: translate(-50%, -100%);
  font-family: ui-monospace, monospace;
  font-weight: 800;
  font-size: 15px;
  color: #f8fafc;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 2px 4px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
}
.fx-damageNumber.fx-crit .fx-damage-text {
  color: #fbbf24;
  font-size: 21px;
  text-shadow:
    -1px -1px 0 #7f1d1d,
    1px -1px 0 #7f1d1d,
    -1px 1px 0 #7f1d1d,
    1px 1px 0 #7f1d1d,
    0 0 8px rgba(251, 191, 36, 0.9),
    0 2px 4px rgba(0, 0, 0, 0.8);
}
@keyframes fx-damage-anim {
  0% { opacity: 0; transform: translateY(6px) scale(0.4); }
  10% { opacity: 1; transform: translateY(-12px) scale(1.35); }
  22% { transform: translateY(-6px) scale(1); }
  78% { opacity: 1; transform: translateY(-34px) scale(1); }
  100% { opacity: 0; transform: translateY(-46px) scale(0.9); }
}

/* Popup de coleta — ícone + "+N" subindo e desvanecendo, mesmo espírito do número de dano */
.fx-gatherNumber {
  animation: fx-gather-anim var(--duration) cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
}
.fx-gather-content {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transform: translate(-50%, -100%);
  white-space: nowrap;
}
.fx-gather-icon {
  width: 14px;
  height: 14px;
  color: #4ade80;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
}
.fx-gather-text {
  font-family: ui-monospace, monospace;
  font-weight: 800;
  font-size: 14px;
  color: #4ade80;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 2px 3px rgba(0, 0, 0, 0.6);
}
@keyframes fx-gather-anim {
  0% { opacity: 0; transform: translateY(4px) scale(0.5); }
  12% { opacity: 1; transform: translateY(-8px) scale(1.2); }
  24% { transform: translateY(-4px) scale(1); }
  80% { opacity: 1; transform: translateY(-30px) scale(1); }
  100% { opacity: 0; transform: translateY(-40px) scale(0.9); }
}
</style>
