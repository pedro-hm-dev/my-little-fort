export interface Unit {
  id: string;
  type: UnitType;
  position: Position;
  targetPosition?: Position;
  targetResource?: string;
  gatherProgress?: number;
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
  foodPerDay: number;
  reproductionTimeHours: number;
  // Fort state
  insideFortId?: string;
  reproductionProgress?: number;
  reproductionTargetType?: UnitType;
}

export enum UnitType {
  Worker = "worker",
  Soldier = "soldier",
  Archer = "archer",
  Hunter = "hunter",
  Miner = "miner",
}

export interface Position {
  x: number;
  y: number;
}
