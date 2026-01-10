export interface Position {
  x: number;
  y: number;
}

export interface Lake {
  center: Position;
  radius: number;
  outline: Position[]; // smoothed perimeter points
}
