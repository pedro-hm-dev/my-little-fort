import { ref } from "vue";
import { defineStore } from "pinia";

export const useCameraStore = defineStore("camera", () => {
  const zoom = ref(1);
  const panX = ref(0);
  const panY = ref(0);

  const mapWidth = ref(5000);
  const mapHeight = ref(5000);

  const keysPressed = ref<Set<string>>(new Set());
  const moveSpeed = 5;

  function centerOn(x: number, y: number) {
    panX.value = -x;
    panY.value = -y;
  }

  function moveCamera(direction: "up" | "down" | "left" | "right") {
    const speed = moveSpeed / zoom.value;

    switch (direction) {
      case "up":
        panY.value += speed;
        break;
      case "down":
        panY.value -= speed;
        break;
      case "left":
        panX.value += speed;
        break;
      case "right":
        panX.value -= speed;
        break;
    }
  }

  function handleKeyDown(key: string) {
    keysPressed.value.add(key.toLowerCase());
  }

  function handleKeyUp(key: string) {
    keysPressed.value.delete(key.toLowerCase());
  }

  function updateMovement() {
    if (keysPressed.value.has("w")) moveCamera("up");
    if (keysPressed.value.has("s")) moveCamera("down");
    if (keysPressed.value.has("a")) moveCamera("left");
    if (keysPressed.value.has("d")) moveCamera("right");
  }

  function clampCamera(screenW: number, screenH: number) {
    const halfW = screenW / (2 * zoom.value);
    const halfH = screenH / (2 * zoom.value);

    const minCamX = halfW;
    const maxCamX = mapWidth.value - halfW;
    const minCamY = halfH;
    const maxCamY = mapHeight.value - halfH;

    let camX = -panX.value;
    let camY = -panY.value;

    if (mapWidth.value <= 2 * halfW) camX = mapWidth.value / 2;
    else camX = Math.min(maxCamX, Math.max(minCamX, camX));

    if (mapHeight.value <= 2 * halfH) camY = mapHeight.value / 2;
    else camY = Math.min(maxCamY, Math.max(minCamY, camY));

    panX.value = -camX;
    panY.value = -camY;
  }

  function adjustZoom(direction: 1 | -1) {
    const zoomSpeed = 0.1;
    const newZoom = Math.max(0.5, Math.min(3, zoom.value + direction * zoomSpeed));

    zoom.value = newZoom;
  }

  return {
    zoom,
    panX,
    panY,
    mapWidth,
    mapHeight,
    centerOn,
    clampCamera,
    adjustZoom,
    handleKeyDown,
    handleKeyUp,
    updateMovement,
  };
});
