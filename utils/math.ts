
import { Point } from '../types';

/**
 * Applies radial un-distortion to a point.
 */
export function undistortPoint(pt: Point, k1: number, center: Point, diagonal: number): Point {
  if (k1 === 0) return pt;
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  const r2 = (dx * dx + dy * dy) / (diagonal * diagonal);
  const factor = 1 + k1 * r2;
  return {
    x: center.x + dx / factor,
    y: center.y + dy / factor,
  };
}

/**
 * Solves Ax = B using Gaussian Elimination with partial pivoting.
 */
export function solveLinearSystem(A: number[][], B: number[]): number[] | null {
  const n = B.length;
  const mat = A.map((row, i) => [...row, B[i]]);

  for (let i = 0; i < n; i++) {
    let max = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(mat[j][i]) > Math.abs(mat[max][i])) max = j;
    }
    [mat[i], mat[max]] = [mat[max], mat[i]];

    const pivot = mat[i][i];
    if (Math.abs(pivot) < 1e-18) return null;

    for (let j = i + 1; j < n; j++) {
      const factor = mat[j][i] / pivot;
      for (let k = i; k <= n; k++) {
        mat[j][k] -= factor * mat[i][k];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) {
      sum += mat[i][j] * x[j];
    }
    x[i] = (mat[i][n] - sum) / mat[i][i];
  }
  return x;
}

/**
 * Computes Homography Matrix using Least-Squares fit for N points (N >= 4)
 */
export function computeHomography(src: Point[], dst: Point[]): number[] | null {
  if (src.length < 4 || src.length !== dst.length) return null;

  // 1. Data Normalization for numerical stability
  const normalize = (pts: Point[]) => {
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    const meanDist = pts.reduce((sum, p) => sum + Math.sqrt(Math.pow(p.x - cx, 2) + Math.pow(p.y - cy, 2)), 0) / pts.length;
    const scale = Math.sqrt(2) / (meanDist || 1);
    const T = [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1];
    const normPts = pts.map(p => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }));
    return { normPts, T, Tinv: [1/scale, 0, cx, 0, 1/scale, cy, 0, 0, 1]};
  };

  const s = normalize(src);
  const d = normalize(dst);

  // 2. Build the overdetermined system Ah = B (where h is the 8 parameters)
  // Each point pair gives 2 equations.
  const N = src.length;
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < N; i++) {
    const { x, y } = s.normPts[i];
    const { x: u, y: v } = d.normPts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }

  // 3. Solve using Normal Equations: (A^T * A) * h = (A^T * B)
  const At = new Array(8).fill(0).map((_, i) => A.map(row => row[i]));
  
  const AtA = new Array(8).fill(0).map(() => new Array(8).fill(0));
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      let sum = 0;
      for (let k = 0; k < A.length; k++) {
        sum += A[k][i] * A[k][j];
      }
      AtA[i][j] = sum;
    }
  }

  const AtB = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    let sum = 0;
    for (let k = 0; k < A.length; k++) {
      sum += A[k][i] * B[k];
    }
    AtB[i] = sum;
  }

  const hNorm = solveLinearSystem(AtA, AtB);
  if (!hNorm) return null;
  const Hn = [...hNorm, 1];

  const mult = (M1: number[], M2: number[]) => {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          C[i * 3 + j] += M1[i * 3 + k] * M2[k * 3 + j];
        }
      }
    }
    return C;
  };

  return mult(d.Tinv, mult(Hn, s.T));
}

export function invertMatrix3x3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet,
    (f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet,
    (d * h - e * g) * invDet, (g * b - a * h) * invDet, (a * e - b * d) * invDet,
  ];
}

export function applyHomography(pt: Point, H: number[]): Point {
  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = H;
  const w = h20 * pt.x + h21 * pt.y + h22;
  return {
    x: (h00 * pt.x + h01 * pt.y + h02) / w,
    y: (h10 * pt.x + h11 * pt.y + h12) / w,
  };
}

export function euclideanDistance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}
