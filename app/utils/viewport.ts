import { type Bounds } from "@/utils/geometry";

export { type Bounds };

/** World-space rect currently on screen, from the canvas size and the camera transform. */
export function viewportBounds(
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
  panX: number,
  panY: number,
): Bounds {
  const halfWidth = canvasWidth / (2 * zoom);
  const halfHeight = canvasHeight / (2 * zoom);
  const centerX = -panX;
  const centerY = -panY;

  return {
    minX: centerX - halfWidth,
    minY: centerY - halfHeight,
    maxX: centerX + halfWidth,
    maxY: centerY + halfHeight,
  };
}

/** Whether a circle overlaps the view — used to skip entities the canvas would clip anyway. */
export function circleOnScreen(x: number, y: number, radius: number, view: Bounds): boolean {
  const closestX = Math.min(Math.max(x, view.minX), view.maxX);
  const closestY = Math.min(Math.max(y, view.minY), view.maxY);
  const dx = x - closestX;
  const dy = y - closestY;

  return dx * dx + dy * dy <= radius * radius;
}

export function boundsOnScreen(bounds: Bounds, view: Bounds): boolean {
  return (
    bounds.minX <= view.maxX && bounds.maxX >= view.minX && bounds.minY <= view.maxY && bounds.maxY >= view.minY
  );
}

