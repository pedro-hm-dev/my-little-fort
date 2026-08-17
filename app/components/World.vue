<template>
  <div class="w-full h-full relative overflow-hidden" style="background: #1b1b1b">
    <canvas
      ref="canvasRef"
      class="w-full h-full block"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @contextmenu="handleContextMenu"
    />

    <CombatEffects :transform="cameraTransform" />

    <ActionBar />

    <div class="absolute top-4 left-4 bg-black/75 backdrop-blur-sm p-3 border border-green-500/25 text-xs font-mono text-green-500 space-y-1">
      <div class="text-green-800">ZOOM <span class="text-green-400">{{ camera.zoom.toFixed(2) }}x</span></div>
      <div class="text-green-800">PAN  <span class="text-green-400">{{ camera.panX.toFixed(0) }}, {{ camera.panY.toFixed(0) }}</span></div>
      <div class="text-green-800">SEED <span class="text-green-400">{{ worldStore.worldSeed }}</span></div>

      <button
        @click="centerOnFort"
        class="mt-2 px-2 py-1 border border-green-500/30 bg-green-900/20 hover:bg-green-900/40 hover:border-green-500/50 text-green-400 hover:text-green-200 text-xs w-full transition-colors"
      >
        &gt; FORT
      </button>

      <button
        @click="regenerateWorld"
        class="px-2 py-1 border border-green-500/30 bg-green-900/20 hover:bg-green-900/40 hover:border-green-500/50 text-green-400 hover:text-green-200 text-xs w-full transition-colors"
      >
        &gt; NEW WORLD
      </button>
    </div>

    <!-- Clock — top center -->
    <div class="absolute top-4 left-1/2 -translate-x-1/2 z-50">
      <GameClock />
    </div>

    <!-- Food stock — top right, left of the inventory button -->
    <div class="absolute top-4 right-16 z-50">
      <div
        :class="foodStore.hasFoodShortage ? 'border-red-500/60' : 'border-green-500/30'"
        :title="foodTooltip"
        class="flex items-center gap-2 px-2.5 py-2 border bg-black/70 backdrop-blur-sm font-mono text-xs"
      >
        <UIcon
          :class="foodStore.hasFoodShortage ? 'text-red-400' : 'text-green-500'"
          name="i-game-icons-meal"
          class="size-4 shrink-0"
        />

        <span
          :class="foodStore.hasFoodShortage ? 'text-red-300' : 'text-green-300'"
          class="font-bold tabular-nums"
        >
          {{ foodStore.foodStock }}
        </span>

        <span :class="foodStore.hasFoodShortage ? 'text-red-800' : 'text-green-800'">
          /{{ foodStore.dailyFoodNeed }}
        </span>
      </div>
    </div>

    <!-- Inventory button — top right -->
    <div class="absolute top-4 right-4 z-50">
      <button
        @click.stop="toggleResourcePanel"
        class="p-2 border border-green-500/30 bg-black/70 backdrop-blur-sm text-green-500 hover:text-green-200 hover:border-green-400/50 hover:bg-green-900/20 transition-all"
      >
        <UIcon name="i-game-icons-open-chest" class="size-5" />
      </button>
    </div>

    <!-- Food shortage warning -->
    <Transition name="hud">
      <div
        v-if="foodStore.hasFoodShortage"
        class="absolute top-32 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 border border-red-500/60 bg-black/90 font-mono text-xs backdrop-blur-sm pointer-events-none"
      >
        <UIcon name="i-game-icons-meal" class="size-4 text-red-400 shrink-0" />

        <span class="text-red-300 uppercase tracking-widest">{{ foodShortageMessage }}</span>
      </div>
    </Transition>

    <!-- Pending reproduction HUD -->
    <Transition name="hud">
      <div
        v-if="unitStore.pendingReproduction"
        class="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
      >
        <div class="flex items-center gap-3 px-5 py-3 border border-yellow-500/60 bg-black/90 font-mono text-sm backdrop-blur-sm">
          <UIcon name="i-lucide-crosshair" class="size-4 text-yellow-400 shrink-0" />
          <span class="text-yellow-300 uppercase tracking-widest">
            Selecione um {{ pendingUnitLabel }} no mapa
          </span>
        </div>
        <span class="text-xs font-mono text-yellow-700 tracking-widest uppercase">ESC para cancelar</span>
      </div>
    </Transition>

    <!-- Armed action-bar command hint -->
    <Transition name="hud">
      <div
        v-if="activeCommandHint"
        class="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 border border-yellow-500/60 bg-black/90 font-mono text-xs backdrop-blur-sm pointer-events-none"
      >
        <UIcon name="i-lucide-crosshair" class="size-4 text-yellow-400 shrink-0" />
        <span class="text-yellow-300 uppercase tracking-widest">{{ activeCommandHint }}</span>
      </div>
    </Transition>

    <!-- Structure panel (mounted once, shown on demand) -->
    <StructurePanel
      v-if="structurePanelOpen && selectedStructure"
      :structure="selectedStructure"
      @close="structurePanelOpen = false"
    />

    <!-- Game over overlay -->
    <Transition name="hud">
      <div
        v-if="gameStore.gameOver"
        class="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      >
        <div class="flex flex-col items-center gap-4 px-10 py-8 border border-red-500/40 bg-black/90 font-mono">
          <UIcon name="i-game-icons-tombstone" class="size-12 text-red-500" />
          <span class="text-2xl font-bold text-red-400 uppercase tracking-widest">O Forte Caiu</span>
          <span class="text-xs text-red-800 uppercase tracking-widest">
            Sobreviveu até o dia {{ timeStore.day }}
          </span>
          <button
            @click="regenerateWorld"
            class="mt-2 px-4 py-2 border border-red-500/40 bg-red-900/20 hover:bg-red-900/40 hover:border-red-500/60 text-red-300 hover:text-red-100 text-xs uppercase tracking-widest transition-colors"
          >
            &gt; Recomeçar
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { LazyResourcePanel } from "#components";
import { drawEntityIcon, drawIconSync, preloadAllIcons, STATUS_ICONS } from "@/utils/iconRenderer";
import { useCameraStore } from "@/stores/camera";
import { useTimeStore, type TimeSpeed } from "@/stores/time";
import { useInventoryStore } from "@/stores/inventory";
import { useWorldStore } from "@/stores/world";
import { useStructureStore } from "@/stores/structures";
import { useResourceStore } from "@/stores/resources";
import { useUnitStore } from "@/stores/units";
import { useEnemyStore } from "@/stores/enemies";
import { useCombatStore } from "@/stores/combat";
import { useGameStore } from "@/stores/game";
import { useFoodStore } from "@/stores/food";
import { useSelectionStore } from "@/stores/selection";
import { UnitType, type Unit } from "@/types/Unit";
import { type Structure } from "@/types/Structure";
import { circleIntersectsRect } from "@/utils/geometry";
import unitDefs from "@/data/unitDefinitions.json";

type UnitDefKey = keyof typeof unitDefs;

const camera = useCameraStore();
const worldStore = useWorldStore();
const structureStore = useStructureStore();
const resourceStore = useResourceStore();
const unitStore = useUnitStore();
const enemyStore = useEnemyStore();
const combatStore = useCombatStore();
const gameStore = useGameStore();
const foodStore = useFoodStore();
const selectionStore = useSelectionStore();
const inventoryStore = useInventoryStore();
const timeStore = useTimeStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

let animationFrameId: number | null = null;
let lastFrameTime = 0;

const canvasSize = reactive({ width: 0, height: 0 });

/** Same translate/scale/translate the canvas render loop applies, so the DOM effects layer tracks the camera. */
const cameraTransform = computed(
  () =>
    `translate(${canvasSize.width / 2}px, ${canvasSize.height / 2}px) scale(${camera.zoom}) translate(${camera.panX}px, ${camera.panY}px)`,
);

const overlay = useOverlay();
const resourcePanelOverlay = overlay.create(LazyResourcePanel);

const structurePanelOpen = ref(false);
const selectedStructure = ref<Structure | null>(null);

let speedBeforePause: TimeSpeed = 1;

const pendingUnitLabel = computed(() => {
  const type = unitStore.pendingReproduction?.targetType;
  if (!type) return "";
  return (unitDefs[type as UnitDefKey] as { label: string })?.label ?? type;
});

const activeCommandHint = computed(() => {
  if (selectionStore.activeCommand === "move") return "Clique no mapa para mover";
  if (selectionStore.activeCommand === "attack") return "Clique em um inimigo ou arraste uma área para atacar em fila";
  if (selectionStore.activeCommand === "shelter") return "Clique em uma estrutura com capacidade para abrigar";
  if (selectionStore.activeCommand === "gather") return "Clique em um recurso ou arraste uma área para coletar em fila";
  return "";
});

const foodTooltip = computed(
  () =>
    `Comida: ${foodStore.foodStock} | consumo diário: ${foodStore.dailyFoodNeed} | famintos: ${foodStore.starvingUnitCount}`,
);

const foodShortageMessage = computed(() => {
  const missing = foodStore.dailyFoodNeed - foodStore.foodStock;

  return `Faltam ${missing} de comida para amanhã — unidades vão passar fome`;
});

watch(
  () => unitStore.pendingReproduction,
  (val) => {
    if (val) {
      speedBeforePause = timeStore.speed;
      timeStore.setSpeed(0);
      structurePanelOpen.value = false;
    }
  }
);

function toggleResourcePanel() {
  resourcePanelOverlay.open();
}

function openStructurePanel(structure: Structure) {
  selectedStructure.value = structure;
  structurePanelOpen.value = true;
}

function centerOnFort() {
  const fortPos = structureStore.fortPosition;
  if (fortPos) camera.centerOn(fortPos.x, fortPos.y);
}

function regenerateWorld() {
  const newSeed = Date.now();
  worldStore.regenerate(newSeed);
  structureStore.initialize();

  const fortPos = structureStore.fortPosition;
  if (fortPos) {
    resourceStore.initialize(fortPos);
    camera.centerOn(fortPos.x, fortPos.y);
  }

  unitStore.initialize();
  enemyStore.initialize();
  inventoryStore.clear();
  selectionStore.deselectAll();
  timeStore.reset();
  gameStore.reset();

  structurePanelOpen.value = false;
  selectedStructure.value = null;
}

interface PingEffect {
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

const pingEffect = ref<PingEffect | null>(null);

onMounted(async () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  ctx = canvas.getContext("2d");
  if (!ctx) return;

  await preloadAllIcons();

  worldStore.initialize();
  structureStore.initialize();

  const fortPos = structureStore.fortPosition;
  if (fortPos) {
    resourceStore.initialize(fortPos);
  }

  unitStore.initialize();
  enemyStore.initialize();
  gameStore.reset();
  gameStore.startDayWatcher();
  resizeCanvas();

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  // Center on fort directly (avoid computed ref timing issues)
  const fort = structureStore.getStructure("fort-1");
  if (fort) camera.centerOn(fort.position.x, fort.position.y);

  animationFrameId = requestAnimationFrame(gameLoop);
});

const resizeCanvas = () => {
  if (!canvasRef.value) return;
  canvasRef.value.width = window.innerWidth;
  canvasRef.value.height = window.innerHeight;
  canvasSize.width = canvasRef.value.width;
  canvasSize.height = canvasRef.value.height;
};

const gameLoop = (timestamp: number) => {
  const deltaMs = lastFrameTime > 0 ? Math.min(timestamp - lastFrameTime, 100) : 16;
  lastFrameTime = timestamp;

  const gameDeltaMs = timeStore.gameDelta(deltaMs);

  timeStore.tick(deltaMs);
  camera.updateMovement();
  unitStore.updateUnitPositions(gameDeltaMs);
  unitStore.updateFortUnits(gameDeltaMs);
  enemyStore.updateEnemyAI(gameDeltaMs);
  combatStore.updateCombat(gameDeltaMs);
  resourceStore.decayCarcasses(gameDeltaMs);
  gameStore.updateGame(gameDeltaMs);

  render();
  animationFrameId = requestAnimationFrame(gameLoop);
};

const render = () => {
  if (!ctx || !canvasRef.value) return;

  const w = canvasRef.value.width;
  const h = canvasRef.value.height;

  camera.clampCamera(w, h);
  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(camera.panX, camera.panY);

  drawGrid();
  drawMapBounds();
  drawTerrain();

  for (const resource of resourceStore.allResources) {
    void drawEntityIcon(ctx, resource, resource.position, { size: resource.iconSize });
  }

  for (const structure of structureStore.allStructures) {
    void drawEntityIcon(ctx, structure, structure.position, { size: structure.iconSize });
    drawHealthBar(structure.position, structure.iconSize, structure.health, structure.maxHealth);
  }

  for (const enemy of enemyStore.allEnemies) {
    void drawEntityIcon(ctx, enemy, enemy.position, { size: enemy.iconSize });
    drawHealthBar(enemy.position, enemy.iconSize, enemy.health, enemy.maxHealth);
  }

  // Halos for selected units
  const queuedEnemyIds = new Set<string>();
  const queuedResourceIds = new Set<string>();
  const queuedStructureIds = new Set<string>();

  for (const unit of unitStore.allUnits) {
    if (!selectionStore.isSelected(unit.id)) continue;

    // Sheltered units don't render on the map (no icon to halo), but their fort still deserves one.
    if (unit.insideFortId) {
      queuedStructureIds.add(unit.insideFortId);
      continue;
    }

    if (unit.combatTargetId && !unit.combatTargetIsStructure) queuedEnemyIds.add(unit.combatTargetId);
    unit.combatQueue?.forEach((id) => queuedEnemyIds.add(id));
    if (unit.targetResource) queuedResourceIds.add(unit.targetResource);
    unit.gatherQueue?.forEach((id) => queuedResourceIds.add(id));
    if (unit.shelterTargetId) queuedStructureIds.add(unit.shelterTargetId);

    drawHalo(unit.position, unit.iconSize, "#FFD700");
  }

  // Enemies/resources/structures queued by a selected unit's attack, gather or shelter order.
  for (const enemy of enemyStore.allEnemies) {
    if (queuedEnemyIds.has(enemy.id)) drawHalo(enemy.position, enemy.iconSize, "#ef4444");
  }

  for (const resource of resourceStore.allResources) {
    if (queuedResourceIds.has(resource.id)) drawHalo(resource.position, resource.iconSize, "#eab308");
  }

  for (const structure of structureStore.allStructures) {
    if (queuedStructureIds.has(structure.id)) drawHalo(structure.position, structure.iconSize, "#38bdf8");
  }

  // Only render map units (not those inside forts)
  for (const unit of unitStore.mapUnits) {
    void drawEntityIcon(ctx, unit, unit.position, { size: unit.iconSize });
    drawHealthBar(unit.position, unit.iconSize, unit.health, unit.maxHealth);
    if (unit.starving) drawStarvingMarker(unit);
  }

  // Selection rectangle
  if (selectionStore.isSelecting && selectionStore.selectionStart && selectionStore.selectionEnd) {
    const rect = selectionStore.getSelectionRect();
    if (rect) {
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 2 / camera.zoom;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = "rgba(255, 215, 0, 0.1)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }

  // Ping effect
  if (pingEffect.value) {
    const elapsed = Date.now() - pingEffect.value.startTime;
    const progress = elapsed / pingEffect.value.duration;
    if (progress >= 1) {
      pingEffect.value = null;
    } else {
      const radius = 20 + progress * 30;
      const alpha = 1 - progress;
      ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
      ctx.lineWidth = 3 / camera.zoom;
      ctx.beginPath();
      ctx.arc(pingEffect.value.x, pingEffect.value.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
};

const drawHalo = (position: { x: number; y: number }, iconSize: number, color: string) => {
  if (!ctx) return;

  ctx.beginPath();
  ctx.arc(position.x, position.y, iconSize / 2 + 5, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 / camera.zoom;
  ctx.stroke();
};

const drawHealthBar = (position: { x: number; y: number }, iconSize: number, health: number, maxHealth: number) => {
  if (!ctx || health >= maxHealth) return;

  const width = iconSize * 0.8;
  const height = 5 / camera.zoom;
  const x = position.x - width / 2;
  const y = position.y - iconSize / 2 - height - 6 / camera.zoom;
  const ratio = Math.max(0, health / maxHealth);

  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  ctx.fillStyle = "#7f1d1d";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = ratio > 0.3 ? "#4ade80" : "#ef4444";
  ctx.fillRect(x, y, width * ratio, height);
};

/** Hunger badge on a starving unit, pinned to the icon's top-right corner at a fixed on-screen size. */
const drawStarvingMarker = (unit: Unit) => {
  if (!ctx) return;

  const size = 20 / camera.zoom;
  const corner = unit.iconSize / 2;

  drawIconSync(ctx, STATUS_ICONS.starving, { x: unit.position.x + corner, y: unit.position.y - corner }, size);
};

const drawGrid = () => {
  if (!ctx) return;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 0.5 / camera.zoom;
  const gridSize = 100;
  const w = canvasRef.value?.width ?? 0;
  const h = canvasRef.value?.height ?? 0;
  const halfW = w / (2 * camera.zoom);
  const halfH = h / (2 * camera.zoom);
  const camX = -camera.panX;
  const camY = -camera.panY;
  const startX = Math.floor((camX - halfW) / gridSize) * gridSize;
  const startY = Math.floor((camY - halfH) / gridSize) * gridSize;
  const endX = camX + halfW;
  const endY = camY + halfH;

  for (let x = startX; x <= endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, camY - halfH - gridSize);
    ctx.lineTo(x, camY + halfH + gridSize);
    ctx.stroke();
  }
  for (let y = startY; y <= endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(camX - halfW - gridSize, y);
    ctx.lineTo(camX + halfW + gridSize, y);
    ctx.stroke();
  }
};

const drawMapBounds = () => {
  if (!ctx) return;
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 3 / camera.zoom;
  ctx.strokeRect(0, 0, camera.mapWidth, camera.mapHeight);
};

const drawWaterPolygon = (outline: { x: number; y: number }[], fillStyle: string | CanvasGradient) => {
  if (!ctx || outline.length < 3) return;

  const first = outline[0];
  if (!first) return;

  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = "rgba(100, 180, 255, 0.6)";
  ctx.lineWidth = 3 / camera.zoom;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < outline.length; i++) {
    const p = outline[i];
    if (!p) continue;
    ctx.lineTo(p.x, p.y);
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(150, 200, 255, 0.2)";
  ctx.lineWidth = 8 / camera.zoom;
  ctx.stroke();
};

const drawTerrain = () => {
  if (!ctx) return;

  if (worldStore.biomeTexture) {
    ctx.drawImage(worldStore.biomeTexture, 0, 0, camera.mapWidth, camera.mapHeight);
  }

  for (const lake of worldStore.allLakes) {
    const gradient = ctx.createRadialGradient(lake.center.x, lake.center.y, 0, lake.center.x, lake.center.y, lake.radius);
    gradient.addColorStop(0, "rgba(30, 100, 180, 0.5)");
    gradient.addColorStop(0.7, "rgba(50, 140, 220, 0.4)");
    gradient.addColorStop(1, "rgba(70, 180, 255, 0.3)");

    drawWaterPolygon(lake.outline, gradient);
  }

  for (const river of worldStore.rivers) {
    drawWaterPolygon(river.outline, "rgba(50, 130, 200, 0.4)");
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && unitStore.pendingReproduction) {
    unitStore.clearPendingReproduction();
    timeStore.setSpeed(speedBeforePause);
    if (selectedStructure.value) structurePanelOpen.value = true;
    return;
  }
  if (e.key === "Escape" && selectionStore.activeCommand) {
    selectionStore.setActiveCommand(null);
    return;
  }
  camera.handleKeyDown(e.key);
};

const handleKeyUp = (e: KeyboardEvent) => camera.handleKeyUp(e.key);

const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  camera.adjustZoom(e.deltaY > 0 ? -1 : 1);
};

function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  if (!canvasRef.value) return { x: 0, y: 0 };
  const w = canvasRef.value.width;
  const h = canvasRef.value.height;
  return {
    x: (screenX - w / 2) / camera.zoom - camera.panX,
    y: (screenY - h / 2) / camera.zoom - camera.panY,
  };
}

const handleMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return;
  const world = screenToWorld(e.offsetX, e.offsetY);
  selectionStore.startSelection(world.x, world.y);
};

const handleMouseMove = (e: MouseEvent) => {
  if (selectionStore.isSelecting) {
    const world = screenToWorld(e.offsetX, e.offsetY);
    selectionStore.updateSelection(world.x, world.y);
  }

  if (selectionStore.activeCommand) {
    if (canvasRef.value) canvasRef.value.style.cursor = "crosshair";
    return;
  }

  // Cursor pointer over interactive entities
  const world = screenToWorld(e.offsetX, e.offsetY);
  let hovering = false;

  for (const unit of unitStore.mapUnits) {
    const dx = world.x - unit.position.x;
    const dy = world.y - unit.position.y;
    if (dx * dx + dy * dy < (unit.iconSize / 2) ** 2) {
      hovering = true;
      break;
    }
  }

  if (!hovering) {
    for (const structure of structureStore.allStructures) {
      const dx = world.x - structure.position.x;
      const dy = world.y - structure.position.y;
      if (dx * dx + dy * dy < (structure.iconSize / 2) ** 2) {
        hovering = true;
        break;
      }
    }
  }

  if (canvasRef.value) {
    canvasRef.value.style.cursor = hovering ? "pointer" : "default";
  }
};

const handleMouseUp = (e: MouseEvent) => {
  if (e.button !== 0) return;
  if (!selectionStore.isSelecting) return;

  const command = selectionStore.activeCommand;
  if (command) {
    const world = screenToWorld(e.offsetX, e.offsetY);
    const ids = Array.from(selectionStore.selectedUnitIds);
    const dragRect = selectionStore.getSelectionRect();
    const isAreaDrag = !!dragRect && dragRect.width > 5 && dragRect.height > 5;

    if (command === "move") {
      unitStore.moveUnitsTo(ids, world.x, world.y);
      pingEffect.value = { x: world.x, y: world.y, startTime: Date.now(), duration: 800 };
    } else if (command === "attack") {
      if (isAreaDrag && dragRect) {
        const enemyIds = enemyStore.allEnemies
          .filter((enemy) =>
            circleIntersectsRect(
              enemy.position.x,
              enemy.position.y,
              enemy.iconSize / 2,
              dragRect.x,
              dragRect.y,
              dragRect.width,
              dragRect.height,
            ),
          )
          .map((enemy) => enemy.id);

        if (enemyIds.length > 0) unitStore.attackArea(ids, enemyIds);
      } else {
        let clickedEnemy = null;
        for (const enemy of enemyStore.allEnemies) {
          const dx = world.x - enemy.position.x;
          const dy = world.y - enemy.position.y;
          if (dx * dx + dy * dy < (enemy.iconSize / 2) ** 2) {
            clickedEnemy = enemy;
            break;
          }
        }
        if (clickedEnemy) unitStore.attackTarget(ids, clickedEnemy.id);
      }
    } else if (command === "gather") {
      if (isAreaDrag && dragRect) {
        const resourceIds = resourceStore.allResources
          .filter((resource) =>
            circleIntersectsRect(
              resource.position.x,
              resource.position.y,
              resource.iconSize / 2,
              dragRect.x,
              dragRect.y,
              dragRect.width,
              dragRect.height,
            ),
          )
          .map((resource) => resource.id);

        if (resourceIds.length > 0) unitStore.gatherResources(ids, resourceIds);
      } else {
        let clickedResource = null;
        for (const resource of resourceStore.allResources) {
          const dx = world.x - resource.position.x;
          const dy = world.y - resource.position.y;
          if (dx * dx + dy * dy < (resource.iconSize / 2) ** 2) {
            clickedResource = resource;
            break;
          }
        }
        if (clickedResource) unitStore.gatherResource(ids, clickedResource.id);
      }
    } else if (command === "shelter") {
      let clickedStructure = null;
      for (const structure of structureStore.allStructures) {
        const dx = world.x - structure.position.x;
        const dy = world.y - structure.position.y;
        if (dx * dx + dy * dy < (structure.iconSize / 2) ** 2) {
          clickedStructure = structure;
          break;
        }
      }
      if (clickedStructure) {
        unitStore.shelterUnitsAt(ids, clickedStructure.id);
        pingEffect.value = { x: clickedStructure.position.x, y: clickedStructure.position.y, startTime: Date.now(), duration: 800 };
      }
    }

    selectionStore.setActiveCommand(null);
    selectionStore.endSelection();
    return;
  }

  const rect = selectionStore.getSelectionRect();
  const pending = unitStore.pendingReproduction;

  if (rect && rect.width > 5 && rect.height > 5) {
    if (!pending) {
      // Normal box selection — only map units
      const selectedIds: string[] = [];
      for (const unit of unitStore.mapUnits) {
        if (circleIntersectsRect(unit.position.x, unit.position.y, unit.iconSize / 2, rect.x, rect.y, rect.width, rect.height)) {
          selectedIds.push(unit.id);
        }
      }
      selectionStore.selectUnits(selectedIds);
    }
  } else {
    const world = screenToWorld(e.offsetX, e.offsetY);

    if (pending) {
      // Pending reproduction mode — only look for a matching unit
      for (const unit of unitStore.mapUnits) {
        if (unit.type !== pending.targetType) continue;
        const dx = world.x - unit.position.x;
        const dy = world.y - unit.position.y;
        if (dx * dx + dy * dy < (unit.iconSize / 2) ** 2) {
          unitStore.startReproduction(unit.id, pending.targetType, pending.fortId);
          timeStore.setSpeed(speedBeforePause);
          if (selectedStructure.value) structurePanelOpen.value = true;
          selectionStore.endSelection();
          return;
        }
      }
    } else {
      // Normal single click — check units first, then structures
      let clickedSomething = false;

      for (const unit of unitStore.mapUnits) {
        const dx = world.x - unit.position.x;
        const dy = world.y - unit.position.y;
        if (dx * dx + dy * dy < (unit.iconSize / 2) ** 2) {
          selectionStore.selectUnits([unit.id]);
          clickedSomething = true;
          break;
        }
      }

      if (!clickedSomething) {
        for (const structure of structureStore.allStructures) {
          const dx = world.x - structure.position.x;
          const dy = world.y - structure.position.y;
          if (dx * dx + dy * dy < (structure.iconSize / 2) ** 2) {
            selectionStore.deselectAll();
            openStructurePanel(structure);
            clickedSomething = true;
            break;
          }
        }
      }

      if (!clickedSomething) {
        selectionStore.deselectAll();
        structurePanelOpen.value = false;
      }
    }
  }

  selectionStore.endSelection();
};

/** Right-click is a move shortcut — it only ever moves, never gathers or shelters. */
const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();
  if (!selectionStore.hasSelectedUnits()) return;

  const world = screenToWorld(e.offsetX, e.offsetY);
  unitStore.moveUnitsTo(Array.from(selectionStore.selectedUnitIds), world.x, world.y);

  pingEffect.value = {
    x: world.x,
    y: world.y,
    startTime: Date.now(),
    duration: 800,
  };
};

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
});
</script>

<style scoped>
.hud-enter-active,
.hud-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.hud-enter-from,
.hud-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
