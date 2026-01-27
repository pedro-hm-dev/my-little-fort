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

    <div class="absolute top-4 left-4 bg-slate-800/90 p-3 rounded text-xs font-mono text-slate-200 space-y-1">
      <div>Zoom: {{ camera.zoom.toFixed(2) }}x</div>

      <div>Pan: {{ camera.panX.toFixed(0) }}, {{ camera.panY.toFixed(0) }}</div>

      <div>Seed: {{ worldStore.worldSeed }}</div>

      <button
        @click="
          camera.centerOn(
            structureStore.getStructure('fort-1')?.position.x ?? 0,
            structureStore.getStructure('fort-1')?.position.y ?? 0,
          )
        "
        class="mt-2 px-2 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-white text-xs w-full"
      >
        Center on Fort
      </button>

      <button
        @click="regenerateWorld"
        class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs w-full"
      >
        New World
      </button>
    </div>

    <div class="absolute top-4 right-4 z-50">
      <UButton
        icon="i-heroicons-cube"
        size="lg"
        color="primary"
        @click.stop="toggleResourcePanel"
        class="shadow-lg"
      />
    </div>

    <ResourcePanel :model-value="resourcePanelOpen" @update:model-value="resourcePanelOpen = $event" />
  </div>
</template>

<script setup lang="ts">
import { drawEntityIcon, preloadAllIcons } from "@/utils/iconRenderer";
import { useCameraStore } from "@/stores/camera";
import { useInventoryStore } from "@/stores/inventory";
import { useWorldStore } from "@/stores/world";
import { useStructureStore } from "@/stores/structures";
import { useResourceStore } from "@/stores/resources";
import { useUnitStore } from "@/stores/units";
import { useSelectionStore } from "@/stores/selection";

const camera = useCameraStore();
const worldStore = useWorldStore();
const structureStore = useStructureStore();
const resourceStore = useResourceStore();
const unitStore = useUnitStore();
const selectionStore = useSelectionStore();
const inventoryStore = useInventoryStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;

let animationFrameId: number | null = null;

const resourcePanelOpen = ref(false);

function toggleResourcePanel() {
  resourcePanelOpen.value = !resourcePanelOpen.value;
}

function regenerateWorld() {
  // Generate new seed
  const newSeed = Date.now();

  // Reinitialize world with new seed
  worldStore.regenerate(newSeed);
  structureStore.initialize();

  const fortPos = structureStore.fortPosition;
  if (fortPos) {
    resourceStore.initialize(fortPos);
    // Center camera on new fort position
    camera.centerOn(fortPos.x, fortPos.y);
  }

  unitStore.initialize();
  inventoryStore.clear();
  selectionStore.deselectAll();
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

  // Preload all icons before initializing stores
  await preloadAllIcons();

  // Initialize world terrain before entities
  worldStore.initialize();
  structureStore.initialize();

  // Initialize resources after structures (needs fort position)
  const fortPos = structureStore.fortPosition;

  if (fortPos) {
    resourceStore.initialize(fortPos);
  }

  unitStore.initialize();

  resizeCanvas();

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  camera.centerOn(camera.mapWidth / 2, camera.mapHeight / 2);

  gameLoop();
});

const resizeCanvas = () => {
  if (!canvasRef.value) return;

  canvasRef.value.width = window.innerWidth;
  canvasRef.value.height = window.innerHeight;
};

const gameLoop = () => {
  camera.updateMovement();
  unitStore.updateUnitPositions();

  render();

  animationFrameId = requestAnimationFrame(gameLoop);
};

const render = () => {
  if (!ctx || !canvasRef.value) return;

  const w = canvasRef.value.width;
  const h = canvasRef.value.height;

  // Clamp camera to map bounds
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

  // Draw resources (before structures)
  for (const resource of resourceStore.allResources) {
    void drawEntityIcon(ctx, resource, resource.position, { size: resource.iconSize });
  }

  // Draw structures first (below)
  for (const structure of structureStore.allStructures) {
    void drawEntityIcon(ctx, structure, structure.position, { size: structure.iconSize });
  }

  // Draw golden halos for selected units
  for (const unit of unitStore.allUnits) {
    if (selectionStore.isSelected(unit.id)) {
      ctx.beginPath();
      ctx.arc(unit.position.x, unit.position.y, unit.iconSize / 2 + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 3 / camera.zoom;
      ctx.stroke();
    }
  }

  // Draw units on top (above structures)
  for (const unit of unitStore.allUnits) {
    void drawEntityIcon(ctx, unit, unit.position, { size: unit.iconSize });
  }

  // Draw selection rectangle
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

  // Draw ping effect
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

  const worldMinX = camX - halfW;
  const worldMaxX = camX + halfW;
  const worldMinY = camY - halfH;
  const worldMaxY = camY + halfH;

  const startX = Math.floor(worldMinX / gridSize) * gridSize;
  const startY = Math.floor(worldMinY / gridSize) * gridSize;

  for (let x = startX; x <= worldMaxX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, worldMinY - gridSize);
    ctx.lineTo(x, worldMaxY + gridSize);
    ctx.stroke();
  }

  for (let y = startY; y <= worldMaxY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(worldMinX - gridSize, y);
    ctx.lineTo(worldMaxX + gridSize, y);
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

  // Draw lakes with improved visual style
  for (const lake of worldStore.allLakes) {
    const outline = lake.outline;

    if (!outline || outline.length < 3) continue;

    // Create gradient for depth effect
    const gradient = ctx.createRadialGradient(
      lake.center.x,
      lake.center.y,
      0,
      lake.center.x,
      lake.center.y,
      lake.radius,
    );
    gradient.addColorStop(0, "rgba(30, 100, 180, 0.5)"); // Deeper center
    gradient.addColorStop(0.7, "rgba(50, 140, 220, 0.4)");
    gradient.addColorStop(1, "rgba(70, 180, 255, 0.3)"); // Lighter edges

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

    // Add subtle inner glow
    ctx.strokeStyle = "rgba(150, 200, 255, 0.2)";
    ctx.lineWidth = 8 / camera.zoom;
    ctx.stroke();
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  camera.handleKeyDown(e.key);
};

const handleKeyUp = (e: KeyboardEvent) => {
  camera.handleKeyUp(e.key);
};

const handleWheel = (e: WheelEvent) => {
  e.preventDefault();

  const direction = e.deltaY > 0 ? -1 : 1;

  camera.adjustZoom(direction);
};

function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  if (!canvasRef.value) return { x: 0, y: 0 };

  const w = canvasRef.value.width;
  const h = canvasRef.value.height;

  const worldX = (screenX - w / 2) / camera.zoom - camera.panX;
  const worldY = (screenY - h / 2) / camera.zoom - camera.panY;

  return { x: worldX, y: worldY };
}

const handleMouseDown = (e: MouseEvent) => {
  // Only handle left click for selection
  if (e.button !== 0) return;

  const world = screenToWorld(e.offsetX, e.offsetY);

  selectionStore.startSelection(world.x, world.y);
};

const handleMouseMove = (e: MouseEvent) => {
  if (selectionStore.isSelecting) {
    const world = screenToWorld(e.offsetX, e.offsetY);

    selectionStore.updateSelection(world.x, world.y);
  }
};

const handleMouseUp = (e: MouseEvent) => {
  // Only handle left click for selection
  if (e.button !== 0) return;
  if (!selectionStore.isSelecting) return;

  const rect = selectionStore.getSelectionRect();

  if (rect && rect.width > 5 && rect.height > 5) {
    // Box selection
    const selectedIds: string[] = [];

    for (const unit of unitStore.allUnits) {
      const ux = unit.position.x;
      const uy = unit.position.y;

      if (ux >= rect.x && ux <= rect.x + rect.width && uy >= rect.y && uy <= rect.y + rect.height) {
        selectedIds.push(unit.id);
      }
    }

    selectionStore.selectUnits(selectedIds);
  } else {
    // Click selection
    const world = screenToWorld(e.offsetX, e.offsetY);

    let clickedUnit = false;

    for (const unit of unitStore.allUnits) {
      const dx = world.x - unit.position.x;
      const dy = world.y - unit.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < unit.iconSize / 2) {
        selectionStore.selectUnits([unit.id]);

        clickedUnit = true;

        break;
      }
    }

    if (!clickedUnit) {
      selectionStore.deselectAll();
    }
  }

  selectionStore.endSelection();
};

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();

  if (!selectionStore.hasSelectedUnits()) return;

  const world = screenToWorld(e.offsetX, e.offsetY);

  // Check if clicking on a resource
  let clickedResource = null;

  for (const resource of resourceStore.allResources) {
    const dx = world.x - resource.position.x;
    const dy = world.y - resource.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < resource.iconSize / 2) {
      clickedResource = resource;

      break;
    }
  }

  if (clickedResource) {
    // Send units to gather resource
    unitStore.gatherResource(Array.from(selectionStore.selectedUnitIds), clickedResource.id);
  } else {
    // Regular move command
    unitStore.moveUnitsTo(Array.from(selectionStore.selectedUnitIds), world.x, world.y);
  }

  // Show ping effect
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
