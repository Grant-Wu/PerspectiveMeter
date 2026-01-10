
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { CalibrationData, AppMode, MeasurementPair, Point, CalibrationTarget } from './types';
import Sidebar from './components/Sidebar';
import CanvasArea from './components/CanvasArea';
import { computeHomography, applyHomography, euclideanDistance, undistortPoint } from './utils/math';

const App: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<AppMode>('CALIBRATE');
  const [zoom, setZoom] = useState(1);
  const [clickHistory, setClickHistory] = useState<{targetId: string, pointIdx: number}[]>([]);
  
  const initialTarget = (id: string): CalibrationTarget => ({
    id,
    points: Array(4).fill(null).map(() => ({ x: 0, y: 0, defined: false })),
    width: 0.2,
    height: 0.2,
  });

  const [calibration, setCalibration] = useState<CalibrationData>({
    targets: [initialTarget('1'), initialTarget('2')],
    lensK1: 0,
  });
  
  const [measurements, setMeasurements] = useState<MeasurementPair>({
    pointA: null,
    pointB: null,
  });
  const [resultDistance, setResultDistance] = useState<number | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
          setImage(url);
          setZoom(1);
          clearCalibration();
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    }
  };

  const homographyMatrix = useMemo(() => {
    if (!imgDims.w) return null;
    
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);

    // Use the first target that is fully defined
    const activeTarget = calibration.targets.find(t => t.points.every(p => p.defined));
    if (!activeTarget) return null;

    const undistortedSrc = activeTarget.points.map(p => 
      undistortPoint(p, calibration.lensK1, center, diag)
    );

    const worldPoints = [
      { x: 0, y: 0 },
      { x: activeTarget.width, y: 0 },
      { x: activeTarget.width, y: activeTarget.height },
      { x: 0, y: activeTarget.height },
    ];

    return computeHomography(undistortedSrc, worldPoints);
  }, [calibration, imgDims]);

  const undoLastPoint = useCallback(() => {
    if (mode === 'CALIBRATE') {
      if (clickHistory.length === 0) return;
      const last = clickHistory[clickHistory.length - 1];
      setCalibration(prev => ({
        ...prev,
        targets: prev.targets.map(t => t.id === last.targetId ? {
          ...t,
          points: t.points.map((p, i) => i === last.pointIdx ? { x: 0, y: 0, defined: false } : p)
        } : t)
      }));
      setClickHistory(prev => prev.slice(0, -1));
    } else {
      setMeasurements(prev => {
        if (prev.pointB) return { ...prev, pointB: null };
        if (prev.pointA) return { ...prev, pointA: null };
        return prev;
      });
    }
    setResultDistance(null);
  }, [clickHistory, mode]);

  const calculateDistance = useCallback(() => {
    if (!homographyMatrix || !measurements.pointA || !measurements.pointB || !imgDims.w) return;
    const center = { x: imgDims.w / 2, y: imgDims.h / 2 };
    const diag = Math.sqrt(imgDims.w * imgDims.w + imgDims.h * imgDims.h);
    
    const uA = undistortPoint(measurements.pointA, calibration.lensK1, center, diag);
    const uB = undistortPoint(measurements.pointB, calibration.lensK1, center, diag);
    
    const realA = applyHomography(uA, homographyMatrix);
    const realB = applyHomography(uB, homographyMatrix);
    setResultDistance(euclideanDistance(realA, realB));
  }, [homographyMatrix, measurements, calibration.lensK1, imgDims]);

  const clearCalibration = useCallback(() => {
    setCalibration(prev => ({
      ...prev,
      targets: prev.targets.map(t => ({
        ...t,
        points: t.points.map(() => ({ x: 0, y: 0, defined: false }))
      }))
    }));
    setClickHistory([]);
    setMeasurements({ pointA: null, pointB: null });
    setResultDistance(null);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-slate-950 overflow-hidden font-sans select-none text-slate-200">
      <Sidebar
        mode={mode}
        setMode={setMode}
        zoom={zoom}
        setZoom={setZoom}
        calibration={calibration}
        setCalibration={setCalibration}
        measurements={measurements}
        distance={resultDistance}
        onCalculate={calculateDistance}
        onUndo={undoLastPoint}
        onClearCalibration={clearCalibration}
        canCalculate={!!(homographyMatrix && measurements.pointA && measurements.pointB)}
        canUndo={mode === 'CALIBRATE' ? clickHistory.length > 0 : !!(measurements.pointA || measurements.pointB)}
      />

      <main className="flex-1 flex flex-col relative">
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-8 z-10 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <label className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black uppercase tracking-widest py-2.5 px-6 rounded-lg cursor-pointer transition-all shadow-lg active:scale-95">
              <span>Import Image</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
            </label>
            {image && <div className="text-[10px] text-slate-500 font-mono bg-slate-950/80 px-3 py-1.5 rounded-md border border-slate-800">DATA: {imgDims.w}x{imgDims.h}px</div>}
          </div>
          <div className="flex items-center gap-2">
             <div className="text-right">
                <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Perspective Solver</div>
                <div className={`text-[11px] font-bold ${homographyMatrix ? 'text-emerald-400' : 'text-amber-500'}`}>
                  {homographyMatrix ? 'CALIBRATION: ACTIVE' : 'AWAITING RECTANGLE (1-4)'}
                </div>
             </div>
          </div>
        </header>

        <CanvasArea
          image={image}
          mode={mode}
          zoom={zoom}
          calibration={calibration}
          setCalibration={setCalibration}
          setClickHistory={setClickHistory}
          measurements={measurements}
          setMeasurements={setMeasurements}
        />
        
        <footer className="h-12 bg-slate-950 border-t border-slate-800 flex items-center px-8 text-[10px] font-medium tracking-tight gap-8">
          <div className="flex items-center gap-2 text-slate-500 font-mono text-[9px]">
            <div className={`w-1.5 h-1.5 rounded-full ${mode === 'CALIBRATE' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'bg-emerald-500'}`}></div>
            MODE: {mode}
          </div>
          <div className="flex items-center gap-4 text-slate-500 font-mono text-[9px]">
            <span className="opacity-60 uppercase">Zoom Level: {Math.round(zoom * 100)}%</span>
          </div>
          <div className="flex-1 text-center">
            <span className="text-slate-400 font-semibold">© Yuan-Wei, Wu</span>
            <span className="mx-2 text-slate-700">|</span>
            <span className="text-slate-500 italic">Assistant Professor at Central Police University</span>
          </div>
          <div className="ml-auto text-slate-700 font-mono text-[9px] tracking-[0.2em] uppercase">
            Professional Homography Core v2.2
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;
