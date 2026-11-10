import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Smartphone, 
  RefreshCw, 
  Layers,
  Crop,
  ShieldCheck,
  Eye,
  Crosshair,
  Sliders
} from 'lucide-react';
import { api } from '../api';

export default function WebcamLab() {
  const [imageSrc, setImageSrc] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);
  const [webcamBox, setWebcamBox] = useState(null);
  const [gameplayBox, setGameplayBox] = useState({ x: 0.15, y: 0.0, w: 0.70, h: 1.0 });
  const [statusMessage, setStatusMessage] = useState(null);
  
  // Manual Box Override Mode
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualBox, setManualBox] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);

  const fileInputRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const sourceContainerRef = useRef(null);

  const samplePresets = [
    { name: 'Kai Cenat (Stream)', path: '/api/channels/kaicenat/frame' },
    { name: 'OhnePixel (Cam)', path: '/api/channels/ohnepixel/frame' },
    { name: 'xQc (PiP Overlay)', path: '/api/channels/xqc/frame' }
  ];

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1920;
        const maxH = 1080;
        let w = img.width;
        let h = img.height;

        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setImageSrc(optimizedDataUrl);
        setDetectionResult(null);
        setWebcamBox(null);
        setIsManualMode(false);
        setManualBox(null);
        runDetection(optimizedDataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const loadSample = async (url) => {
    setImageSrc(url);
    setDetectionResult(null);
    setWebcamBox(null);
    setIsManualMode(false);
    setManualBox(null);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        runDetection(reader.result, false);
      };
      reader.readAsDataURL(blob);
    } catch {
      runDetection(url, true);
    }
  };

  const runDetection = async (imgSource, isUrl = false) => {
    // If user has set manual box, detection is skipped
    if (isManualMode && manualBox) return;

    setDetecting(true);
    setStatusMessage('Running scene classification and border-evidence scoring...');
    try {
      const payload = isUrl ? { image_url: imgSource } : { image_base64: imgSource };
      const res = await api.post('/api/detect/webcam', payload);
      setDetectionResult(res.data);

      if (res.data.has_webcam && res.data.person) {
        setWebcamBox(res.data.person);
        setStatusMessage(`Webcam overlay confirmed (${Math.round((res.data.overlay_score || 0) * 100)}% score). Stack layout recommended.`);
      } else {
        setWebcamBox(null);
        const reason = res.data.layout_recommendation?.reason || 'No separate webcam overlay';
        setStatusMessage(`Classified as ${res.data.scene_class}. Recommending ${res.data.layout_recommendation?.mode || 'fallback'} layout.`);
      }
    } catch (err) {
      console.error(err);
      setStatusMessage('Detection failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setDetecting(false);
    }
  };

  // Manual Bounding Box Drawing Handlers
  const handlePointerDown = (e) => {
    if (!isManualMode || !sourceContainerRef.current) return;
    const rect = sourceContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setIsDrawing(true);
    setDrawStart({ x, y });
    setManualBox({ x, y, w: 0.05, h: 0.05 });
  };

  const handlePointerMove = (e) => {
    if (!isDrawing || !drawStart || !sourceContainerRef.current) return;
    const rect = sourceContainerRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const curY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const x = Math.min(drawStart.x, curX);
    const y = Math.min(drawStart.y, curY);
    const w = Math.max(0.04, Math.abs(curX - drawStart.x));
    const h = Math.max(0.04, Math.abs(curY - drawStart.y));

    setManualBox({
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      w: Math.round(w * 1000) / 1000,
      h: Math.round(h * 1000) / 1000,
    });
  };

  const handlePointerUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      setWebcamBox(manualBox);
    }
  };

  const activeBox = (isManualMode && manualBox) ? manualBox : webcamBox;

  // Render 9:16 Composite Live Preview on Canvas
  useEffect(() => {
    if (!imageSrc || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageSrc;

    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const rec = detectionResult?.layout_recommendation || {};
      const mode = (isManualMode && manualBox) ? 'stack' : (rec.mode || 'single_blur_backdrop');

      if (mode === 'stack' && activeBox) {
        // Adaptive Person Slot Height:
        const camAspect = (activeBox.w * img.naturalWidth) / Math.max(1, (activeBox.h * img.naturalHeight));
        const rawSlotH = 1080 / Math.max(0.5, camAspect);
        const personSlotH = Math.max(480, Math.min(864, rawSlotH)); // clamp [25%, 45%]

        // 1. Draw Facecam on Adaptive Top Slot
        const camSrcX = activeBox.x * img.naturalWidth;
        const camSrcY = activeBox.y * img.naturalHeight;
        const camSrcW = activeBox.w * img.naturalWidth;
        const camSrcH = activeBox.h * img.naturalHeight;
        ctx.drawImage(img, camSrcX, camSrcY, camSrcW, camSrcH, 0, 0, 1080, personSlotH);

        // Divider
        ctx.fillStyle = '#8FD3FF';
        ctx.fillRect(0, personSlotH - 2, 1080, 4);

        // 2. Draw Content on Remaining Slot
        const gpSrcX = gameplayBox.x * img.naturalWidth;
        const gpSrcY = gameplayBox.y * img.naturalHeight;
        const gpSrcW = gameplayBox.w * img.naturalWidth;
        const gpSrcH = gameplayBox.h * img.naturalHeight;
        ctx.drawImage(img, gpSrcX, gpSrcY, gpSrcW, gpSrcH, 0, personSlotH, 1080, 1920 - personSlotH);
      } 
      else if (mode === 'single_follow' && rec.crop_window) {
        // Single follow 9:16 window on dominant speaker/scene
        const cw = rec.crop_window;
        const srcX = cw.x * img.naturalWidth;
        const srcY = cw.y * img.naturalHeight;
        const srcW = cw.w * img.naturalWidth;
        const srcH = cw.h * img.naturalHeight;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 1080, 1920);
      } 
      else {
        // Single 16:9 Center with Blurred Backdrop (Never duplicates screen regions)
        ctx.filter = 'blur(40px) brightness(0.4)';
        ctx.drawImage(img, 0, 0, 1080, 1920);
        ctx.filter = 'none';

        const centerH = 1080 * (9 / 16);
        const centerY = (1920 - centerH) / 2;
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, centerY, 1080, centerH);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, centerY, 1080, centerH);
      }
    };
  }, [imageSrc, detectionResult, activeBox, gameplayBox, isManualMode, manualBox]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#0A0D14] text-white p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-[#8FD3FF]/10 text-[#8FD3FF]">
              <Camera size={20} />
            </span>
            <h1 className="text-xl font-bold tracking-tight">Auto Webcam Detection & Layout Lab</h1>
            <span className="text-[10px] font-mono uppercase bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">
              Production V2
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Separates real webcam overlays from in-scene faces using perimeter gradient discontinuity, color histogram difference, and spatial priors.
          </p>
        </div>

        {/* Live Frame Quick Buttons & Manual Override Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setIsManualMode(!isManualMode);
              if (!isManualMode) {
                setManualBox(activeBox || { x: 0.05, y: 0.10, w: 0.25, h: 0.30 });
                setWebcamBox(activeBox || { x: 0.05, y: 0.10, w: 0.25, h: 0.30 });
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
              isManualMode 
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-md' 
                : 'bg-white/5 border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            <Crosshair size={13} />
            {isManualMode ? 'Manual Mode: ON (Click & Drag)' : 'Force Webcam Box Here'}
          </button>

          <span className="text-xs text-slate-500 hidden sm:inline">|</span>

          {samplePresets.map((sp) => (
            <button
              key={sp.name}
              onClick={() => loadSample(sp.path)}
              className="px-2.5 py-1.5 bg-[#131722] hover:bg-[#1A1F2C] border border-white/10 hover:border-[#8FD3FF]/40 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-all"
            >
              {sp.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Upload & 16:9 Source Box (Left) vs 9:16 Auto Composite Result (Right) */}
      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Column: 16:9 Stream Frame with Auto-Detected Box Overlay */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers size={14} className="text-[#8FD3FF]" /> 16:9 Stream Source Viewport
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8FD3FF]/15 hover:bg-[#8FD3FF]/25 border border-[#8FD3FF]/30 text-[#8FD3FF] rounded-lg text-xs font-bold transition-all shadow-sm"
            >
              <Upload size={13} /> Upload Screenshot
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {/* Interactive Source Frame Container */}
          <div 
            ref={sourceContainerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`w-full aspect-video bg-[#0D1017] rounded-xl border border-white/10 relative overflow-hidden flex items-center justify-center shadow-xl select-none ${
              isManualMode ? 'cursor-crosshair' : ''
            }`}
          >
            {imageSrc ? (
              <div className="relative w-full h-full pointer-events-none">
                <img 
                  src={imageSrc} 
                  alt="Stream frame" 
                  className="w-full h-full object-contain pointer-events-none" 
                />

                {/* Webcam Detection Box */}
                {activeBox && (
                  <div
                    style={{
                      left: `${activeBox.x * 100}%`,
                      top: `${activeBox.y * 100}%`,
                      width: `${activeBox.w * 100}%`,
                      height: `${activeBox.h * 100}%`,
                    }}
                    className={`absolute border-2 ${
                      isManualMode ? 'border-amber-400 bg-amber-400/15' : 'border-emerald-400 bg-emerald-400/10'
                    } shadow-lg transition-all flex flex-col justify-between p-1 z-20 pointer-events-none`}
                  >
                    <div className={`flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow ${
                      isManualMode ? 'bg-amber-950/90 text-amber-300 border border-amber-500/40' : 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/40'
                    }`}>
                      <Camera size={11} /> 
                      {isManualMode ? 'MANUAL WEBCAM BOX' : `WEBCAM (${Math.round(activeBox.w * 100)}% x ${Math.round(activeBox.h * 100)}%)`}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-6 text-center cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[#8FD3FF] mb-3">
                  <Upload size={22} />
                </div>
                <span className="text-sm font-bold text-white mb-1">Click to Upload Stream Frame or Snapshot</span>
                <span className="text-xs text-slate-500 max-w-sm">
                  Upload any screenshot (including IRL sleeping streams or realistic game faces) to test separation.
                </span>
              </div>
            )}

            {/* In-Flight Scanning Indicator */}
            {detecting && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30">
                <RefreshCw size={24} className="text-[#8FD3FF] animate-spin" />
                <span className="text-xs font-bold text-[#8FD3FF] uppercase tracking-wider">
                  Analyzing Gradient Energy & Perimeter Borders...
                </span>
              </div>
            )}
          </div>

          {/* Diagnostic Result Card */}
          {detectionResult && (
            <div className={`p-4 rounded-xl border flex flex-col gap-3 ${
              detectionResult.has_webcam 
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                : 'bg-[#121620] border-white/10 text-slate-300'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {detectionResult.has_webcam ? <CheckCircle2 size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    Scene: <span className="font-mono text-[#8FD3FF]">{detectionResult.scene_class}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10 text-slate-300">
                    Overlay Score: {Math.round((detectionResult.overlay_score || 0) * 100)}%
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10 text-slate-400">
                    {detectionResult.elapsed_ms}ms
                  </span>
                </div>
              </div>

              {/* Layout Recommendation */}
              <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 flex flex-col gap-1">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sliders size={13} className="text-[#8FD3FF]" />
                  Layout Recommendation: <span className="font-mono text-emerald-300">{detectionResult.layout_recommendation?.mode}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {detectionResult.layout_recommendation?.reason}
                </div>
              </div>

              {/* Evidence Metrics Breakdown */}
              {detectionResult.overlay_evidence && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/[0.06] text-[10px] font-mono text-slate-400">
                  <div>Border Sides: <span className="text-white font-bold">{detectionResult.overlay_evidence.border_sides}/4</span></div>
                  <div>Border Discontinuity: <span className="text-white font-bold">{detectionResult.overlay_evidence.border_contrast}x</span></div>
                  <div>Color Dist: <span className="text-white font-bold">{Math.round(detectionResult.overlay_evidence.interior_exterior_distance * 100)}%</span></div>
                  <div>Corner Prior: <span className="text-white font-bold">{Math.round(detectionResult.overlay_evidence.corner_prior * 100)}%</span></div>
                </div>
              )}

              {/* In-Scene Faces / Rejection Reasons */}
              {detectionResult.in_scene_faces && detectionResult.in_scene_faces.length > 0 && (
                <div className="flex flex-col gap-1 pt-2 border-t border-white/[0.06]">
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    In-Scene Faces (Not Webcams):
                  </span>
                  {detectionResult.in_scene_faces.map((isf, i) => (
                    <div key={i} className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span>{isf.reason} (score {Math.round(isf.overlay_score * 100)}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live 9:16 Composite Vertical Simulation */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Smartphone size={14} className="text-[#8FD3FF]" /> Generated 9:16 Short (Never Duplicates)
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {detectionResult?.layout_recommendation?.mode || 'Preview'}
            </span>
          </div>

          {/* 9:16 Mobile Screen Viewport */}
          <div className="flex-1 bg-[#0D1017] rounded-xl border border-white/10 p-4 flex items-center justify-center min-h-[460px] shadow-xl">
            <div className="h-full max-h-[560px] aspect-[9/16] bg-black rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl relative">
              <canvas
                ref={previewCanvasRef}
                width={1080}
                height={1920}
                className="w-full h-full object-cover"
              />

              {/* Layout Mode Badge */}
              <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/15 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${detectionResult?.has_webcam || isManualMode ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-[10px] font-bold text-white capitalize">
                  {isManualMode ? 'Manual Stack' : (detectionResult?.layout_recommendation?.mode?.replace('_', ' ') || 'Single Content')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
