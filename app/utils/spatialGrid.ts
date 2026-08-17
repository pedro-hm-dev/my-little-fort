import type { Position } from "@/types/Terrain";

/**
 * Spatial hash grid for efficient proximity queries
 * Divides the world into cells for O(1) neighbor lookups
 */
export class SpatialGrid<T extends { position: Position; id: string }> {
  private cellSize: number;
  private grid: Map<string, T[]>;
  private entityCells: Map<string, string>; // entity id -> cell key

  constructor(cellSize: number = 200) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.entityCells = new Map();
  }

  private getCellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  private getCellCoords(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize),
    };
  }

  /**
   * Insert an entity into the grid
   */
  insert(entity: T): void {
    const key = this.getCellKey(entity.position.x, entity.position.y);

    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }

    this.grid.get(key)!.push(entity);
    this.entityCells.set(entity.id, key);
  }

  /**
   * Remove an entity from the grid
   */
  remove(entityId: string): boolean {
    const cellKey = this.entityCells.get(entityId);
    if (!cellKey) return false;

    const cell = this.grid.get(cellKey);
    if (!cell) return false;

    const index = cell.findIndex((e) => e.id === entityId);
    if (index === -1) return false;

    cell.splice(index, 1);
    this.entityCells.delete(entityId);

    // Clean up empty cells
    if (cell.length === 0) {
      this.grid.delete(cellKey);
    }

    return true;
  }

  /**
   * Update entity position (re-hash if moved to different cell)
   */
  update(entity: T): void {
    const oldKey = this.entityCells.get(entity.id);
    const newKey = this.getCellKey(entity.position.x, entity.position.y);

    if (oldKey === newKey) return;

    this.remove(entity.id);
    this.insert(entity);
  }

  /**
   * Get all entities within a radius of a point
   */
  queryRadius(x: number, y: number, radius: number): T[] {
    const results: T[] = [];
    const { cx, cy } = this.getCellCoords(x, y);

    // Calculate how many cells we need to check based on radius
    const cellRadius = Math.ceil(radius / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.grid.get(key);

        if (!cell) continue;

        for (const entity of cell) {
          const dist = Math.hypot(entity.position.x - x, entity.position.y - y);
          if (dist <= radius) {
            results.push(entity);
          }
        }
      }
    }

    return results;
  }

  /**
   * Get all entities within a rectangular area
   */
  queryRect(x: number, y: number, width: number, height: number): T[] {
    const results: T[] = [];

    const startCx = Math.floor(x / this.cellSize);
    const startCy = Math.floor(y / this.cellSize);
    const endCx = Math.floor((x + width) / this.cellSize);
    const endCy = Math.floor((y + height) / this.cellSize);

    for (let cx = startCx; cx <= endCx; cx++) {
      for (let cy = startCy; cy <= endCy; cy++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);

        if (!cell) continue;

        for (const entity of cell) {
          if (
            entity.position.x >= x &&
            entity.position.x <= x + width &&
            entity.position.y >= y &&
            entity.position.y <= y + height
          ) {
            results.push(entity);
          }
        }
      }
    }

    return results;
  }

  /**
   * Find nearest entity to a point, optionally skipping one id (e.g. the querying entity itself)
   */
  findNearest(x: number, y: number, maxRadius: number = Infinity, excludeId?: string): T | null {
    let nearest: T | null = null;
    let nearestDist = maxRadius;

    // Start with immediate cell and expand outward
    const { cx, cy } = this.getCellCoords(x, y);
    const maxCellRadius = maxRadius === Infinity ? 10 : Math.ceil(maxRadius / this.cellSize);

    for (let r = 0; r <= maxCellRadius; r++) {
      // Check ring at distance r
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          // Only check cells on the edge of the ring (optimization)
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;

          const key = `${cx + dx},${cy + dy}`;
          const cell = this.grid.get(key);

          if (!cell) continue;

          for (const entity of cell) {
            if (excludeId && entity.id === excludeId) continue;

            const dist = Math.hypot(entity.position.x - x, entity.position.y - y);
            if (dist < nearestDist) {
              nearest = entity;
              nearestDist = dist;
            }
          }
        }
      }

      // If we found something and the next ring is beyond our current best, stop
      if (nearest && (r + 1) * this.cellSize > nearestDist) {
        break;
      }
    }

    return nearest;
  }

  /**
   * Check if any entity exists within radius (faster than queryRadius when you just need boolean)
   */
  hasEntityWithinRadius(x: number, y: number, radius: number, excludeId?: string): boolean {
    const { cx, cy } = this.getCellCoords(x, y);
    const cellRadius = Math.ceil(radius / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.grid.get(key);

        if (!cell) continue;

        for (const entity of cell) {
          if (excludeId && entity.id === excludeId) continue;

          const dist = Math.hypot(entity.position.x - x, entity.position.y - y);
          if (dist <= radius) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Clear all entities from the grid
   */
  clear(): void {
    this.grid.clear();
    this.entityCells.clear();
  }

  /**
   * Get total entity count
   */
  get size(): number {
    return this.entityCells.size;
  }

  /**
   * Rebuild entire grid from an array of entities
   */
  rebuild(entities: T[]): void {
    this.clear();
    for (const entity of entities) {
      this.insert(entity);
    }
  }
}
