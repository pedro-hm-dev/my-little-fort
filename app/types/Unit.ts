export interface Unit {
  id: string;
  type: UnitType;
  position: Position;
  targetPosition?: Position;
  health: number;
  maxHealth: number;
  iconName: string;
  iconBaseSize: number;
  iconSize: number;
  baseSpeed: number;
  speed: number;
}

export enum UnitType {
  Worker = "worker",
  Soldier = "soldier",
}

export interface Position {
  x: number;
  y: number;
}
