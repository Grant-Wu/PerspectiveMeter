import React, { useRef, useState, useMemo, useCallback } from 'react';
import { Point, AppMode, InteractionMode, CalibrationData, MeasurementPair, ValidationLine, MeasurementArchiveEntry } from '../types';

interface CanvasAreaProps {
  image: string | null;
  mode: AppMode;
  interactionMode: InteractionMode;
  zoom: number;
  calibration: CalibrationData;
  setCalibration: React.Dispatch<React.SetStateAction<CalibrationData>>;
  setClickHistory: React.Dispatch<React.SetStateAction<{lineId: string, pointType: 'start' | 'end'}[]>>;
  validationLines: ValidationLine[];
  setValidationLines: React.Dispatch<React.SetStateAction<ValidationLine[]>>;
  setValClickHistory: React.Dispatch<React.SetStateAction<{lineId: string, pointType: 'start' | 'end'}[]>>;
  measurements: MeasurementPair;
  setMeasurements: React.Dispatch<React.SetStateAction<MeasurementPair>>;
  selectedLine: { lineId: string; pointType: 'start' | 'end' } | null;
  setSelectedLine: (sel: { lineId: string; pointType: 'start' | 'end' } | null) => void;
  measurementArchive: MeasurementArchiveEntry[];
}

const CanvasArea: React.FC<CanvasAreaProps> = ({
  image,
  mode,
  interactionMode,
  zoom,
  calibration,
  setCalibration,
  setClickHistory,
  validationLines,
  setValidationLines,
  setValClickHistory,
  measurements,
  setMeasurements,
  selectedLine,
  setSelectedLine,
  measurementArchive,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<{ type: 'CALIBRATE' | 'VALIDATE' | 'MEASURE'; id: string; pointType: 'start' | 'end' | 'pointA' | 'pointB' } | null>(null);

  const LOUPE_SIZE = 300; 
  const LOUPE_ZOOM = 18;  

  /**
   * Determine Anchor Line index (longest line) for dynamic coloring.
   */
  const anchorIdx = useMemo(() => {
    let max = -1, idx = -1;
    calibration.lines.forEach((l, i) => { 
      if (l.defined && l.trueLength > max) { 
        max = l.trueLength; 
        idx = i; 
      } 
    });
    return idx;
  }, [calibration.lines]);

  /**
   * Display Client Coord -> Natural Image Pixel Coord
   */
  const getImageCoords = useCallback((clientX: number, clientY: number) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) * (imageRef.current.naturalWidth / rect.width);
    const y = (clientY - rect.top) * (imageRef.current.naturalHeight / rect.height);
    return { x, y };
  }, []);

  /**
   * Natural Image Pixel Coord -> Display UI projection Coord
   */
  const getCanvasCoords = useCallback((pt: Point) => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    return {
      x: (pt.x / imageRef.current.naturalWidth) * rect.width,
      y: (pt.y / imageRef.current.naturalHeight) * rect.height,
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    setCursorPos(coords);

    if (dragging) {
      if (dragging.type === 'CALIBRATE') {
        setCalibration(prev => ({
          ...prev,
          lines: prev.lines.map(l => l.id === dragging.id ? { ...l, [dragging.pointType]: coords } : l)
        }));
      } else if (dragging.type === 'VALIDATE') {
        setValidationLines(prev => prev.map(l => l.id === dragging.id ? { ...l, [dragging.pointType]: coords } : l));
      } else {
        setMeasurements(prev => ({
          ...prev,
          [dragging.pointType]: coords
        }));
      }
    }
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (!imageRef.current || dragging || interactionMode === 'EDIT') return;

    const coords = getImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    const clickPoint: Point = { ...coords, defined: true };

    if (mode === 'CALIBRATE') {
      setCalibration(prev => {
        const lastLine = prev.lines[prev.lines.length - 1];
        if (lastLine && !lastLine.defined) {
          setClickHistory(hist => [...hist, { lineId: lastLine.id, pointType: 'end' }]);
          return {
            ...prev,
            lines: prev.lines.map(l => l.id === lastLine.id ? { ...l, end: clickPoint, defined: true } : l)
          };
        } else {
          const newId = Math.random().toString(36).substr(2, 9);
          setClickHistory(hist => [...hist, { lineId: newId, pointType: 'start' }]);
          return {
            ...prev,
            lines: [...prev.lines, { id: newId, start: clickPoint, end: clickPoint, trueLength: 1.0, angle: 0, defined: false }]
          };
        }
      });
    } else if (mode === 'VALIDATE') {
      setValidationLines(prev => {
        const lastLine = prev[prev.length - 1];
        if (lastLine && !lastLine.defined) {
          setValClickHistory(hist => [...hist, { lineId: lastLine.id, pointType: 'end' }]);
          return prev.map(l => l.id === lastLine.id ? { ...l, end: clickPoint, defined: true } : l);
        } else {
          const newId = Math.random().toString(36).substr(2, 9);
          setValClickHistory(hist => [...hist, { lineId: newId, pointType: 'start' }]);
          return [...prev, { id: newId, start: clickPoint, end: clickPoint, trueLength: 1.0, defined: false }];
        }
      });
    } else {
      // v2.0.0+: Explicitly allows clicks on the same pixel (Zero-Length lines)
      setMeasurements(prev => {
        if (!prev.pointA) return { ...prev, pointA: clickPoint };
        if (!prev.pointB) return { ...prev, pointB: clickPoint };
        return { pointA: clickPoint, pointB: null };
      });
    }
  };

  const loupeStyle = useMemo(() => {
    if (!cursorPos || !imageRef.current || !containerRef.current) return { display: 'none' };
    const canvasPos = getCanvasCoords(cursorPos);
    const imgRect = imageRef.current.getBoundingClientRect();
    const viewX = imgRect.left + canvasPos.x;
    const viewY = imgRect.top + canvasPos.y;

    let left = viewX + 50;
    let top = viewY - (LOUPE_SIZE + 50);
    if (left + LOUPE_SIZE > window.innerWidth) left = viewX - (LOUPE_SIZE + 50);
    if (top < 0) top = viewY + 50;

    const bgX = -cursorPos.x * LOUPE_ZOOM + LOUPE_SIZE / 2;
    const bgY = -cursorPos.y * LOUPE_ZOOM + LOUPE_SIZE / 2;

    return {
      left: `${left}px`, 
      top: `${top}px`, 
      display: dragging || interactionMode === 'EDIT' || cursorPos ? 'block' : 'none',
      width: `${LOUPE_SIZE}px`,
      height: `${LOUPE_SIZE}px`,
      backgroundImage: `url(${image})`, 
      backgroundPosition: `${bgX}px ${bgY}px`, 
      backgroundSize: `${imageRef.current.naturalWidth * LOUPE_ZOOM}px ${imageRef.current.naturalHeight * LOUPE_ZOOM}px`,
      backgroundRepeat: 'no-repeat', 
      imageRendering: 'pixelated' as any,
      position: 'fixed' as any,
      zIndex: 1000,
      cursor: dragging ? 'grabbing' : (interactionMode === 'EDIT' ? 'default' : 'crosshair'),
      boxShadow: '0 0 0 10px rgba(59, 130, 246, 0.4), 0 50px 100px -20px rgba(0,0,0,0.9)',
      borderRadius: '50%'
    };
  }, [cursorPos, image, dragging, getCanvasCoords, interactionMode]);

  return (
    <div 
      ref={containerRef}
      className={`flex-1 h-full bg-slate-950 flex flex-col items-center justify-center relative overflow-auto p-12 select-none no-scrollbar`}
      onMouseMove={handleMouseMove} 
      onMouseUp={() => setDragging(null)} 
      onMouseLeave={() => { setCursorPos(null); setDragging(null); }}
    >
      {!image ? (
        <div className="flex flex-col items-center gap-6 text-slate-500 font-medium opacity-40">
          <div className="w-24 h-24 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center animate-pulse rotate-3">
             <svg className="w-10 h-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.5em] text-center">Reference Source Not Linked</p>
        </div>
      ) : (
        <div 
          className="relative inline-block"
          style={{ 
            width: `calc(min(100%, 85vw) * ${zoom})`,
            transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <img 
            ref={imageRef} src={image} alt="Workspace" draggable={false} 
            className={`w-full rounded border border-slate-800 shadow-2xl block transition-all ${interactionMode === 'PLACE' ? 'cursor-crosshair' : 'cursor-default'}`}
            onClick={handleImageClick} 
          />
          
          <svg className="absolute inset-0 pointer-events-none w-full h-full overflow-visible">
            {/* LAYER 1: Calibration Objects */}
            {mode === 'CALIBRATE' && calibration.lines.map((l, i) => {
              const startCanvas = getCanvasCoords(l.start);
              const endCanvas = getCanvasCoords(l.end);
              const isAnchor = i === anchorIdx;
              const strokeColor = isAnchor ? "#d946ef" : "#10b981";
              
              return (
                <g 
                  key={l.id} 
                  className={interactionMode === 'EDIT' ? 'pointer-events-auto' : 'pointer-events-none'}
                >
                  <line 
                    x1={startCanvas.x} y1={startCanvas.y} 
                    x2={endCanvas.x} y2={endCanvas.y} 
                    stroke={strokeColor} strokeWidth="3" 
                    strokeDasharray={l.defined ? "" : "6 4"} opacity={l.defined ? "1" : "0.5"}
                  />
                  <text 
                    x={startCanvas.x} y={startCanvas.y} 
                    fill={strokeColor} fontSize="12" fontWeight="black" 
                    stroke="black" strokeWidth="0.5" 
                    dx="-12" dy="-5"
                  >
                    {i + 1}{isAnchor && '⚓'}
                  </text>
                  {['start', 'end'].map(type => {
                    const pt = l[type as 'start' | 'end'];
                    const ptCanvas = getCanvasCoords(pt);
                    return (
                      <g key={type} className={interactionMode === 'EDIT' ? 'cursor-grab active:cursor-grabbing' : ''}>
                         <circle 
                          cx={ptCanvas.x} cy={ptCanvas.y} r="14" fill="transparent"
                          onMouseDown={(e) => {
                            if (interactionMode !== 'EDIT') return;
                            e.stopPropagation();
                            setDragging({ type: 'CALIBRATE', id: l.id, pointType: type as 'start' | 'end' });
                            setSelectedLine({ lineId: l.id, pointType: type as 'start' | 'end' });
                          }}
                        />
                        <circle 
                          cx={ptCanvas.x} cy={ptCanvas.y} 
                          r={selectedLine?.lineId === l.id && selectedLine?.pointType === type ? "7" : "5"} 
                          fill={strokeColor} stroke="white" strokeWidth="2" 
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* LAYER 2: Validation Objects */}
            {mode === 'VALIDATE' && validationLines.map((vl, i) => {
              const startCanvas = getCanvasCoords(vl.start);
              const endCanvas = getCanvasCoords(vl.end);
              return (
                <g 
                  key={vl.id} 
                  className={interactionMode === 'EDIT' ? 'pointer-events-auto' : 'pointer-events-none'}
                >
                  <line 
                    x1={startCanvas.x} y1={startCanvas.y} 
                    x2={endCanvas.x} y2={endCanvas.y} 
                    stroke="#f59e0b" strokeWidth="2.5" 
                    strokeDasharray={vl.defined ? "" : "6 4"} opacity={vl.defined ? "1" : "0.5"}
                  />
                  <text 
                    x={startCanvas.x} y={startCanvas.y} 
                    fill="#f59e0b" fontSize="12" fontWeight="black" 
                    stroke="black" strokeWidth="0.5" 
                    dx="-12" dy="-5"
                  >
                    V{i + 1}
                  </text>
                  {['start', 'end'].map(type => {
                    const pt = vl[type as 'start' | 'end'];
                    const ptCanvas = getCanvasCoords(pt);
                    return (
                      <g key={type} className={interactionMode === 'EDIT' ? 'cursor-grab active:cursor-grabbing' : ''}>
                        <circle 
                          cx={ptCanvas.x} cy={ptCanvas.y} r="14" fill="transparent"
                          onMouseDown={(e) => {
                            if (interactionMode !== 'EDIT') return;
                            e.stopPropagation();
                            setDragging({ type: 'VALIDATE', id: vl.id, pointType: type as 'start' | 'end' });
                          }}
                        />
                        <circle 
                          cx={ptCanvas.x} cy={ptCanvas.y} 
                          r="4.5" 
                          fill="#f59e0b" stroke="white" strokeWidth="2" 
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* v2.0.1: LAYER 3: Archived Measurements (Explicit Radius 2px) */}
            {/* Explicitly 'pointer-events-none' to prevent blocking mouse interactions in PLACE mode */}
            {mode === 'MEASURE' && measurementArchive.map((m, idx) => {
              if (m.visible === false) return null;
              
              const pACanvas = getCanvasCoords(m.pointA);
              const pBCanvas = getCanvasCoords(m.pointB);
              const arcColor = m.color || "#22d3ee";
              
              return (
                <g key={m.id} className="pointer-events-none">
                  <line x1={pACanvas.x} y1={pACanvas.y} x2={pBCanvas.x} y2={pBCanvas.y} stroke={arcColor} strokeWidth="2" opacity="0.8" />
                  <circle cx={pACanvas.x} cy={pACanvas.y} r="2" fill={arcColor} stroke="white" strokeWidth="0.5" />
                  <circle cx={pBCanvas.x} cy={pBCanvas.y} r="2" fill={arcColor} stroke="white" strokeWidth="0.5" />
                  <text 
                    x={pACanvas.x} y={pACanvas.y} 
                    fill={arcColor} fontSize="10" fontWeight="black" 
                    stroke="black" strokeWidth="0.5" 
                    dx="-10" dy="-5"
                  >
                    M{idx + 1}
                  </text>
                </g>
              );
            })}

            {/* v2.0.1: LAYER 4: Active Metrology Tool */}
            {/* Fix "Blocking" issue: use strictly pointer-events-none unless in EDIT interaction mode */}
            {(mode === 'MEASURE' || (mode === 'VALIDATE' && interactionMode === 'PLACE')) && (
              <>
                {measurements.pointA && (
                  <g className={interactionMode === 'EDIT' ? 'pointer-events-auto cursor-grab' : 'pointer-events-none'}>
                    <circle cx={getCanvasCoords(measurements.pointA).x} cy={getCanvasCoords(measurements.pointA).y} r="14" fill="transparent" 
                      onMouseDown={(e) => { if (interactionMode === 'EDIT') setDragging({ type: 'MEASURE', id: 'm', pointType: 'pointA' }); }}
                    />
                    <circle cx={getCanvasCoords(measurements.pointA).x} cy={getCanvasCoords(measurements.pointA).y} r="2" fill="#10b981" stroke="white" strokeWidth="1.0" />
                  </g>
                )}
                {measurements.pointB && (
                  <g className={interactionMode === 'EDIT' ? 'pointer-events-auto cursor-grab' : 'pointer-events-none'}>
                    <circle cx={getCanvasCoords(measurements.pointB).x} cy={getCanvasCoords(measurements.pointB).y} r="14" fill="transparent"
                      onMouseDown={(e) => { if (interactionMode === 'EDIT') setDragging({ type: 'MEASURE', id: 'm', pointType: 'pointB' }); }}
                    />
                    <circle cx={getCanvasCoords(measurements.pointB).x} cy={getCanvasCoords(measurements.pointB).y} r="2" fill="#f97316" stroke="white" strokeWidth="1.0" />
                  </g>
                )}
                {measurements.pointA && measurements.pointB && (
                  <>
                    <line 
                      x1={getCanvasCoords(measurements.pointA).x} y1={getCanvasCoords(measurements.pointA).y} 
                      x2={getCanvasCoords(measurements.pointB).x} y2={getCanvasCoords(measurements.pointB).y} 
                      stroke="#3b82f6" strokeWidth="3" strokeDasharray="10 5" className="pointer-events-none"
                    />
                    <text 
                      x={getCanvasCoords(measurements.pointA).x} y={getCanvasCoords(measurements.pointA).y} 
                      fill="#3b82f6" fontSize="12" fontWeight="black" 
                      stroke="black" strokeWidth="0.5" 
                      dx="-12" dy="-5"
                    >
                      M_ACTIVE
                    </text>
                  </>
                )}
              </>
            )}
          </svg>

          {/* Forensic Loupe Magnification */}
          <div className="pointer-events-none rounded-full overflow-hidden bg-black border-2 border-slate-700/50" style={loupeStyle}>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[1.5px] h-full bg-red-500/50"></div>
              <div className="h-[1.5px] w-full bg-red-500/50 absolute"></div>
            </div>
            {cursorPos && (
              <div className="absolute bottom-4 left-0 w-full text-center text-[9px] font-mono font-black text-white bg-black/80 py-1.5 uppercase tracking-widest border-t border-slate-800">
                U:{cursorPos.x.toFixed(0)} V:{cursorPos.y.toFixed(0)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CanvasArea;