import { ref } from "vue";
import { defineStore } from "pinia";
import type { StructureType } from "@/types/Structure";

export type ActiveCommand = "move" | "attack" | "shelter" | "gather" | "build" | null;

export const useSelectionStore = defineStore("selection", () => {
  const selectedUnitIds = ref<Set<string>>(new Set());
  const isSelecting = ref(false);
  const selectionStart = ref<{ x: number; y: number } | null>(null);
  const selectionEnd = ref<{ x: number; y: number } | null>(null);

  /** Armed action-bar command awaiting a target click on the map ("move" / "attack"). */
  const activeCommand = ref<ActiveCommand>(null);

  /** Structure type picked in the build menu, waiting for a map click to drop its site. */
  const placementType = ref<StructureType | null>(null);

  function setActiveCommand(command: ActiveCommand) {
    activeCommand.value = command;
    if (command !== null) placementType.value = null;
  }

  function setPlacementType(type: StructureType | null) {
    placementType.value = type;
    if (type !== null) activeCommand.value = null;
  }

  function hasSelectedUnits(): boolean {
    return selectedUnitIds.value.size > 0;
  }

  function selectUnit(unitId: string) {
    selectedUnitIds.value.add(unitId);
    activeCommand.value = null;
  }

  function selectUnits(unitIds: string[]) {
    selectedUnitIds.value.clear();

    unitIds.forEach((id) => selectedUnitIds.value.add(id));
    activeCommand.value = null;
  }

  /** Adds to the current selection instead of replacing it — Ctrl+drag. */
  function addUnits(unitIds: string[]) {
    unitIds.forEach((id) => selectedUnitIds.value.add(id));
    activeCommand.value = null;
  }

  /** Ctrl+click on a unit: pick it up if it isn't selected, drop it if it is. */
  function toggleUnit(unitId: string) {
    if (selectedUnitIds.value.has(unitId)) selectedUnitIds.value.delete(unitId);
    else selectedUnitIds.value.add(unitId);

    activeCommand.value = null;
  }

  function deselectAll() {
    selectedUnitIds.value.clear();
    activeCommand.value = null;
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
    activeCommand,
    placementType,
    setActiveCommand,
    setPlacementType,
    hasSelectedUnits,
    selectUnit,
    selectUnits,
    addUnits,
    toggleUnit,
    deselectAll,
    deselectUnit,
    isSelected,
    startSelection,
    updateSelection,
    endSelection,
    getSelectionRect,
  };
});
