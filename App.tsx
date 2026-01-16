import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { CalibrationData, AppMode, InteractionMode, MeasurementPair, CalibrationLine, ValidationLine, Point, MeasurementArchiveEntry, ConfidenceIntervals } from './types.ts';
import Sidebar from './components/Sidebar.tsx';
import CanvasArea from './components/CanvasArea.tsx';
import { optimizeHomographyFromLines, applyHomography, euclideanDistance, undistortPoint, runMonteCarlo, predictBiasRatio } from './utils/math.ts';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, ImageRun, BorderStyle, HeadingLevel } from 'https://esm.sh/docx';

const App: React.FC = () => {
  const [imageGallery, setImageGallery] = useState<{ name: string; data: string }[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState<number>(-1);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<AppMode>('CALIBRATE');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('PLACE');
  const [zoom, setZoom] = useState(1);
  const [showUploader, setShowUploader] = useState(false);
  
  // BEV Visualization controls
  const [bevFlipH, setBevFlipH] = useState(false);
  const [bevFlipV, setBevFlipV] = useState(false);
  const [bevRotation, setBevRotation] = useState(0);
  const [bevZoom, setBevZoom] = useState(1.0);

  // v1.4+ Data Management
  const [savedDatasets, setSavedDatasets] = useState<Record<string, any[]>>({});
  const [savedMeasurementDatasets, setSavedMeasurementDatasets] = useState<Record<string, MeasurementArchiveEntry[]>>({});

  const [clickHistory, setClickHistory] = useState<{lineId: string, pointType: 'start' | 'end'}[]>([]);
  const [valClickHistory, setValClickHistory] = useState<{lineId: string, pointType: 'start' | 'end'}[]>([]);
  
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const isResizing = useRef(false);
  const [selectedLine, setSelectedLine] = useState<{ lineId: string; pointType: 'start' | 'end' } | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'computing' | 'success' | 'error'>('idle');

  const [calibration, setCalibration] = useState<CalibrationData>({
    lines: [],
    lensK1: 0,
  });
  
  const [validationLines, setValidationLines] = useState<ValidationLine[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementPair>({
    pointA: null,
    pointB: null,
  });

  const [calcResult, setCalcResult] = useState<{
    dist: number;
    rawDist: number;
    biasCorrection: number;
    uncertainty: number; 
    intervals: ConfidenceIntervals;
  } | null>(null);

  const [measurementArchive, setMeasurementArchive] = useState<MeasurementArchiveEntry[]>([]);
  const [homographyMatrix, setHomographyMatrix] = useState<number[] | null>(null);
  const [reprojectionErrors, setReprojectionErrors] = useState<number[]>([]);

  // Current active image data
  const image = useMemo(() => {
    return activeImageIdx >= 0 && imageGallery[activeImageIdx] ? imageGallery[activeImageIdx].data : null;
  }, [imageGallery, activeImageIdx]);

  // Update dimensions when active image changes
  useEffect(() => {
    if (image) {
      const img = new Image();
      img.onload = () => setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = image;
    }
  }, [image]);
  
  /**
   * v1.9.8 Helper: Generate default color based on index (Red -> Purple)
   */
  const getGradientColor = useCallback((idx: number) => {
    const t = Math.min(idx, 60) / 60.0;
    const r = Math.round(255 + (128 - 255) * t);
    const g = 0;
    const b = Math.round(128 * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  }, []);

  /**
   * Validation Stats Calculation
   */
  const validationStats = useMemo(() => {
    if (!homographyMatrix || !imgDims.w) return { globalMape: 0, rmse: 0, validCount: 0 };
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);

    const activeLines = validationLines.filter(vl => vl.defined && vl.trueLength > 0);
    if (activeLines.length === 0) return { globalMape: 0, rmse: 0, validCount: 0 };

    let sumAbsPctErr = 0;
    let sumSqErr = 0;

    activeLines.forEach(vl => {
      const uS = undistortPoint(vl.start, calibration.lensK1, center, diag);
      const uE = undistortPoint(vl.end, calibration.lensK1, center, diag);
      const calcLen = euclideanDistance(applyHomography(uS, homographyMatrix), applyHomography(uE, homographyMatrix));
      const err = calcLen - vl.trueLength;
      sumSqErr += err * err;
      sumAbsPctErr += Math.abs(err / vl.trueLength);
    });

    return {
      globalMape: (sumAbsPctErr / activeLines.length) * 100,
      rmse: Math.sqrt(sumSqErr / activeLines.length),
      validCount: activeLines.length
    };
  }, [validationLines, homographyMatrix, imgDims, calibration.lensK1]);

  const worldPoints = useMemo(() => {
    if (!homographyMatrix || !imgDims.w) return [];
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);
    
    return calibration.lines.map(line => {
      const uStart = undistortPoint(line.start, calibration.lensK1, center, diag);
      const uEnd = undistortPoint(line.end, calibration.lensK1, center, diag);
      return {
        id: line.id,
        start: applyHomography(uStart, homographyMatrix),
        end: applyHomography(uEnd, homographyMatrix)
      };
    });
  }, [homographyMatrix, calibration, imgDims]);

  const resetAnalysis = useCallback(() => {
    setCalibration({ lines: [], lensK1: 0 });
    setValidationLines([]);
    setMeasurements({ pointA: null, pointB: null });
    setSavedDatasets({});
    setSavedMeasurementDatasets({});
    setHomographyMatrix(null);
    setCalcResult(null);
    setMeasurementArchive([]);
    setCalibrationStatus('idle');
    setReprojectionErrors([]);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const loaders = Array.from(files).slice(0, 50).map(file => {
        return new Promise<{ name: string; data: string }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            resolve({ name: file.name, data: event.target?.result as string });
          };
          reader.readAsDataURL(file);
        });
      });
      
      const newImages = await Promise.all(loaders);
      setImageGallery(prev => [...prev, ...newImages]);
      if (activeImageIdx === -1) {
        setActiveImageIdx(0);
      }
      setShowUploader(false);
    }
  };

  const handleManualCoordUpdate = (type: 'CALIBRATE' | 'VALIDATE' | 'MEASURE', id: string, pointType: string, axis: 'x' | 'y', value: number) => {
    if (type === 'CALIBRATE') {
      setCalibration(prev => ({
        ...prev,
        lines: prev.lines.map(l => l.id === id ? { ...l, [pointType]: { ...l[pointType as 'start' | 'end'], [axis]: value } } : l)
      }));
    } else if (type === 'VALIDATE') {
      setValidationLines(prev => prev.map(l => l.id === id ? { ...l, [pointType]: { ...l[pointType as 'start' | 'end'], [axis]: value } } : l));
    } else if (type === 'MEASURE') {
      setMeasurements(prev => ({
        ...prev,
        [pointType]: { ...prev[pointType as 'pointA' | 'pointB'] as Point, [axis]: value }
      }));
    }
  };

  const computeCalibration = useCallback(() => {
    if (!imgDims.w || calibration.lines.length < 2) return;
    setCalibrationStatus('computing');
    
    setTimeout(() => {
      const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
      const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);
      const result = optimizeHomographyFromLines(calibration.lines, calibration.lensK1, center, diag);
      
      if (result) {
        setHomographyMatrix(result.matrix);
        setReprojectionErrors(result.reprojectionErrors);
        setCalibration(prev => ({ ...prev, mape: result.mape, rmse: result.rmse }));
        setCalibrationStatus('success');
      } else {
        setCalibrationStatus('error');
      }
    }, 450);
  }, [calibration, imgDims]);

  useEffect(() => {
    if (!homographyMatrix || validationLines.length === 0) return;
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);

    const updated = validationLines.map(l => {
      if (!l.defined || l.trueLength <= 0) return l;
      const uS = undistortPoint(l.start, calibration.lensK1, center, diag);
      const uE = undistortPoint(l.end, calibration.lensK1, center, diag);
      const calcLen = euclideanDistance(applyHomography(uS, homographyMatrix), applyHomography(uE, homographyMatrix));
      const errPct = (Math.abs(l.trueLength - calcLen) / l.trueLength) * 100;
      const mcs = runMonteCarlo(l.start, l.end, homographyMatrix, calibration.lensK1, center, diag, 100, 2.0);
      return { ...l, errorPct: errPct, mcsUncertainty: mcs.stdDev * 2 };
    });

    const hasChanged = updated.some((l, idx) => 
      l.errorPct !== validationLines[idx].errorPct || l.mcsUncertainty !== validationLines[idx].mcsUncertainty
    );
    if (hasChanged) setValidationLines(updated);
  }, [homographyMatrix, validationLines.length, calibration.lensK1, imgDims]);

  const calculateMeasurement = useCallback(() => {
    if (!homographyMatrix || !measurements.pointA || !measurements.pointB || !imgDims.w) return;
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);
    
    const uA = undistortPoint(measurements.pointA, calibration.lensK1, center, diag);
    const uB = undistortPoint(measurements.pointB, calibration.lensK1, center, diag);
    const rawDist = euclideanDistance(applyHomography(uA, homographyMatrix), applyHomography(uB, homographyMatrix));
    
    const valEntries = validationLines.filter(vl => vl.defined && vl.trueLength > 0).map(vl => {
      const vA = undistortPoint(vl.start, calibration.lensK1, center, diag);
      const vB = undistortPoint(vl.end, calibration.lensK1, center, diag);
      const mD = euclideanDistance(applyHomography(vA, homographyMatrix), applyHomography(vB, homographyMatrix));
      return {
        id: vl.id, pointA: vl.start, pointB: vl.end, midpoint: { x: (vl.start.x + vl.end.x) / 2, y: (vl.start.y + vl.end.y) / 2 },
        measuredDist: mD, trueDist: vl.trueLength, errorPct: ((mD - vl.trueLength) / (vl.trueLength || 1)) * 100, uncertainty: 0 
      };
    });

    const mid = { x: (measurements.pointA.x + measurements.pointB.x) / 2, y: (measurements.pointA.y + measurements.pointB.y) / 2 };
    
    // GPR Local Prediction Error Modeling
    const biasRes = predictBiasRatio(mid, valEntries);
    const correctedDist = rawDist * biasRes.ratio;

    const mc = runMonteCarlo(measurements.pointA, measurements.pointB, homographyMatrix, calibration.lensK1, center, diag, 100, 2.0);
    
    const sigmaGPR = biasRes.confidence > 0 ? (biasRes.localSigma) : (correctedDist * 0.15);
    const sigmaTotal = Math.sqrt(Math.pow(mc.stdDev, 2) + Math.pow(sigmaGPR, 2));
    
    const intervals: ConfidenceIntervals = {
      ci90: 1.645 * sigmaTotal,
      ci95: 1.960 * sigmaTotal,
      ci99: 2.576 * sigmaTotal,
    };

    setCalcResult({
      dist: correctedDist, rawDist: rawDist, biasCorrection: (biasRes.ratio - 1) * 100, uncertainty: sigmaTotal, intervals: intervals,
    });

    const nextIdx = measurementArchive.length;
    setMeasurementArchive(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        name: `Measurement ${prev.length + 1}`,
        pointA: measurements.pointA!, pointB: measurements.pointB!,
        rawDist: rawDist, correctedDist: correctedDist, uncertainty: sigmaTotal, intervals: intervals,
        visible: true,
        color: getGradientColor(nextIdx)
      }
    ]);
  }, [homographyMatrix, measurements, calibration, imgDims, validationLines, validationStats, measurementArchive.length, getGradientColor]);

  const generateReport = async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: "TRACE: Traffic Reconstruction & Accident Camera Estimation - Forensic Report (v2.0.2)", bold: true, size: 40 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            children: [new TextRun({ text: "Lead Investigator: Assistant Professor Yuan-Wei Wu", bold: true, size: 24 })],
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            children: [new TextRun({ text: "Department of Traffic Science, Central Police University", size: 20 })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 600 },
          }),

          new Paragraph({ text: "1. Advanced Metrological Methodology", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Calibration Logic: ", bold: true }),
              new TextRun("Algorithm utilizes Hartley Normalization to condition point sets. The Homography (H) matrix is solved using SVD optimization with a strict Isotropy Penalty (σmin/σmax > 0.2) to prevent geometric collapse.\n"),
              new TextRun({ text: "Scale Locking: ", bold: true }),
              new TextRun("Reference scaling is anchored using the single longest user-provided calibration vector to maximize geometric leverage.\n"),
              new TextRun({ text: "Bias Correction: ", bold: true }),
              new TextRun("Gaussian Process Regression (GPR) with RBF kernel modeling of validation residuals for localized spatial bias compensation.\n"),
              new TextRun({ text: "Precision Model: ", bold: true }),
              new TextRun("Forensic intervals follow a combined propagation model: σ_total = √(σ_MCS² + σ_GPR_Local²). This accounts for both Monte Carlo precision (pixel noise) and local prediction variance from the bias model."),
            ],
            spacing: { after: 400 },
          }),

          new Paragraph({ text: "2. Calibration Data Matrix", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: ["ID", "Start (u,v)", "End (u,v)", "True (m)", "Angle (°)"].map(h => new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                  shading: { fill: "f1f5f9" }
                }))
              }),
              ...calibration.lines.map((l, idx) => new TableRow({
                children: [
                  `Ref #${idx+1}`,
                  `(${l.start.x.toFixed(0)}, ${l.start.y.toFixed(0)})`,
                  `(${l.end.x.toFixed(0)}, ${l.end.y.toFixed(0)})`,
                  `${l.trueLength.toFixed(3)}m`,
                  `${l.angle.toFixed(0)}°`
                ].map(v => new TableCell({ children: [new Paragraph(v)] }))
              }))
            ]
          }),

          new Paragraph({ text: "3. Empirical Validation Audit", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Paragraph({ text: `Global MAPE: ${validationStats.globalMape.toFixed(2)}%`, spacing: { after: 200 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: ["ID", "Start (u,v)", "End (u,v)", "True (m)", "Error (%)"].map(h => new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                  shading: { fill: "f1f5f9" }
                }))
              }),
              ...validationLines.map((vl, idx) => new TableRow({
                children: [
                  `Sample ${idx+1}`,
                  `(${vl.start.x.toFixed(0)}, ${vl.start.y.toFixed(0)})`,
                  `(${vl.end.x.toFixed(0)}, ${vl.end.y.toFixed(0)})`,
                  `${vl.trueLength.toFixed(3)}m`,
                  `${vl.errorPct?.toFixed(2)}%`
                ].map(v => new TableCell({ children: [new Paragraph(v)] }))
              }))
            ]
          }),

          new Paragraph({ text: "4. Corrected Bird's Eye View (Isotropic)", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Orientation Config: ", bold: true }),
              new TextRun(`F-H: ${bevFlipH ? 'Y' : 'N'}, F-V: ${bevFlipV ? 'Y' : 'N'}, Rot: ${bevRotation.toFixed(0)}°, Zoom: ${bevZoom.toFixed(3)}x`),
            ]
          }),

          new Paragraph({ text: "5. Forensic Measurement Log", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: ["ID", "P1(u,v)", "P2(u,v)", "Corrected(m)", "Standard Deviation", "90% CI", "95% CI", "99% CI"].map(h => new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                  shading: { fill: "f1f5f9" }
                }))
              }),
              ...measurementArchive.map(r => new TableRow({
                children: [
                  r.name || r.id,
                  `(${r.pointA.x.toFixed(0)}, ${r.pointA.y.toFixed(0)})`,
                  `(${r.pointB.x.toFixed(0)}, ${r.pointB.y.toFixed(0)})`,
                  `${r.correctedDist.toFixed(2)}`,
                  `${r.uncertainty.toFixed(2)}`,
                  `[${(r.correctedDist - r.intervals.ci90).toFixed(2)}, ${(r.correctedDist + r.intervals.ci90).toFixed(2)}]`,
                  `[${(r.correctedDist - r.intervals.ci95).toFixed(2)}, ${(r.correctedDist + r.intervals.ci95).toFixed(2)}]`,
                  `[${(r.correctedDist - r.intervals.ci99).toFixed(2)}, ${(r.correctedDist + r.intervals.ci99).toFixed(2)}]`
                ].map(v => new TableCell({ children: [new Paragraph(v)] }))
              }))
            ]
          }),

          new Paragraph({
            children: [new TextRun({ text: "\n\n© Yuan-Wei Wu, Department of Traffic Science, Central Police University", size: 12, italic: true })],
            alignment: AlignmentType.RIGHT,
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TRACE_Report_v2.0.2.docx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearScoped = useCallback(() => {
    if (mode === 'CALIBRATE') {
      setCalibration({ lines: [], lensK1: 0 });
      setHomographyMatrix(null);
      setCalibrationStatus('idle');
    } else if (mode === 'VALIDATE') {
      setValidationLines([]);
    } else if (mode === 'MEASURE') {
      setMeasurements({ pointA: null, pointB: null });
      setCalcResult(null);
      setMeasurementArchive([]);
    }
  }, [mode]);

  const undoLastPoint = useCallback(() => {
    if (mode === 'CALIBRATE') {
      setCalibration(prev => ({ ...prev, lines: prev.lines.slice(0, -1) }));
    } else if (mode === 'VALIDATE') {
      setValidationLines(prev => prev.slice(0, -1));
    } else {
      setMeasurements(prev => {
        if (prev.pointB) return { ...prev, pointB: null };
        if (prev.pointA) return { ...prev, pointA: null };
        return prev;
      });
    }
    setCalcResult(null);
  }, [mode]);

  return (
    <div className="flex h-screen w-screen bg-slate-950 overflow-hidden font-sans select-none text-slate-200">
      <Sidebar
        width={sidebarWidth}
        mode={mode}
        setMode={(m) => { setMode(m); setCalcResult(null); setInteractionMode('PLACE'); }}
        interactionMode={interactionMode}
        setInteractionMode={setInteractionMode}
        zoom={zoom}
        setZoom={setZoom}
        calibration={calibration}
        setCalibration={setCalibration}
        calibrationStatus={calibrationStatus}
        onDeleteLine={(id) => setCalibration(p => ({ ...p, lines: p.lines.filter(l => l.id !== id) }))}
        measurements={measurements}
        setMeasurements={setMeasurements}
        measurementArchive={measurementArchive}
        setMeasurementArchive={setMeasurementArchive}
        calcResult={calcResult}
        onCalculate={calculateMeasurement}
        onComputeCalibration={computeCalibration}
        onUndo={undoLastPoint}
        onClearScoped={clearScoped}
        onDownloadReport={generateReport}
        onManualCoordUpdate={handleManualCoordUpdate}
        canCalculate={!!(homographyMatrix && measurements.pointA && measurements.pointB)}
        canUndo={true}
        validationLines={validationLines}
        setValidationLines={setValidationLines}
        onDeleteValidationLine={(id) => setValidationLines(prev => prev.filter(l => l.id !== id))}
        selectedLine={selectedLine}
        setSelectedLine={setSelectedLine}
        worldPoints={worldPoints}
        homographyMatrix={homographyMatrix}
        imgDims={imgDims}
        validationStats={validationStats}
        flipH={bevFlipH}
        setFlipH={setBevFlipH}
        flipV={bevFlipV}
        setFlipV={setBevFlipV}
        rotation={bevRotation}
        setRotation={setBevRotation}
        bevZoom={bevZoom}
        setBevZoom={setBevZoom}
        savedDatasets={savedDatasets}
        setSavedDatasets={setSavedDatasets}
        savedMeasurementDatasets={savedMeasurementDatasets}
        setSavedMeasurementDatasets={setSavedMeasurementDatasets}
        showUploader={showUploader}
        setShowUploader={setShowUploader}
        handleFileUpload={handleFileUpload}
        sourceImage={image}
        imageGallery={imageGallery}
        activeImageIdx={activeImageIdx}
        setActiveImageIdx={setActiveImageIdx}
      />
      
      <div className="w-1 bg-slate-800 hover:bg-blue-600 transition-colors cursor-col-resize active:bg-blue-500 z-50 shrink-0" onMouseDown={() => { isResizing.current = true; }} />

      <main className="flex-1 flex flex-col relative min-w-0">
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-8 z-10 shrink-0">
          <div className="flex items-center gap-4">
            <label className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase tracking-widest py-2.5 px-6 rounded-lg cursor-pointer transition-all shadow-lg active:scale-95">
              <span>Link Source Images</span>
              <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
            </label>
            <div className="h-4 w-[1px] bg-slate-800"></div>
            <span className="text-[12px] font-black text-blue-400 tracking-tighter uppercase shrink-0">
              TRACE: Traffic Reconstruction & Accident Camera Estimation
            </span>
          </div>
          <div className="flex items-center gap-4 bg-slate-900 px-4 py-1.5 rounded-full border border-slate-800 shadow-inner">
             {['CALIBRATE', 'VALIDATE', 'MEASURE'].map(m => (
               <button 
                 key={m} 
                 onClick={() => { setMode(m as AppMode); setCalcResult(null); setInteractionMode('PLACE'); }} 
                 className={`text-[9px] font-black tracking-[0.2em] px-6 py-1.5 rounded-full transition-all whitespace-nowrap ${mode === m ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
               >
                 {m}
               </button>
             ))}
          </div>
        </header>

        <CanvasArea
          image={image}
          mode={mode}
          interactionMode={interactionMode}
          zoom={zoom}
          calibration={calibration}
          setCalibration={setCalibration}
          setClickHistory={setClickHistory}
          validationLines={validationLines}
          setValidationLines={setValidationLines}
          setValClickHistory={setValClickHistory}
          measurements={measurements}
          setMeasurements={setMeasurements}
          selectedLine={selectedLine}
          setSelectedLine={setSelectedLine}
          measurementArchive={measurementArchive}
        />

        <footer className="h-14 bg-slate-950 border-t border-slate-800 flex flex-col items-center justify-center px-8 shrink-0">
          <div className="text-[10px] font-medium text-[#BBBBBB] uppercase tracking-widest">
            Copyright © Yuan-Wei Wu, Department of Traffic Science, Central Police University
          </div>
          <div className="text-[8px] font-mono text-slate-400 mt-1 uppercase">
            Metrological Integrity Engine | Reconstruction Platform v2.0.2.0
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;