import { ref } from "vue";
import { defineStore } from "pinia";

export const useSelectionStore = defineStore("selection", () => {
  const selectedUnitIds = ref<Set<string>>(new Set());
  const isSelecting = ref(false);
  const selectionStart = ref<{ x: number; y: number } | null>(null);
  const selectionEnd = ref<{ x: number; y: number } | null>(null);

  function hasSelectedUnits(): boolean {
    return selectedUnitIds.value.size > 0;
  }

  function selectUnit(unitId: string) {
    selectedUnitIds.value.add(unitId);
  }

  function selectUnits(unitIds: string[]) {
    selectedUnitIds.value.clear();

    unitIds.forEach((id) => selectedUnitIds.value.add(id));
  }

  function deselectAll() {
    selectedUnitIds.value.clear();
  }

  function deselectUnit(unitId: string) {
    selectedUnitIds.value.delete(unitId);
  }

  function isSelected(unitId: string): boolean {
    return selectedUnitIds.value.has(unitId);
  }

  function startSelection(worldX: number, worldY: number) {
    isSelecting.value = true;

    selectionStart.value = { x: worldX, y: worldY };
    selectionEnd.value = { x: worldX, y: worldY };
  }

  function updateSelection(worldX: number, worldY: number) {
    if (isSelecting.value) {
      selectionEnd.value = { x: worldX, y: worldY };
    }
  }

  function endSelection() {
    isSelecting.value = false;
    selectionStart.value = null;
    selectionEnd.value = null;
  }

  function getSelectionRect(): { x: number; y: number; width: number; height: number } | null {
    if (!selectionStart.value || !selectionEnd.value) return null;

    const x = Math.min(selectionStart.value.x, selectionEnd.value.x);
    const y = Math.min(selectionStart.value.y, selectionEnd.value.y);
    const width = Math.abs(selectionEnd.value.x - selectionStart.value.x);
    const height = Math.abs(selectionEnd.value.y - selectionStart.value.y);

    return { x, y, width, height };
  }

  return {
    selectedUnitIds,
    isSelecting,
    selectionStart,
    selectionEnd,
    hasSelectedUnits,
    selectUnit,
    selectUnits,
    deselectAll,
    deselectUnit,
    isSelected,
    startSelection,
    updateSelection,
    endSelection,
    getSelectionRect,
  };
});
