
import React from 'react';
import { CalibrationData, AppMode, MeasurementPair, CalibrationTarget } from '../types';

interface SidebarProps {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  calibration: CalibrationData;
  setCalibration: React.Dispatch<React.SetStateAction<CalibrationData>>;
  measurements: MeasurementPair;
  distance: number | null;
  onCalculate: () => void;
  onUndo: () => void;
  onClearCalibration: () => void;
  canCalculate: boolean;
  canUndo: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  mode,
  setMode,
  zoom,
  setZoom,
  calibration,
  setCalibration,
  measurements,
  distance,
  onCalculate,
  onUndo,
  onClearCalibration,
  canCalculate,
  canUndo,
}) => {
  const updateTargetSize = (id: string, field: 'width' | 'height', val: string) => {
    const num = parseFloat(val) || 0;
    setCalibration(prev => ({
      ...prev,
      targets: prev.targets.map(t => t.id === id ? { ...t, [field]: num } : t)
    }));
  };

  const handleK1Change = (val: string) => {
    setCalibration(prev => ({ ...prev, lensK1: parseFloat(val) }));
  };

  const handleZoom = (delta: number) => {
    setZoom(prev => Math.min(5, Math.max(0.1, prev + delta)));
  };

  const PointSequenceIcon = () => (
    <div className="grid grid-cols-2 gap-1.5 w-16 h-16 bg-slate-800 p-2 rounded-lg border border-slate-700">
      <div className="bg-blue-600 rounded flex items-center justify-center text-[10px] font-black shadow-sm text-white">1</div>
      <div className="bg-slate-700 rounded flex items-center justify-center text-[10px] font-bold text-slate-400">2</div>
      <div className="bg-slate-700 rounded flex items-center justify-center text-[10px] font-bold text-slate-400">4</div>
      <div className="bg-slate-700 rounded flex items-center justify-center text-[10px] font-bold text-slate-400">3</div>
    </div>
  );

  return (
    <div className="w-80 h-full bg-slate-900 border-r border-slate-700 p-6 overflow-y-auto flex flex-col gap-6 shadow-xl">
      <div>
        <h1 className="text-xl font-bold text-blue-400 mb-1 flex items-center gap-2">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 00-1-1v1a2 2 0 11-4 0v-1a1 1 0 00-1-1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /></svg>
          PerspectiveMeter
        </h1>
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Professional Edition V2.2</p>
      </div>

      <div className="flex p-1 bg-slate-800 rounded-lg">
        <button onClick={() => setMode('CALIBRATE')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === 'CALIBRATE' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>CALIBRATE</button>
        <button onClick={() => setMode('MEASURE')} className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${mode === 'MEASURE' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>MEASURE</button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`py-2.5 rounded-lg border text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${canUndo ? 'bg-slate-800 border-slate-600 hover:bg-slate-700 text-slate-200' : 'bg-slate-900 border-slate-800 text-slate-700 cursor-not-allowed'}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          Undo
        </button>
        <div className="flex bg-slate-800 rounded-lg border border-slate-700 p-0.5">
           <button onClick={() => handleZoom(-0.2)} className="flex-1 hover:bg-slate-700 rounded text-slate-300 font-bold">-</button>
           <button onClick={() => setZoom(1)} className="px-2 text-[10px] font-mono font-bold text-blue-400 border-x border-slate-700">100%</button>
           <button onClick={() => handleZoom(0.2)} className="flex-1 hover:bg-slate-700 rounded text-slate-300 font-bold">+</button>
        </div>
      </div>

      {mode === 'CALIBRATE' ? (
        <div className="space-y-6">
          <section className="bg-slate-800/40 p-4 rounded-xl border border-slate-700">
            <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3">Lens Distortion</h3>
            <div className="flex justify-between text-[9px] text-slate-500 font-bold mb-1">
              <span>BARREL</span>
              <span className="text-blue-500">K1: {calibration.lensK1.toFixed(3)}</span>
              <span>PIN</span>
            </div>
            <input type="range" min="-1.5" max="1.5" step="0.001" value={calibration.lensK1} onChange={(e) => handleK1Change(e.target.value)} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
          </section>

          <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl flex items-center gap-4 shadow-inner">
            <PointSequenceIcon />
            <div className="text-[9px] text-slate-400 font-medium leading-relaxed">
              <p className="font-bold text-blue-400 uppercase mb-1">Mapping Logic:</p>
              <p>P1 → P2 = <span className="text-blue-400 font-bold">LENGTH</span></p>
              <p>P1 → P4 = <span className="text-blue-400 font-bold">WIDTH</span></p>
              <div className="mt-2 opacity-60 border-t border-blue-500/10 pt-1">
                <p>1. Top-Left (Origin)</p>
                <p>2. Top-Right</p>
                <p>3. Bottom-Right</p>
                <p>4. Bottom-Left</p>
              </div>
            </div>
          </div>

          {calibration.targets.map((target, idx) => (
            <section key={target.id} className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider">Target {idx + 1}</h3>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${target.points.filter(p => p.defined).length === 4 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                  {target.points.filter(p => p.defined).length}/4 SET
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-slate-600 block mb-1 uppercase font-bold">Length (m)</label>
                  <input type="number" step="0.01" value={target.width} onChange={(e) => updateTargetSize(target.id, 'width', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-blue-400 font-mono outline-none focus:border-blue-500" />
                  <span className="text-[7px] text-slate-600 uppercase mt-0.5 block">Distance P1-P2</span>
                </div>
                <div>
                  <label className="text-[9px] text-slate-600 block mb-1 uppercase font-bold">Width (m)</label>
                  <input type="number" step="0.01" value={target.height} onChange={(e) => updateTargetSize(target.id, 'height', e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-blue-400 font-mono outline-none focus:border-blue-500" />
                  <span className="text-[7px] text-slate-600 uppercase mt-0.5 block">Distance P1-P4</span>
                </div>
              </div>
            </section>
          ))}

          <button onClick={onClearCalibration} className="w-full py-2.5 bg-red-950/10 hover:bg-red-900/20 border border-red-900/30 rounded-lg text-xs font-bold text-red-400/60 transition-all uppercase tracking-widest">Clear All Points</button>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Measurement Probes</h3>
            <div className="space-y-3">
              <div className={`p-4 rounded-xl border flex justify-between items-center transition-all ${measurements.pointA ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-slate-800/40 border-slate-800'}`}>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Probe A</span>
                  <span className="text-[10px] text-slate-500 font-medium">{measurements.pointA ? 'Locked' : 'Click to Set'}</span>
                </div>
                <span className="text-xs font-mono text-slate-300">{measurements.pointA ? `${Math.floor(measurements.pointA.x)}, ${Math.floor(measurements.pointA.y)}` : '---'}</span>
              </div>
              <div className={`p-4 rounded-xl border flex justify-between items-center transition-all ${measurements.pointB ? 'bg-orange-950/20 border-orange-500/30' : 'bg-slate-800/40 border-slate-800'}`}>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Probe B</span>
                  <span className="text-[10px] text-slate-500 font-medium">{measurements.pointB ? 'Locked' : 'Click to Set'}</span>
                </div>
                <span className="text-xs font-mono text-slate-300">{measurements.pointB ? `${Math.floor(measurements.pointB.x)}, ${Math.floor(measurements.pointB.y)}` : '---'}</span>
              </div>
            </div>
          </section>

          <button onClick={onCalculate} disabled={!canCalculate} className={`w-full py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-2xl ${canCalculate ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20 active:scale-95' : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'}`}>Run Distance Solve</button>

          {distance !== null && (
            <div className="bg-emerald-500/10 border border-emerald-500/50 p-6 rounded-2xl text-center animate-in zoom-in duration-300 shadow-inner">
              <div className="text-[10px] text-emerald-400 uppercase font-black tracking-widest mb-1">Computed Real Distance</div>
              <div className="text-4xl font-black text-white font-mono tracking-tighter">
                {distance.toFixed(4)}
                <span className="text-sm ml-1 font-normal text-emerald-500/60">m</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto border-t border-slate-800 pt-6">
        <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-[9px] text-slate-500 leading-relaxed font-medium">
          <p className="text-blue-500 font-black mb-1 uppercase tracking-tighter">Usage Tips:</p>
          <p>• Use <span className="text-slate-300 font-bold">Rectangle 1</span> as your main reference.</p>
          <p>• Fine-tune points using <span className="text-slate-300 font-bold">Arrow Keys</span>.</p>
          <p>• Adjust <span className="text-slate-300 font-bold">K1</span> if straight edges appear curved.</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
