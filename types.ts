
export interface Point {
  x: number;
  y: number;
  defined?: boolean;
}

export interface CalibrationTarget {
  id: string;
  points: Point[]; // 4 points ordered: TL, TR, BR, BL
  width: number;   // Real world Length (L)
  height: number;  // Real world Width (W)
}

export interface CalibrationData {
  targets: CalibrationTarget[];
  lensK1: number;     // Radial distortion coefficient
}

export type AppMode = 'CALIBRATE' | 'MEASURE';

export interface MeasurementPair {
  pointA: Point | null;
  pointB: Point | null;
}
