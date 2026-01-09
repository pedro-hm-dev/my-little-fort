export interface Structure {
  id: string;
  type: StructureType;
  position: Position;
  health: number;
  maxHealth: number;
  iconName: string;
  iconBaseSize: number;
  iconSize: number;
}

export enum StructureType {
  Fort = "fort",
}

export interface Position {
  x: number;
  y: number;
}
