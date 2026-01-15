
export interface Point {
  x: number;
  y: number;
  defined?: boolean;
}

export interface CalibrationLine {
  id: string;
  start: Point;
  end: Point;
  trueLength: number;
  angle: number; // 0 = N-S (Parallel to Y), 90 = E-W (Parallel to X)
  defined: boolean;
}

export interface CalibrationData {
  lines: CalibrationLine[];
  lensK1: number;     // Radial distortion coefficient
  mape?: number;      // Mean Absolute Percentage Error
  rmse?: number;      // Root Mean Square Error
}

export type AppMode = 'CALIBRATE' | 'VALIDATE' | 'MEASURE';
export type InteractionMode = 'PLACE' | 'EDIT';

export interface ValidationLine {
  id: string;
  start: Point;
  end: Point;
  trueLength: number;
  defined: boolean;
  errorPct?: number;
  mcsUncertainty?: number;
}

export interface ValidationEntry {
  id: string;
  pointA: Point;
  pointB: Point;
  midpoint: Point;    // Midpoint in pixel coords for bias modeling
  measuredDist: number;
  trueDist: number;
  errorPct: number;
  uncertainty: number;
}

export interface MeasurementPair {
  pointA: Point | null;
  pointB: Point | null;
}

export interface ConfidenceIntervals {
  ci90: number;
  ci95: number;
  ci99: number;
}

export interface MeasurementArchiveEntry {
  id: string;
  name?: string;
  pointA: Point;
  pointB: Point;
  rawDist: number;
  correctedDist: number;
  uncertainty: number; // Raw Sigma from MCS
  intervals: ConfidenceIntervals;
  visible: boolean;     // v1.9.8 Visualization Toggle
  color: string;       // v1.9.8 Hex Color
}
