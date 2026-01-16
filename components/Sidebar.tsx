import React, { useState, useMemo, useCallback } from 'react';
import { CalibrationData, AppMode, InteractionMode, MeasurementPair, Point, ValidationLine, ValidationEntry, CalibrationLine, MeasurementArchiveEntry } from '../types';
import { undistortPoint, applyHomography, euclideanDistance, runMonteCarlo, predictBiasRatio } from '../utils/math';

interface SidebarProps {
  width: number;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  calibration: CalibrationData;
  setCalibration: React.Dispatch<React.SetStateAction<CalibrationData>>;
  calibrationStatus: 'idle' | 'computing' | 'success' | 'error';
  onDeleteLine: (id: string) => void;
  measurements: MeasurementPair;
  setMeasurements: React.Dispatch<React.SetStateAction<MeasurementPair>>;
  measurementArchive: MeasurementArchiveEntry[];
  setMeasurementArchive: React.Dispatch<React.SetStateAction<MeasurementArchiveEntry[]>>;
  calcResult: { 
    dist: number; 
    rawDist: number; 
    biasCorrection: number; 
    uncertainty: number; 
    intervals: { ci90: number; ci95: number; ci99: number } 
  } | null;
  onCalculate: () => void;
  onComputeCalibration: () => void;
  onUndo: () => void;
  onClearScoped: () => void;
  onDownloadReport: () => void;
  onManualCoordUpdate: (type: AppMode, id: string, pointType: string, axis: 'x' | 'y', value: number) => void;
  canCalculate: boolean;
  canUndo: boolean;
  validationLines: ValidationLine[];
  setValidationLines: React.Dispatch<React.SetStateAction<ValidationLine[]>>;
  onDeleteValidationLine: (id: string) => void;
  selectedLine: { lineId: string; pointType: 'start' | 'end' } | null;
  setSelectedLine: (sel: { lineId: string; pointType: 'start' | 'end' } | null) => void;
  worldPoints: { id: string, start: Point, end: Point }[];
  homographyMatrix: number[] | null;
  imgDims: { w: number, h: number };
  validationStats: { globalMape: number, rmse: number, validCount: number };
  // Visual controls
  flipH: boolean;
  setFlipH: (val: boolean) => void;
  flipV: boolean;
  setFlipV: (val: boolean) => void;
  rotation: number;
  setRotation: (val: number) => void;
  bevZoom: number;
  setBevZoom: (val: number) => void;
  // v1.4+ Data Management
  savedDatasets: Record<string, any[]>;
  setSavedDatasets: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  savedMeasurementDatasets: Record<string, MeasurementArchiveEntry[]>;
  setSavedMeasurementDatasets: React.Dispatch<React.SetStateAction<Record<string, MeasurementArchiveEntry[]>>>;
  // v1.7 additions
  showUploader: boolean;
  setShowUploader: (val: boolean) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sourceImage: string | null;
  // v2.0.2 additions
  imageGallery: { name: string; data: string }[];
  activeImageIdx: number;
  setActiveImageIdx: (idx: number) => void;
}

/**
 * Metric Card component mimicking Streamlit's st.metric aesthetic
 */
const MetricCard: React.FC<{ label: string; value: string; colorClass: string }> = ({ label, value, colorClass }) => (
  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-center shadow-lg">
    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-1">{label}</span>
    <span className={`text-2xl font-black ${colorClass}`}>{value}</span>
  </div>
);

const Sidebar: React.FC<SidebarProps> = ({
  width,
  mode,
  setMode,
  interactionMode,
  setInteractionMode,
  zoom,
  setZoom,
  calibration,
  setCalibration,
  calibrationStatus,
  onDeleteLine,
  measurements,
  setMeasurements,
  measurementArchive,
  setMeasurementArchive,
  calcResult,
  onCalculate,
  onComputeCalibration,
  onUndo,
  onClearScoped,
  onDownloadReport,
  onManualCoordUpdate,
  canCalculate,
  canUndo,
  validationLines,
  setValidationLines,
  onDeleteValidationLine,
  selectedLine,
  setSelectedLine,
  worldPoints,
  homographyMatrix,
  imgDims,
  validationStats,
  flipH,
  setFlipH,
  flipV,
  setFlipV,
  rotation,
  setRotation,
  bevZoom,
  setBevZoom,
  savedDatasets,
  setSavedDatasets,
  savedMeasurementDatasets,
  setSavedMeasurementDatasets,
  showUploader,
  setShowUploader,
  handleFileUpload,
  sourceImage,
  imageGallery,
  activeImageIdx,
  setActiveImageIdx
}) => {
  const [datasetName, setDatasetName] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [renameInput, setRenameInput] = useState("");
  const [measurementDatasetName, setMeasurementDatasetName] = useState("");
  const [selectedMeasurementDataset, setSelectedMeasurementDataset] = useState("");

  const anchorIdx = useMemo(() => {
    let max = -1, idx = -1;
    calibration.lines.forEach((l, i) => { if (l.defined && l.trueLength > max) { max = l.trueLength; idx = i; } });
    return idx;
  }, [calibration.lines]);

  const handleSavePoints = () => {
    if (!datasetName.trim()) return;
    const currentLines = mode === 'CALIBRATE' ? calibration.lines : validationLines;
    setSavedDatasets(prev => ({
      ...prev,
      [datasetName]: JSON.parse(JSON.stringify(currentLines))
    }));
    setDatasetName("");
  };

  const handleLoadPoints = () => {
    if (!selectedDataset || !savedDatasets[selectedDataset]) return;
    const lines = savedDatasets[selectedDataset];
    if (mode === 'CALIBRATE') {
      setCalibration(prev => ({ ...prev, lines: lines as CalibrationLine[] }));
    } else if (mode === 'VALIDATE') {
      setValidationLines(lines as ValidationLine[]);
    }
  };

  const handleSaveMeasurements = () => {
    if (!measurementDatasetName.trim()) return;
    setSavedMeasurementDatasets(prev => ({
      ...prev,
      [measurementDatasetName]: JSON.parse(JSON.stringify(measurementArchive))
    }));
    setDatasetName("");
  };

  const handleLoadMeasurements = () => {
    if (!selectedMeasurementDataset || !savedMeasurementDatasets[selectedMeasurementDataset]) return;
    setMeasurementArchive(savedMeasurementDatasets[selectedMeasurementDataset]);
  };

  const handleDeleteDataset = (type: 'GEOM' | 'MEAS') => {
    const sel = type === 'GEOM' ? selectedDataset : selectedMeasurementDataset;
    if (!sel) return;
    const confirmed = window.confirm(`Delete dataset "${sel}"?`);
    if (!confirmed) return;
    
    if (type === 'GEOM') {
      setSavedDatasets(prev => { const n = { ...prev }; delete n[sel]; return n; });
      setSelectedDataset("");
    } else {
      setSavedMeasurementDatasets(prev => { const n = { ...prev }; delete n[sel]; return n; });
      setSelectedMeasurementDataset("");
    }
  };

  const handleRenameDataset = () => {
    if (!selectedDataset || !renameInput.trim()) return;
    if (savedDatasets[renameInput]) {
      alert("A dataset with this name already exists.");
      return;
    }

    setSavedDatasets(prev => {
      const next = { ...prev };
      next[renameInput] = next[selectedDataset];
      delete next[selectedDataset];
      return next;
    });
    setSelectedDataset(renameInput);
    setRenameInput("");
  };

  const handleExportCSV = () => {
    const currentLines = mode === 'CALIBRATE' ? calibration.lines : validationLines;
    const header = "id,x1,y1,x2,y2,length,angle\n";
    const rows = currentLines.map(l => {
      const angle = (l as any).angle || 0;
      const length = l.trueLength || 0;
      return `${l.id},${l.start.x.toFixed(0)},${l.start.y.toFixed(0)},${l.end.x.toFixed(0)},${l.end.y.toFixed(0)},${length.toFixed(3)},${angle.toFixed(0)}`;
    }).join("\n");
    
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TRACE_${mode}_Export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMeasurementsCSV = () => {
    const header = "ID,Name,u1,v1,u2,v2,Raw_Length,Corrected_Length,Standard_Deviation,90_Min,90_Max,95_Min,95_Max,99_Min,99_Max,Visible,Color\n";
    const rows = measurementArchive.map(m => {
      return [
        m.id,
        m.name || m.id,
        m.pointA.x.toFixed(0), m.pointA.y.toFixed(0),
        m.pointB.x.toFixed(0), m.pointB.y.toFixed(0),
        m.rawDist.toFixed(2),
        m.correctedDist.toFixed(2),
        m.uncertainty.toFixed(2),
        (m.correctedDist - m.intervals.ci90).toFixed(2), (m.correctedDist + m.intervals.ci90).toFixed(2),
        (m.correctedDist - m.intervals.ci95).toFixed(2), (m.correctedDist + m.intervals.ci95).toFixed(2),
        (m.correctedDist - m.intervals.ci99).toFixed(2), (m.correctedDist + m.intervals.ci99).toFixed(2),
        m.visible ? "TRUE" : "FALSE",
        m.color
      ].join(",");
    }).join("\n");
    
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TRACE_Measurements_Export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const lines = content.split("\n").slice(1);
      const parsedLines: any[] = lines.filter(row => row.trim()).map(row => {
        const [id, x1, y1, x2, y2, length, angle] = row.split(",");
        return {
          id: id || Math.random().toString(36).substr(2, 9),
          start: { x: parseFloat(x1), y: parseFloat(y1), defined: true },
          end: { x: parseFloat(x2), y: parseFloat(y2), defined: true },
          trueLength: parseFloat(length) || 1.0,
          angle: parseFloat(angle) || 0,
          defined: true
        };
      });

      if (mode === 'CALIBRATE') {
        setCalibration(prev => ({ ...prev, lines: parsedLines }));
      } else if (mode === 'VALIDATE') {
        setValidationLines(parsedLines);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /**
   * General handler for measurement archive updates
   */
  const handleUpdateArchiveEntry = useCallback((id: string, updates: Partial<MeasurementArchiveEntry>) => {
    setMeasurementArchive(prev => {
      const entry = prev.find(e => e.id === id);
      if (!entry) return prev;
      
      const updatedEntry = { ...entry, ...updates };
      
      // If geometric changes occur, recalculate. Otherwise just return updated entry.
      if (updates.pointA || updates.pointB) {
        if (!homographyMatrix || !imgDims.w) return prev;
        const pA = updatedEntry.pointA;
        const pB = updatedEntry.pointB;

        const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
        const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);

        const uA = undistortPoint(pA, calibration.lensK1, center, diag);
        const uB = undistortPoint(pB, calibration.lensK1, center, diag);
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

        const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
        const biasRes = predictBiasRatio(mid, valEntries);
        const correctedDist = rawDist * biasRes.ratio;
        const mc = runMonteCarlo(pA, pB, homographyMatrix, calibration.lensK1, center, diag, 100, 2.0);
        const sigmaGPR = biasRes.confidence > 0 ? (biasRes.localSigma) : (correctedDist * 0.15);
        const sigmaTotal = Math.sqrt(Math.pow(mc.stdDev, 2) + Math.pow(sigmaGPR, 2));
        const intervals = { ci90: 1.645 * sigmaTotal, ci95: 1.960 * sigmaTotal, ci99: 2.576 * sigmaTotal };

        updatedEntry.rawDist = rawDist;
        updatedEntry.correctedDist = correctedDist;
        updatedEntry.uncertainty = sigmaTotal;
        updatedEntry.intervals = intervals;
      }

      return prev.map(e => e.id === id ? updatedEntry : e);
    });
  }, [homographyMatrix, imgDims, calibration, validationLines, setMeasurementArchive]);

  const handleImportMeasurementsCSV = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !homographyMatrix || !imgDims.w) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const lines = content.split("\n").slice(1);
      const newArchive: MeasurementArchiveEntry[] = [];
      
      const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
      const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);

      for (const row of lines) {
        if (!row.trim()) continue;
        const [id, name, u1, v1, u2, v2] = row.split(",");
        const pA = { x: parseFloat(u1), y: parseFloat(v1) };
        const pB = { x: parseFloat(u2), y: parseFloat(v2) };

        const uA = undistortPoint(pA, calibration.lensK1, center, diag);
        const uB = undistortPoint(pB, calibration.lensK1, center, diag);
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

        const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
        const biasRes = predictBiasRatio(mid, valEntries);
        const correctedDist = rawDist * biasRes.ratio;
        const mc = runMonteCarlo(pA, pB, homographyMatrix, calibration.lensK1, center, diag, 100, 2.0);
        const sigmaGPR = biasRes.confidence > 0 ? (biasRes.localSigma) : (correctedDist * 0.15);
        const sigmaTotal = Math.sqrt(Math.pow(mc.stdDev, 2) + Math.pow(sigmaGPR, 2));
        const intervals = { ci90: 1.645 * sigmaTotal, ci95: 1.960 * sigmaTotal, ci99: 2.576 * sigmaTotal };

        newArchive.push({
          id: id || Math.random().toString(36).substr(2, 9),
          name: name || `Imported ${id}`,
          pointA: pA, pointB: pB,
          rawDist, correctedDist, uncertainty: sigmaTotal, intervals,
          visible: true,
          color: "#FF0000" // Default for imports
        });
      }
      setMeasurementArchive(prev => [...prev, ...newArchive]);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [homographyMatrix, imgDims, calibration, validationLines, setMeasurementArchive]);

  const birdsEyeView = useMemo(() => {
    if (worldPoints.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    worldPoints.forEach(p => {
      minX = Math.min(minX, p.start.x, p.end.x); maxX = Math.max(maxX, p.start.x, p.end.x);
      minY = Math.min(minY, p.start.y, p.end.y); maxY = Math.max(maxY, p.start.y, p.end.y);
    });
    const pad = 2.0; minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const wBase = width - 80; const hBase = 240;
    const scale = Math.min(wBase / (maxX - minX || 1), hBase / (maxY - minY || 1)) * bevZoom;
    const project = (p: Point) => {
      let px = p.x; let py = p.y;
      if (flipH) px = maxX - (px - minX);
      if (flipV) py = maxY - (py - minY);
      const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
      const rad = (rotation * Math.PI) / 180;
      const dx = px - cx; const dy = py - cy;
      px = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      py = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
      return { x: (px - minX) * scale + (wBase * bevZoom - (maxX - minX) * scale) / 2, y: hBase * bevZoom - ((py - minY) * scale + (hBase * bevZoom - (maxY - minY) * scale) / 2) };
    };
    return (
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-hidden shadow-inner space-y-4 mt-4 animate-in fade-in duration-500">
        <div className="border-b border-slate-900 pb-2 space-y-3">
           <div className="flex items-center justify-between">
             <h3 className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Corrected Bird's Eye View (Isotropic)</h3>
             <div className="flex gap-2 text-[8px] font-bold uppercase text-blue-400">
                <label className="flex items-center gap-1 cursor-pointer hover:text-blue-300"><input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} className="rounded bg-slate-900 border-slate-700" />Flip H</label>
                <label className="flex items-center gap-1 cursor-pointer hover:text-blue-300"><input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} className="rounded bg-slate-900 border-slate-700" />Flip V</label>
             </div>
           </div>
           <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] font-black uppercase text-slate-400"><span>Rotate BEV (°)</span><span className="text-blue-400 font-mono">{rotation.toFixed(0)}°</span></div>
                <input type="range" min="-180" max="180" step="1" value={rotation} onChange={(e) => setRotation(parseInt(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] font-black uppercase text-slate-400"><span>BEV Zoom (x)</span><span className="text-blue-400 font-mono">{bevZoom.toFixed(3)}x</span></div>
                <input type="range" min="0.1" max="3.0" step="0.1" value={bevZoom} onChange={(e) => setBevZoom(parseFloat(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
              </div>
           </div>
        </div>
        <div className="overflow-auto no-scrollbar max-h-[300px] bev-svg-container">
          <svg width={wBase * bevZoom} height={hBase * bevZoom} className="mx-auto overflow-visible">
            {worldPoints.map((p, i) => {
              const s = project(p.start), e = project(p.end);
              return (
                <g key={p.id}>
                  <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={i === anchorIdx ? "#d946ef" : "#10b981"} strokeWidth={i === anchorIdx ? (4 * bevZoom) : (2 * bevZoom)} strokeLinecap="round" />
                  <circle cx={s.x} cy={s.y} r={3 * bevZoom} fill={i === anchorIdx ? "#d946ef" : "#10b981"} />
                  <circle cx={e.x} cy={e.y} r={3 * bevZoom} fill={i === anchorIdx ? "#d946ef" : "#10b981"} />
                  <text x={(s.x + e.x) / 2} y={(s.y + e.y) / 2} fill="#94a3b8" fontSize={8 * bevZoom} fontWeight="bold" textAnchor="middle" dy="-5">#{i+1}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <button onClick={() => {
            const svgEl = document.querySelector('.bev-svg-container svg');
            if (!svgEl) return;
            const serializer = new XMLSerializer();
            let source = serializer.serializeToString(svgEl);
            if(!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
            if(!source.match(/^<svg[^>]+xmlns\:xlink="http\:\/\/www\.w3\.org\/1999\/xlink"/)) source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            const svgBlob = new Blob(['<?xml version="1.0" standalone="no"?>\r\n', source], {type:"image/svg+xml;charset=utf-8"});
            const url = URL.createObjectURL(svgBlob);
            const link = document.createElement('a');
            link.href = url; link.download = "BEV.svg"; link.click(); URL.revokeObjectURL(url);
        }} className="w-full py-2 bg-slate-800 border border-slate-700 rounded text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-slate-700 transition-all flex items-center justify-center gap-2">💾 Download BEV as SVG</button>
      </div>
    );
  }, [worldPoints, width, anchorIdx, flipH, flipV, rotation, bevZoom, setFlipH, setFlipV, setRotation, setBevZoom]);

  return (
    <div className="h-full bg-slate-900 border-r border-slate-700 p-6 overflow-y-auto flex flex-col gap-6 shadow-xl shrink-0 no-scrollbar" style={{ width: `${width}px` }}>
      <div>
        <h1 className="text-2xl font-black text-blue-400 mb-1 flex items-center gap-2 tracking-tighter">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 20l-5.447-2.724A2 2 0 013 15.487V5.513a2 2 0 011.553-1.943L9 2l5.447 2.724A2 2 0 0116 6.663v9.974a2 2 0 01-1.553 1.943L9 20z" /></svg>
          TRACE v2.0.2
        </h1>
        <p className="text-[9px] text-[#E0E0E0] uppercase tracking-widest font-black leading-tight">Traffic Reconstruction & Accident <br/> Camera Estimation</p>
      </div>

      <section className="bg-slate-950/40 p-4 rounded-xl border border-slate-800/50 space-y-4">
        <button onClick={() => setShowUploader(!showUploader)} className="w-full py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2">🔄 Link Source Images (Batch)</button>
        {(showUploader || !sourceImage) && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
            <label className="w-full py-4 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-blue-500/50 transition-all bg-slate-900/50">
              <svg className="w-6 h-6 text-slate-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <span className="text-[9px] font-black text-slate-400 uppercase">Select Forensic Sources (Up to 50)</span>
              <input type="file" accept="image/*" className="hidden" multiple onChange={handleFileUpload} />
            </label>
          </div>
        )}

        {imageGallery.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Active Image</label>
            <select 
              value={activeImageIdx} 
              onChange={(e) => setActiveImageIdx(parseInt(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-[10px] text-blue-400 outline-none focus:border-blue-500 font-mono"
            >
              {imageGallery.map((img, idx) => (
                <option key={idx} value={idx}>{img.name}</option>
              ))}
            </select>
            <div className="text-[8px] font-bold text-slate-500 uppercase text-center">
              Total Linked: {imageGallery.length} / 50
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center px-1"><h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Image Zoom (%)</h3><span className="text-[11px] font-mono text-blue-400">{(zoom * 100).toFixed(0)}%</span></div>
          <input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex bg-slate-950/50 p-1 rounded-lg border border-slate-800 gap-1">
          <button onClick={() => setInteractionMode('PLACE')} className={`flex-1 text-[9px] font-black uppercase tracking-widest py-2 rounded-md transition-all ${interactionMode === 'PLACE' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-300 hover:text-slate-100'}`}>DRAW</button>
          <button onClick={() => setInteractionMode('EDIT')} className={`flex-1 text-[9px] font-black uppercase tracking-widest py-2 rounded-md transition-all ${interactionMode === 'EDIT' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-300 hover:text-slate-100'}`}>EDIT</button>
        </div>

        {/* Data Manager Logic */}
        {(mode === 'CALIBRATE' || mode === 'VALIDATE') && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-3">
            <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-1">📁 Data Manager</h3>
            <input type="text" placeholder="Dataset Name" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10px] text-white outline-none" />
            <button onClick={handleSavePoints} className="w-full py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-[10px] font-black uppercase tracking-widest transition-all">Save Current Points</button>
            <select value={selectedDataset} onChange={(e) => setSelectedDataset(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10px] text-white outline-none">
              <option value="">-- Load Saved Dataset --</option>
              {Object.keys(savedDatasets).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            {selectedDataset && (
              <div className="flex gap-1">
                <button onClick={handleLoadPoints} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-[9px] font-black uppercase tracking-widest transition-all">Load</button>
                <button onClick={() => handleDeleteDataset('GEOM')} className="py-1.5 px-3 bg-red-900/30 border border-red-900/50 hover:bg-red-800/50 text-red-400 rounded text-[9px] font-black uppercase tracking-widest transition-all">Delete</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button onClick={handleExportCSV} className="py-2 bg-slate-800 border border-slate-700 rounded text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-slate-700 transition-all">💾 Export CSV</button>
              <label className="py-2 bg-slate-800 border border-slate-700 rounded text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-slate-700 transition-all cursor-pointer text-center">📂 Import CSV<input type="file" accept=".csv" className="hidden" onChange={handleImportCSV} /></label>
            </div>
          </div>
        )}

        {mode === 'MEASURE' && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-3">
             <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-1">📊 Measurement Data Manager</h3>
             <input type="text" placeholder="Set Name" value={measurementDatasetName} onChange={(e) => setMeasurementDatasetName(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10px] text-white outline-none" />
             <button onClick={handleSaveMeasurements} className="w-full py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-[10px] font-black uppercase tracking-widest transition-all">Save Set</button>
             <select value={selectedMeasurementDataset} onChange={(e) => setSelectedMeasurementDataset(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-[10px] text-white outline-none">
               <option value="">-- Load Saved Set --</option>
               {Object.keys(savedMeasurementDatasets).map(name => <option key={name} value={name}>{name}</option>)}
             </select>
             {selectedMeasurementDataset && (
               <div className="flex gap-1">
                 <button onClick={handleLoadMeasurements} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-[9px] font-black uppercase tracking-widest transition-all">Load</button>
                 <button onClick={() => handleDeleteDataset('MEAS')} className="py-1.5 px-3 bg-red-900/30 border border-red-900/50 hover:bg-red-800/50 text-red-400 rounded text-[9px] font-black uppercase tracking-widest transition-all">Delete</button>
               </div>
             )}
             <div className="grid grid-cols-2 gap-2 pt-2">
                <button onClick={handleExportMeasurementsCSV} className="py-2 bg-slate-800 border border-slate-700 rounded text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-slate-700 transition-all">💾 Export CSV</button>
                <label className="py-2 bg-slate-800 border border-slate-700 rounded text-[9px] font-black uppercase tracking-widest text-blue-400 hover:bg-slate-700 transition-all cursor-pointer text-center">📂 Import CSV<input type="file" accept=".csv" className="hidden" onChange={handleImportMeasurementsCSV} /></label>
             </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onUndo} disabled={!canUndo} className="py-2.5 rounded-lg border text-[10px] font-black uppercase bg-slate-800 border-slate-600 text-slate-100 disabled:opacity-30">Undo</button>
          <button onClick={onClearScoped} className="py-2.5 rounded-lg border text-[10px] font-black uppercase bg-red-950/20 border-red-900/30 text-red-400 hover:bg-red-900/40">Clear</button>
        </div>
      </section>

      {mode === 'CALIBRATE' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-left-4 pb-12">
          {calibration.mape !== undefined && (
            <div className="grid grid-cols-1 gap-2">
              <MetricCard label="Model MAPE" value={`${calibration.mape.toFixed(2)}%`} colorClass="text-blue-400" />
            </div>
          )}
          <div className="space-y-3 max-h-[300px] overflow-y-auto no-scrollbar pr-1">
            {calibration.lines.map((line, i) => (
              <div key={line.id} className={`bg-slate-950 border p-3 rounded-xl space-y-3 ${i === anchorIdx ? 'border-l-4 border-l-magenta-500 border-magenta-500/30' : 'border-slate-800'}`} style={i === anchorIdx ? { borderColor: '#d946ef' } : {}}>
                <div className="flex justify-between items-center text-[9px] font-black uppercase" style={{ color: i === anchorIdx ? '#d946ef' : '#3b82f6' }}>
                  <span>Ref Vector #{i+1} {i === anchorIdx && '⚓ (Anchor)'}</span>
                  <button onClick={() => onDeleteLine(line.id)} className="text-red-500 hover:text-red-400 font-bold">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div className="space-y-1"><span className="text-[7px] text-slate-400 font-bold uppercase tracking-wider">P1 (u, v)</span><div className="flex gap-1"><input type="number" step="1" value={Math.round(line.start.x)} onChange={(e) => onManualCoordUpdate('CALIBRATE', line.id, 'start', 'x', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /><input type="number" step="1" value={Math.round(line.start.y)} onChange={(e) => onManualCoordUpdate('CALIBRATE', line.id, 'start', 'y', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /></div></div>
                   <div className="space-y-1"><span className="text-[7px] text-slate-400 font-bold uppercase tracking-wider">P2 (u, v)</span><div className="flex gap-1"><input type="number" step="1" value={Math.round(line.end.x)} onChange={(e) => onManualCoordUpdate('CALIBRATE', line.id, 'end', 'x', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /><input type="number" step="1" value={Math.round(line.end.y)} onChange={(e) => onManualCoordUpdate('CALIBRATE', line.id, 'end', 'y', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /></div></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div><span className="text-[8px] font-bold text-slate-300 uppercase mb-1 block">True Len (m)</span><input type="number" step="0.001" value={line.trueLength} onChange={(e) => setCalibration(p => ({ ...p, lines: p.lines.map(l => l.id === line.id ? { ...l, trueLength: parseFloat(e.target.value) || 0 } : l) }))} className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-white font-mono font-bold outline-none" /></div>
                   <div><span className="text-[8px] font-bold text-slate-300 uppercase mb-1 block">Angle (°)</span><input type="number" step="1" value={Math.round(line.angle)} onChange={(e) => setCalibration(p => ({ ...p, lines: p.lines.map(l => l.id === line.id ? { ...l, angle: parseFloat(e.target.value) || 0 } : l) }))} className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-white font-mono font-bold outline-none" /></div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onComputeCalibration} disabled={calibrationStatus === 'computing'} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black uppercase text-[11px] shadow-lg">Compute Calibration (SVD)</button>
          {calibrationStatus === 'success' && homographyMatrix && birdsEyeView}
        </section>
      )}

      {mode === 'VALIDATE' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4">
          <MetricCard label="Global Validation MAPE" value={`${validationStats.globalMape.toFixed(2)}%`} colorClass="text-orange-500" />
          <div className="space-y-3 max-h-[450px] overflow-y-auto no-scrollbar pr-1">
            {validationLines.map((vl, i) => (
              <div key={vl.id} className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-3">
                <div className="flex justify-between items-center text-[10px] font-black text-orange-400 uppercase"><span>Validation Sample #{i+1}</span><button onClick={() => onDeleteValidationLine(vl.id)} className="text-red-500 hover:text-red-400">×</button></div>
                <div className="grid grid-cols-2 gap-2">
                   <div className="space-y-1"><span className="text-[7px] text-slate-400 font-bold uppercase tracking-wider">P1 (u, v)</span><div className="flex gap-1"><input type="number" step="1" value={Math.round(vl.start.x)} onChange={(e) => onManualCoordUpdate('VALIDATE', vl.id, 'start', 'x', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /><input type="number" step="1" value={Math.round(vl.start.y)} onChange={(e) => onManualCoordUpdate('VALIDATE', vl.id, 'start', 'y', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /></div></div>
                   <div className="space-y-1"><span className="text-[7px] text-slate-400 font-bold uppercase tracking-wider">P2 (u, v)</span><div className="flex gap-1"><input type="number" step="1" value={Math.round(vl.end.x)} onChange={(e) => onManualCoordUpdate('VALIDATE', vl.id, 'end', 'x', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /><input type="number" step="1" value={Math.round(vl.end.y)} onChange={(e) => onManualCoordUpdate('VALIDATE', vl.id, 'end', 'y', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-[10px] text-white font-mono outline-none" /></div></div>
                </div>
                <div><span className="text-[8px] font-bold text-slate-300 uppercase mb-1 block">True Len (m)</span><input type="number" step="0.001" value={vl.trueLength} onChange={(e) => setValidationLines(prev => prev.map(l => l.id === vl.id ? { ...l, trueLength: parseFloat(e.target.value) || 0 } : l))} className="w-full bg-slate-900 border border-slate-800 rounded p-1.5 text-xs text-white font-mono font-bold" /></div>
                {vl.errorPct !== undefined && <div className="flex gap-2 pt-1 border-t border-slate-900"><div className="flex-1"><span className="text-[7px] font-bold text-slate-400 uppercase block mb-0.5">Det. Error</span><span className={`text-[10px] font-mono font-bold ${vl.errorPct < 1 ? 'text-emerald-400' : 'text-orange-400'}`}>{vl.errorPct.toFixed(2)}%</span></div><div className="flex-1 text-right"><span className="text-[7px] font-bold text-slate-400 uppercase block mb-0.5">Prec. (2σ)</span><span className="text-[10px] font-mono font-bold text-blue-400">{vl.mcsUncertainty?.toFixed(3)}m</span></div></div>}
              </div>
            ))}
          </div>
          {homographyMatrix && birdsEyeView}
        </section>
      )}

      {mode === 'MEASURE' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-right-4">
           {!homographyMatrix ? (
             <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-2xl text-red-400 text-[10px] font-black uppercase text-center leading-relaxed">TRACE Metrology Engine Locked <br/> Run Calibration Tab First</div>
           ) : (
            <>
              <button onClick={onCalculate} disabled={!canCalculate} className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-[12px] shadow-2xl transition-all active:scale-95 disabled:opacity-40">Compute Corrected Distance</button>
              
              <div className="space-y-3 max-h-[500px] overflow-y-auto no-scrollbar pr-1">
                 <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Forensic Measurements ({measurementArchive.length})</h3>
                 {measurementArchive.map((m, idx) => (
                   <details key={m.id} className="bg-slate-950 border border-slate-800 rounded-xl group overflow-hidden shadow-lg transition-all" open>
                     <summary className="p-3 cursor-pointer hover:bg-slate-900 flex justify-between items-center transition-all">
                        <div className="flex items-center gap-3">
                           <span className="text-[10px] font-mono" style={{ color: m.color || '#3b82f6' }}>#{idx+1}</span>
                           <span className="text-[11px] font-black uppercase text-slate-200 truncate max-w-[150px]">{m.name || `Line ${idx+1}`}</span>
                        </div>
                        <span className="text-[11px] font-mono font-black text-white">{m.correctedDist.toFixed(2)}m</span>
                     </summary>
                     <div className="p-4 bg-slate-900/50 space-y-4 border-t border-slate-800">
                        {/* v1.9.8 Visualization Controls */}
                        <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-3">
                           <label className="flex items-center gap-2 cursor-pointer group">
                             <input 
                                type="checkbox" 
                                checked={m.visible !== false} 
                                onChange={(e) => handleUpdateArchiveEntry(m.id, { visible: e.target.checked })}
                                className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                             />
                             <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-200 transition-colors">👁️ Show on Image</span>
                           </label>
                           <div className="flex items-center gap-2">
                             <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Color:</span>
                             <input 
                                type="color" 
                                value={m.color || '#3b82f6'} 
                                onChange={(e) => handleUpdateArchiveEntry(m.id, { color: e.target.value })}
                                className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
                             />
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                           <div className="space-y-1">
                              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Rename</span>
                              <input 
                                type="text" 
                                value={m.name} 
                                onChange={(e) => handleUpdateArchiveEntry(m.id, { name: e.target.value })} 
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-blue-400 outline-none focus:border-blue-500"
                              />
                           </div>
                           <div className="flex items-end">
                              <button onClick={() => setMeasurementArchive(prev => prev.filter(item => item.id !== m.id))} className="w-full py-1.5 bg-red-950/30 text-red-500 rounded text-[9px] font-black uppercase border border-red-900/30 hover:bg-red-900/50 transition-all">Delete</button>
                           </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                           <div className="space-y-1">
                              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">P1 (U, V)</span>
                              <div className="flex gap-1">
                                <input 
                                  type="number" step="1" 
                                  value={Math.round(m.pointA.x)} 
                                  onChange={(e) => handleUpdateArchiveEntry(m.id, { pointA: { ...m.pointA, x: parseInt(e.target.value) } })} 
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-emerald-400 font-mono outline-none focus:border-emerald-500"
                                />
                                <input 
                                  type="number" step="1" 
                                  value={Math.round(m.pointA.y)} 
                                  onChange={(e) => handleUpdateArchiveEntry(m.id, { pointA: { ...m.pointA, y: parseInt(e.target.value) } })} 
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-emerald-400 font-mono outline-none focus:border-emerald-500"
                                />
                              </div>
                           </div>
                           <div className="space-y-1">
                              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">P2 (U, V)</span>
                              <div className="flex gap-1">
                                <input 
                                  type="number" step="1" 
                                  value={Math.round(m.pointB.x)} 
                                  onChange={(e) => handleUpdateArchiveEntry(m.id, { pointB: { ...m.pointB, x: parseInt(e.target.value) } })} 
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-orange-400 font-mono outline-none focus:border-orange-500"
                                />
                                <input 
                                  type="number" step="1" 
                                  value={Math.round(m.pointB.y)} 
                                  onChange={(e) => handleUpdateArchiveEntry(m.id, { pointB: { ...m.pointB, y: parseInt(e.target.value) } })} 
                                  className="w-full bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-orange-400 font-mono outline-none focus:border-orange-500"
                                />
                              </div>
                           </div>
                        </div>
                        
                        <div style={{ fontSize: '150%', lineHeight: '1.5' }} className="pt-2 border-t border-slate-800 space-y-1">
                            <div className="flex justify-between items-center">
                                <strong className="text-slate-500 font-black uppercase text-[0.6em] tracking-tighter">Length:</strong>
                                <span className="text-white font-mono font-black">{m.correctedDist.toFixed(2)} m</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <strong className="text-slate-500 font-black uppercase text-[0.6em] tracking-tighter">Standard Deviation:</strong>
                                <span className="text-orange-400 font-mono font-black">{m.uncertainty.toFixed(2)} m</span>
                            </div>
                            <hr className="border-slate-800 my-3" />
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <strong className="text-blue-400 font-black uppercase text-[0.55em] tracking-tighter">90% CI:</strong>
                                    <span className="text-blue-300 font-mono text-[0.8em]">{m.intervals.ci90.toFixed(2)}</span>
                                </div>
                                <div className="text-right text-slate-400 font-mono text-[0.65em] opacity-80 leading-none">
                                    [{(m.correctedDist - m.intervals.ci90).toFixed(2)}, {(m.correctedDist + m.intervals.ci90).toFixed(2)}]
                                </div>
                                
                                <div className="flex justify-between items-center">
                                    <strong className="text-blue-400 font-black uppercase text-[0.55em] tracking-tighter">95% CI:</strong>
                                    <span className="text-blue-300 font-mono text-[0.8em] font-bold">{m.intervals.ci95.toFixed(2)}</span>
                                </div>
                                <div className="text-right text-slate-400 font-mono text-[0.65em] opacity-80 leading-none">
                                    [{(m.correctedDist - m.intervals.ci95).toFixed(2)}, {(m.correctedDist + m.intervals.ci95).toFixed(2)}]
                                </div>

                                <div className="flex justify-between items-center">
                                    <strong className="text-blue-400 font-black uppercase text-[0.55em] tracking-tighter">99% CI:</strong>
                                    <span className="text-blue-300 font-mono text-[0.8em]">{m.intervals.ci99.toFixed(2)}</span>
                                </div>
                                <div className="text-right text-slate-400 font-mono text-[0.65em] opacity-80 leading-none">
                                    [{(m.correctedDist - m.intervals.ci99).toFixed(2)}, {(m.correctedDist + m.intervals.ci99).toFixed(2)}]
                                </div>
                            </div>
                        </div>
                     </div>
                   </details>
                 ))}
              </div>

              {calcResult && (
                <div className="space-y-4 pt-4 border-t border-slate-800">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-2 shadow-2xl text-center">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest block mb-1">Active Result: {measurementArchive[measurementArchive.length-1]?.name}</span>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-5xl font-black font-mono text-white tracking-tighter">{calcResult.dist.toFixed(2)}</span>
                      <span className="text-xl font-black text-slate-400">m</span>
                    </div>
                  </div>
                  <button onClick={onDownloadReport} className="w-full py-3 bg-slate-100 hover:bg-white text-slate-900 rounded-xl font-black uppercase text-[11px] shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95">📄 Export TRACE Audit (DOCX)</button>
                </div>
              )}
              {homographyMatrix && birdsEyeView}
            </>
           )}
        </section>
      )}
    </div>
  );
};

export default Sidebar;