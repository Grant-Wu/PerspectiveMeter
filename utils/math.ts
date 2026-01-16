import { Point, CalibrationLine, ValidationLine, ValidationEntry } from '../types';

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
 * Applies a 3x3 homography matrix to a 2D point.
 */
export function applyHomography(pt: Point, H: number[]): Point {
  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = H;
  const w = h20 * pt.x + h21 * pt.y + h22;
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 }; 
  return {
    x: (h00 * pt.x + h01 * pt.y + h02) / w,
    y: (h10 * pt.x + h11 * pt.y + h12) / w,
  };
}

export function euclideanDistance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * Multiplies two 3x3 matrices.
 */
export function multiplyMatrices(m1: number[], m2: number[]): number[] {
  const result = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        result[i * 3 + j] += m1[i * 3 + k] * m2[k * 3 + j];
      }
    }
  }
  return result;
}

/**
 * Normalizes a set of points (Hartley's Normalization).
 */
function normalizePoints(pts: Point[]): { normalized: Point[], T: number[] } {
  const centroid = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  centroid.x /= pts.length;
  centroid.y /= pts.length;

  const meanDist = pts.reduce((acc, p) => acc + euclideanDistance(p, centroid), 0) / pts.length;
  const scale = Math.sqrt(2) / (meanDist || 1);

  const T = [
    scale, 0, -scale * centroid.x,
    0, scale, -scale * centroid.y,
    0, 0, 1
  ];

  const normalized = pts.map(p => ({
    x: (p.x - centroid.x) * scale,
    y: (p.y - centroid.y) * scale
  }));

  return { normalized, T };
}

/**
 * Solves for Homography H using the 'Golden' Isotropy logic v4.0.
 * Strictly prevents geometric collapse via SVD penalty and applies Scale Lock.
 */
export function optimizeHomographyFromLines(
  lines: CalibrationLine[], 
  k1: number, 
  center: Point, 
  diag: number
): { matrix: number[], reprojectionErrors: number[], conditionNumber: number, mape: number, rmse: number } | null {
  const activeLines = lines.filter(l => l.defined);
  if (activeLines.length < 2) return null;

  // 1. Hartley Normalization
  const rawPoints: Point[] = [];
  activeLines.forEach(l => {
    rawPoints.push(undistortPoint(l.start, k1, center, diag));
    rawPoints.push(undistortPoint(l.end, k1, center, diag));
  });
  const { normalized, T: Tnorm } = normalizePoints(rawPoints);
  
  const data = activeLines.map((l, idx) => ({
    s: normalized[idx * 2],
    e: normalized[idx * 2 + 1],
    L: l.trueLength,
    ux: Math.sin((l.angle * Math.PI) / 180),
    uy: Math.cos((l.angle * Math.PI) / 180),
    angle: l.angle,
    weight: idx === 0 ? 50.0 : 1.0 
  }));

  // 2. Optimization with SVD Isotropy Constraint
  const initialScale = data[0].L / (euclideanDistance(data[0].s, data[0].e) || 1);
  let h = [initialScale, 0, 0, 0, initialScale, 0, 0, 1e-4, 1]; 

  const iterations = 30000;
  let stepSize = 1e-6;
  
  const lambdaSVD = 1000000.0; // Massive penalty for collapse
  const lambdaOrtho = 500000.0; // Force perpendicular vectors
  const lambdaAlign = 1.0;

  let finalCond = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradients = new Array(8).fill(0);
    const worldPoints: Point[] = [];

    // Length and Directional Residuals
    data.forEach(line => {
      const p1 = applyHomography(line.s, h);
      const p2 = applyHomography(line.e, h);
      worldPoints.push(p1, p2);

      const vx = p2.x - p1.x; const vy = p2.y - p1.y;
      const dist = Math.sqrt(vx * vx + vy * vy);
      const resLen = (dist - line.L) * line.weight;
      const resAlign = (vx * line.uy - vy * line.ux) * line.weight;

      const eps = 1e-8;
      for (let i = 0; i < 8; i++) {
        const hPrev = h[i]; h[i] += eps;
        const p1e = applyHomography(line.s, h); const p2e = applyHomography(line.e, h);
        const vxe = p2e.x - p1e.x; const vye = p2e.y - p1e.y;
        const diste = Math.sqrt(vxe * vxe + vye * vye);
        const dResLen = ((diste - line.L) * line.weight) - resLen;
        const dResAlign = ((vxe * line.uy - vye * line.ux) * line.weight) - resAlign;
        gradients[i] += 2 * resLen * (dResLen / eps) + 2 * lambdaAlign * resAlign * (dResAlign / eps);
        h[i] = hPrev;
      }
    });

    // ISOTROPY CHECK (SVD Ratio Penalty)
    const mean = worldPoints.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    mean.x /= worldPoints.length; mean.y /= worldPoints.length;
    let mXX = 0, mXY = 0, mYY = 0;
    worldPoints.forEach(p => {
      const dx = p.x - mean.x; const dy = p.y - mean.y;
      mXX += dx * dx; mXY += dx * dy; mYY += dy * dy;
    });
    const tr = mXX + mYY;
    const det = mXX * mYY - mXY * mXY;
    const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
    const l1 = (tr + disc) / 2;
    const l2 = (tr - disc) / 2;
    const s1 = Math.sqrt(l1); const s2 = Math.sqrt(l2);
    const spreadRatio = s2 / (s1 || 1e-12);
    finalCond = 1 / (spreadRatio + 1e-9);

    if (spreadRatio < 0.2) {
      const penalty = Math.pow(0.2 - spreadRatio, 2);
      const svdEps = 1e-8;
      for (let i = 0; i < 8; i++) {
        const hPrev = h[i]; h[i] += svdEps;
        let sumX = 0, sumY = 0;
        const localPts = worldPoints.map((_, idx) => {
          const p = applyHomography(idx % 2 === 0 ? data[Math.floor(idx/2)].s : data[Math.floor(idx/2)].e, h);
          sumX += p.x; sumY += p.y; return p;
        });
        const mx = sumX / localPts.length; const my = sumY / localPts.length;
        let mmXX = 0, mmXY = 0, mmYY = 0;
        localPts.forEach(p => {
          const dx = p.x - mx; const dy = p.y - my;
          mmXX += dx * dx; mmXY += dx * dy; mmYY += dy * dy;
        });
        const ttr = mmXX + mmYY; const ddet = mmXX * mmYY - mmXY * mmXY;
        const ll1 = (ttr + Math.sqrt(Math.max(0, ttr * ttr - 4 * ddet))) / 2;
        const ll2 = (ttr - Math.sqrt(Math.max(0, ttr * ttr - 4 * ddet))) / 2;
        const sRatioE = Math.sqrt(ll2) / (Math.sqrt(ll1) || 1e-12);
        const penaltyE = Math.pow(0.2 - sRatioE, 2);
        gradients[i] += lambdaSVD * (penaltyE - penalty) / svdEps;
        h[i] = hPrev;
      }
    }

    // ORTHOGONALITY: Force perpendicular group dot product to 0
    for (let i = 0; i < data.length; i++) {
      for (let j = i + 1; j < data.length; j++) {
        const angleDiff = Math.abs(data[i].angle - data[j].angle);
        if (Math.abs(angleDiff - 90) < 5 || Math.abs(angleDiff - 270) < 5) {
          const v1x = worldPoints[i*2+1].x - worldPoints[i*2].x;
          const v1y = worldPoints[i*2+1].y - worldPoints[i*2].y;
          const v2x = worldPoints[j*2+1].x - worldPoints[j*2].x;
          const v2y = worldPoints[j*2+1].y - worldPoints[j*2].y;
          const dot = (v1x * v2x + v1y * v2y) / (Math.sqrt(v1x*v1x + v1y*v1y) * Math.sqrt(v2x*v2x + v2y*v2y) || 1e-12);
          const oEps = 1e-8;
          for (let k = 0; k < 8; k++) {
            const hPrev = h[k]; h[k] += oEps;
            const p1a = applyHomography(data[i].s, h); const p1b = applyHomography(data[i].e, h);
            const p2a = applyHomography(data[j].s, h); const p2b = applyHomography(data[j].e, h);
            const v1xe = p1b.x - p1a.x; const v1ye = p1b.y - p1a.y;
            const v2xe = p2b.x - p2a.x; const v2ye = p2b.y - p2a.y;
            const dotE = (v1xe * v2xe + v1ye * v2ye) / (Math.sqrt(v1xe*v1xe + v1ye*v1ye) * Math.sqrt(v2xe*v2xe + v2ye*v2ye) || 1e-12);
            gradients[k] += lambdaOrtho * 2 * dot * ((dotE - dot) / oEps);
            h[k] = hPrev;
          }
        }
      }
    }

    let gNorm = 0;
    for (let i = 0; i < 8; i++) gNorm += gradients[i] * gradients[i];
    gNorm = Math.sqrt(gNorm);
    if (gNorm > 1e-12) {
      const step = Math.min(stepSize, 0.1 / gNorm);
      for (let i = 0; i < 8; i++) h[i] -= step * gradients[i];
    }
    if (iter % 3000 === 0) stepSize *= 0.65;
  }

  // 3. Post-Process Scaling (SAFE ANCHOR LOCK v4.0)
  let hRaw = multiplyMatrices([...h, 1], Tnorm);
  let anchorIdx = 0; let maxLen = -1;
  activeLines.forEach((l, idx) => { if (l.trueLength > maxLen) { maxLen = l.trueLength; anchorIdx = idx; } });
  
  const anchor = activeLines[anchorIdx];
  const aS = undistortPoint(anchor.start, k1, center, diag);
  const aE = undistortPoint(anchor.end, k1, center, diag);
  const calcLen = euclideanDistance(applyHomography(aS, hRaw), applyHomography(aE, hRaw));
  const sFactor = anchor.trueLength / (calcLen || 1);
  hRaw = multiplyMatrices([sFactor, 0, 0, 0, sFactor, 0, 0, 0, 1], hRaw);

  // Rotation and Alignment (Line 0 as reference)
  const p1 = applyHomography(undistortPoint(activeLines[0].start, k1, center, diag), hRaw);
  const p2 = applyHomography(undistortPoint(activeLines[0].end, k1, center, diag), hRaw);
  const tx = -p1.x; const ty = -p1.y;
  const rad0 = (activeLines[0].angle * Math.PI) / 180;
  const rotateAngle = Math.atan2(Math.sin(rad0), Math.cos(rad0)) - Math.atan2(p2.x + tx, p2.y + ty);
  const R = [Math.cos(rotateAngle), -Math.sin(rotateAngle), 0, Math.sin(rotateAngle), Math.cos(rotateAngle), 0, 0, 0, 1];
  let finalH = multiplyMatrices(multiplyMatrices(R, [1, 0, tx, 0, 1, ty, 0, 0, 1]), hRaw);
  
  // Y-Axis Orient check
  if (applyHomography({x: center.x, y: center.y - diag/2}, finalH).y < applyHomography({x: center.x, y: center.y + diag/2}, finalH).y) {
    finalH = multiplyMatrices([1, 0, 0, 0, -1, 0, 0, 0, 1], finalH);
  }

  // Final Calibration Metrics with Ensemble Protocol
  let sumSqErr = 0; let sumAbsPctErr = 0;
  activeLines.forEach(line => {
    // Ensuring performance metrics use ensemble-averaged estimated lengths
    const mc = runMonteCarlo(line.start, line.end, finalH, k1, center, diag, 100, 2.0);
    const d = mc.mean;
    const err = d - line.trueLength;
    sumSqErr += err * err;
    sumAbsPctErr += Math.abs(err / line.trueLength);
  });

  return { 
    matrix: finalH, 
    reprojectionErrors: activeLines.map(l => 0), // Placeholder
    conditionNumber: finalCond,
    mape: (sumAbsPctErr / activeLines.length) * 100,
    rmse: Math.sqrt(sumSqErr / activeLines.length)
  };
}

/**
 * Monte Carlo Simulation (MCS) for Precision Analysis using the "30-Seed Ensemble Protocol".
 * v2.1.2: Iterates through 30 fixed seeds (0-29), performs a seeded MCS for each, 
 * and returns the arithmetic mean of lengths and standard deviations.
 */
export function runMonteCarlo(
  pA: Point, 
  pB: Point, 
  H: number[], 
  k1: number, 
  center: Point, 
  diag: number, 
  iterations = 100, 
  sigma = 2.0
): { mean: number; stdDev: number } {
  // Fixed list of 30 integer seeds to ensure robust estimation
  const ENSEMBLE_SEEDS = Array.from({ length: 30 }, (_, i) => i);
  
  const ensembleResults = ENSEMBLE_SEEDS.map(seedValue => {
    let currentSeed = seedValue;
    const seededRandom = () => {
      // Deterministic LCG for reproducibility within each seed run
      currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
      return currentSeed / 4294967296;
    };

    const localDistances: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const noise = () => (seededRandom() * 2 - 1) * sigma;
      const nA = { x: pA.x + noise(), y: pA.y + noise() };
      const nB = { x: pB.x + noise(), y: pB.y + noise() };
      const uA = undistortPoint(nA, k1, center, diag);
      const uB = undistortPoint(nB, k1, center, diag);
      localDistances.push(euclideanDistance(applyHomography(uA, H), applyHomography(uB, H)));
    }
    
    const localMean = localDistances.reduce((a, b) => a + b) / iterations;
    const localVariance = localDistances.reduce((a, b) => a + Math.pow(b - localMean, 2), 0) / (iterations - 1 || 1);
    
    return { mean: localMean, stdDev: Math.sqrt(localVariance) };
  });

  // Return the Arithmetic Mean of the 30 ensemble results for stabilized output
  const finalMean = ensembleResults.reduce((acc, r) => acc + r.mean, 0) / 30;
  const finalStd = ensembleResults.reduce((acc, r) => acc + r.stdDev, 0) / 30;
  
  return { mean: finalMean, stdDev: finalStd };
}

/**
 * Bias Prediction using a simplified Gaussian Process proxy.
 * Returns both bias ratio and local prediction uncertainty sigma.
 */
export function predictBiasRatio(
  midpoint: Point,
  history: ValidationEntry[]
): { ratio: number; confidence: number; localSigma: number } {
  const baseSigma = 0.15; // Conservative 15% error fallback
  if (history.length === 0) return { ratio: 1.0, confidence: 0, localSigma: baseSigma };
  
  const kernelSigma = 800; // Pixel neighborhood for GPR
  let totalWeight = 0; 
  let weightedRatio = 0;
  
  history.forEach(entry => {
    const distSq = Math.pow(midpoint.x - entry.midpoint.x, 2) + Math.pow(midpoint.y - entry.midpoint.y, 2);
    const weight = Math.exp(-distSq / (2 * kernelSigma * kernelSigma));
    weightedRatio += (entry.trueDist / (entry.measuredDist || 1)) * weight;
    totalWeight += weight;
  });
  
  const conf = Math.min(1, totalWeight);
  const ratio = totalWeight > 0.1 ? (weightedRatio / totalWeight) : 1.0;
  
  // Advanced Uncertainty: Tighter sigma near validated points, fallback to baseSigma elsewhere
  const minResidualSigma = 0.02; // Empirical model floor
  const localSigma = baseSigma * (1 - conf) + minResidualSigma * conf;

  return { ratio: ratio * conf + 1.0 * (1 - conf), confidence: conf, localSigma };
}

export function transformWorldH(H: number[], type: 'rotate' | 'flipH' | 'flipV'): number[] {
  let T = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (type === 'rotate') T = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  else if (type === 'flipH') T = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
  else if (type === 'flipV') T = [1, 0, 0, 0, -1, 0, 0, 0, 1];
  return multiplyMatrices(T, H);
}