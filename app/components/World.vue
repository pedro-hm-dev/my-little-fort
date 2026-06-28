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

    <!-- Inventory button — top right -->
    <div class="absolute top-4 right-4 z-50">
      <button
        @click.stop="toggleResourcePanel"
        class="p-2 border border-green-500/30 bg-black/70 backdrop-blur-sm text-green-500 hover:text-green-200 hover:border-green-400/50 hover:bg-green-900/20 transition-all"
      >
        <UIcon name="i-game-icons-open-chest" class="size-5" />
      </button>
    </div>

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

    <!-- Structure panel (mounted once, shown on demand) -->
    <StructurePanel
      v-if="structurePanelOpen && selectedStructure"
      :structure="selectedStructure"
      @close="structurePanelOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { LazyResourcePanel } from "#components";
import { drawEntityIcon, preloadAllIcons } from "@/utils/iconRenderer";
import { useCameraStore } from "@/stores/camera";
import { useTimeStore, type TimeSpeed } from "@/stores/time";
import { useInventoryStore } from "@/stores/inventory";
import { useWorldStore } from "@/stores/world";
import { useStructureStore } from "@/stores/structures";
import { useResourceStore } from "@/stores/resources";
import { useUnitStore } from "@/stores/units";
import { useSelectionStore } from "@/stores/selection";
import { UnitType } from "@/types/Unit";
import { type Structure } from "@/types/Structure";
import unitDefs from "@/data/unitDefinitions.json";

type UnitDefKey = keyof typeof unitDefs;

const camera = useCameraStore();
const worldStore = useWorldStore();
const structureStore = useStructureStore();
const resourceStore = useResourceStore();
const unitStore = useUnitStore();
const selectionStore = useSelectionStore();
const inventoryStore = useInventoryStore();
const timeStore = useTimeStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

let animationFrameId: number | null = null;
let lastFrameTime = 0;

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
  inventoryStore.clear();
  selectionStore.deselectAll();
  timeStore.reset();

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
};

const gameLoop = (timestamp: number) => {
  const deltaMs = lastFrameTime > 0 ? Math.min(timestamp - lastFrameTime, 100) : 16;
  lastFrameTime = timestamp;

  const gameDeltaMs = timeStore.gameDelta(deltaMs);

  timeStore.tick(deltaMs);
  camera.updateMovement();
  unitStore.updateUnitPositions(gameDeltaMs);
  unitStore.updateFortUnits(gameDeltaMs);

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
  }

  // Halos for selected units
  for (const unit of unitStore.mapUnits) {
    if (selectionStore.isSelected(unit.id)) {
      ctx.beginPath();
      ctx.arc(unit.position.x, unit.position.y, unit.iconSize / 2 + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 3 / camera.zoom;
      ctx.stroke();
    }
  }

  // Only render map units (not those inside forts)
  for (const unit of unitStore.mapUnits) {
    void drawEntityIcon(ctx, unit, unit.position, { size: unit.iconSize });
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

const drawTerrain = () => {
  if (!ctx) return;
  for (const lake of worldStore.allLakes) {
    const outline = lake.outline;
    if (!outline || outline.length < 3) continue;

    const gradient = ctx.createRadialGradient(lake.center.x, lake.center.y, 0, lake.center.x, lake.center.y, lake.radius);
    gradient.addColorStop(0, "rgba(30, 100, 180, 0.5)");
    gradient.addColorStop(0.7, "rgba(50, 140, 220, 0.4)");
    gradient.addColorStop(1, "rgba(70, 180, 255, 0.3)");

    ctx.fillStyle = gradient;
    ctx.strokeStyle = "rgba(100, 180, 255, 0.6)";
    ctx.lineWidth = 3 / camera.zoom;
    ctx.beginPath();

    const first = outline[0];
    if (!first) continue;
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
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && unitStore.pendingReproduction) {
    unitStore.clearPendingReproduction();
    timeStore.setSpeed(speedBeforePause);
    if (selectedStructure.value) structurePanelOpen.value = true;
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

  const rect = selectionStore.getSelectionRect();
  const pending = unitStore.pendingReproduction;

  if (rect && rect.width > 5 && rect.height > 5) {
    if (!pending) {
      // Normal box selection — only map units
      const selectedIds: string[] = [];
      for (const unit of unitStore.mapUnits) {
        const ux = unit.position.x;
        const uy = unit.position.y;
        if (ux >= rect.x && ux <= rect.x + rect.width && uy >= rect.y && uy <= rect.y + rect.height) {
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

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();
  if (!selectionStore.hasSelectedUnits()) return;

  const world = screenToWorld(e.offsetX, e.offsetY);
  let clickedResource = null;

  for (const resource of resourceStore.allResources) {
    const dx = world.x - resource.position.x;
    const dy = world.y - resource.position.y;
    if (dx * dx + dy * dy < (resource.iconSize / 2) ** 2) {
      clickedResource = resource;
      break;
    }
  }

  if (clickedResource) {
    unitStore.gatherResource(Array.from(selectionStore.selectedUnitIds), clickedResource.id);
  } else {
    unitStore.moveUnitsTo(Array.from(selectionStore.selectedUnitIds), world.x, world.y);
  }

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
