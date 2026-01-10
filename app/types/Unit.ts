export interface Unit {
  id: string;
  type: UnitType;
  position: Position;
  targetPosition?: Position;
  targetResource?: string; // ID do recurso sendo coletado
  gatherProgress?: number; // Progresso atual da coleta (0-1)
  health: number;
  maxHealth: number;
  iconName: string;
  iconBaseSize: number;
  iconSize: number;
  baseSpeed: number;
  speed: number;
  baseSwimSpeed: number;
  swimSpeed: number;
  efficiency: number;
  baseEfficiency: number;
}

export enum UnitType {
  Worker = "worker",
  Soldier = "soldier",
}

export interface Position {
  x: number;
  y: number;
}
