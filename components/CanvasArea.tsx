
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Point, AppMode, CalibrationData, MeasurementPair } from '../types';
import { invertMatrix3x3, applyHomography, computeHomography, undistortPoint } from '../utils/math';

interface CanvasAreaProps {
  image: string | null;
  mode: AppMode;
  zoom: number;
  calibration: CalibrationData;
  setCalibration: React.Dispatch<React.SetStateAction<CalibrationData>>;
  setClickHistory: React.Dispatch<React.SetStateAction<{targetId: string, pointIdx: number}[]>>;
  measurements: MeasurementPair;
  setMeasurements: React.Dispatch<React.SetStateAction<MeasurementPair>>;
}

const CanvasArea: React.FC<CanvasAreaProps> = ({
  image,
  mode,
  zoom,
  calibration,
  setCalibration,
  setClickHistory,
  measurements,
  setMeasurements,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<{ targetId: string; pointIdx: number } | null>(null);
  const [selected, setSelected] = useState<{ targetId: string; pointIdx: number } | null>(null);

  const LOUPE_SIZE = 200;
  const LOUPE_ZOOM = 10;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selected === null || mode !== 'CALIBRATE') return;
      const step = e.shiftKey ? 1 : 0.1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        setCalibration(prev => ({
          ...prev,
          targets: prev.targets.map(t => t.id === selected.targetId ? {
            ...t,
            points: t.points.map((p, i) => i === selected.pointIdx ? { ...p, x: p.x + dx, y: p.y + dy, defined: true } : p)
          } : t)
        }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, mode, setCalibration]);

  const getImageCoords = (clientX: number, clientY: number) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) * (imageRef.current.naturalWidth / rect.width);
    const y = (clientY - rect.top) * (imageRef.current.naturalHeight / rect.height);
    return { x, y };
  };

  const getCanvasCoords = (pt: Point) => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    return {
      x: (pt.x / imageRef.current.naturalWidth) * rect.width,
      y: (pt.y / imageRef.current.naturalHeight) * rect.height,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    setCursorPos(coords);

    if (dragging && mode === 'CALIBRATE') {
      setCalibration(prev => ({
        ...prev,
        targets: prev.targets.map(t => t.id === dragging.targetId ? {
          ...t,
          points: t.points.map((p, i) => i === dragging.pointIdx ? { ...coords, defined: true } : p)
        } : t)
      }));
    }
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (!imageRef.current || dragging) return;
    const coords = getImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    const clickPoint: Point = { ...coords, defined: true };

    if (mode === 'CALIBRATE') {
      let found = false;
      calibration.targets.forEach(t => {
        t.points.forEach((p, i) => {
          if (!p.defined) return;
          const c = getCanvasCoords(p);
          const imgRect = imageRef.current!.getBoundingClientRect();
          const dist = Math.sqrt(Math.pow(e.clientX - (imgRect.left + c.x), 2) + Math.pow(e.clientY - (imgRect.top + c.y), 2));
          if (dist < 20) { setSelected({ targetId: t.id, pointIdx: i }); found = true; }
        });
      });
      if (found) return;

      setCalibration(prev => {
        let placed = false;
        const nextTargets = prev.targets.map(t => {
          if (placed) return t;
          const idx = t.points.findIndex(p => !p.defined);
          if (idx !== -1) {
            placed = true;
            setSelected({ targetId: t.id, pointIdx: idx });
            setClickHistory(hist => [...hist, { targetId: t.id, pointIdx: idx }]);
            return { ...t, points: t.points.map((p, i) => i === idx ? clickPoint : p) };
          }
          return t;
        });
        return { ...prev, targets: nextTargets };
      });
    } else {
      setMeasurements(prev => {
        if (!prev.pointA) return { ...prev, pointA: clickPoint };
        if (!prev.pointB) return { ...prev, pointB: clickPoint };
        return { pointA: clickPoint, pointB: null };
      });
    }
  };

  const loupeStyle = useMemo(() => {
    if (!cursorPos || !imageRef.current || !containerRef.current) return { display: 'none' };
    
    // Position loupe relative to the viewport/container
    const containerRect = containerRef.current.getBoundingClientRect();
    const canvasPos = getCanvasCoords(cursorPos);
    const imgRect = imageRef.current.getBoundingClientRect();
    
    // Relative to viewport
    const viewX = imgRect.left + canvasPos.x;
    const viewY = imgRect.top + canvasPos.y;

    let left = viewX + 40;
    let top = viewY - (LOUPE_SIZE + 40);

    // Guard viewport boundaries
    if (left + LOUPE_SIZE > window.innerWidth) left = viewX - (LOUPE_SIZE + 40);
    if (top < 0) top = viewY + 40;

    const bgX = -cursorPos.x * LOUPE_ZOOM + LOUPE_SIZE / 2;
    const bgY = -cursorPos.y * LOUPE_ZOOM + LOUPE_SIZE / 2;
    const bgW = imageRef.current.naturalWidth * LOUPE_ZOOM;
    const bgH = imageRef.current.naturalHeight * LOUPE_ZOOM;

    return {
      left: `${left}px`, 
      top: `${top}px`, 
      display: 'block',
      width: `${LOUPE_SIZE}px`,
      height: `${LOUPE_SIZE}px`,
      backgroundImage: `url(${image})`, 
      backgroundPosition: `${bgX}px ${bgY}px`, 
      backgroundSize: `${bgW}px ${bgH}px`,
      backgroundRepeat: 'no-repeat', 
      imageRendering: 'pixelated' as any,
      position: 'fixed' as any,
      zIndex: 1000
    };
  }, [cursorPos, image, zoom]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 h-full bg-slate-950 flex flex-col items-center justify-center relative overflow-auto p-12"
      onMouseMove={handleMouseMove} 
      onMouseUp={() => setDragging(null)} 
      onMouseLeave={() => { setCursorPos(null); setDragging(null); }}
    >
      {!image ? (
        <div className="flex flex-col items-center gap-4 text-slate-500 font-medium">
          <div className="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center animate-pulse border border-slate-800 shadow-xl">
            <svg className="w-10 h-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <p className="text-sm font-black uppercase tracking-[0.2em] opacity-40">Import Source Image to Start</p>
        </div>
      ) : (
        <div 
          className="relative inline-block transition-transform duration-200 ease-out"
          style={{ 
            width: `calc(min(100%, 80vw) * ${zoom})`,
            minWidth: imageRef.current ? `${imageRef.current.naturalWidth * 0.1}px` : 'auto'
          }}
        >
          <img 
            ref={imageRef} 
            src={image} 
            alt="Source" 
            className="w-full rounded shadow-2xl border border-slate-800 cursor-crosshair select-none block"
            onClick={handleImageClick} 
            draggable={false} 
          />
          
          <svg className="absolute inset-0 pointer-events-none w-full h-full overflow-visible">
            {calibration.targets.map((t, tIdx) => (
              <React.Fragment key={t.id}>
                <polyline points={t.points.filter(p => p.defined).map(p => { const c = getCanvasCoords(p); return `${c.x},${c.y}`; }).join(' ')}
                  fill={tIdx === 0 ? "rgba(59, 130, 246, 0.05)" : "rgba(168, 85, 247, 0.05)"} stroke={tIdx === 0 ? "#3b82f6" : "#a855f7"} strokeWidth="1.5" strokeDasharray="6 3" />
                {t.points.map((pt, i) => pt.defined && (
                  <g key={i} className="pointer-events-auto cursor-move">
                    <circle cx={getCanvasCoords(pt).x} cy={getCanvasCoords(pt).y} r="18" fill="transparent"
                      onMouseDown={(e) => { e.stopPropagation(); setDragging({ targetId: t.id, pointIdx: i }); setSelected({ targetId: t.id, pointIdx: i }); }} />
                    <circle cx={getCanvasCoords(pt).x} cy={getCanvasCoords(pt).y} r={selected?.targetId === t.id && selected?.pointIdx === i ? "9" : "6"} 
                      fill={tIdx === 0 ? "#3b82f6" : "#a855f7"} stroke="white" strokeWidth="2" className="transition-all" />
                    <text x={getCanvasCoords(pt).x + 12} y={getCanvasCoords(pt).y - 12} fill="white" fontSize="10" className="font-black drop-shadow-[0_2px_4px_rgba(0,0,0,1)] uppercase">
                      {tIdx === 0 ? 'R1' : 'R2'}.{i+1}
                    </text>
                  </g>
                ))}
              </React.Fragment>
            ))}
            {mode === 'MEASURE' && (
              <>
                {measurements.pointA && <circle cx={getCanvasCoords(measurements.pointA).x} cy={getCanvasCoords(measurements.pointA).y} r="7" fill="#10b981" stroke="white" strokeWidth="2" className="shadow-lg" />}
                {measurements.pointB && <circle cx={getCanvasCoords(measurements.pointB).x} cy={getCanvasCoords(measurements.pointB).y} r="7" fill="#f97316" stroke="white" strokeWidth="2" className="shadow-lg" />}
                {measurements.pointA && measurements.pointB && (
                  <line x1={getCanvasCoords(measurements.pointA).x} y1={getCanvasCoords(measurements.pointA).y} x2={getCanvasCoords(measurements.pointB).x} y2={getCanvasCoords(measurements.pointB).y} stroke="#3b82f6" strokeWidth="3" strokeDasharray="10 5" />
                )}
              </>
            )}
          </svg>

          {/* Floating Loupe */}
          <div 
            className="pointer-events-none rounded-full border-4 border-blue-500 shadow-2xl overflow-hidden bg-black" 
            style={loupeStyle}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-70">
              <div className="w-[1px] h-full bg-red-500"></div>
              <div className="h-[1px] w-full bg-red-500 absolute"></div>
              <div className="w-10 h-10 border border-red-500/20 rounded-full absolute"></div>
            </div>
            {cursorPos && (
              <div className="absolute bottom-2 left-0 w-full text-center text-[9px] font-mono font-black text-white bg-black/60 py-1 tracking-widest">
                {Math.floor(cursorPos.x)}, {Math.floor(cursorPos.y)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasArea;
