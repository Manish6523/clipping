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
  Eye
} from 'lucide-react';
import axios from 'axios';

export default function WebcamLab() {
  const [imageSrc, setImageSrc] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);
  const [webcamBox, setWebcamBox] = useState(null);
  const [gameplayBox, setGameplayBox] = useState({ x: 0.2, y: 0.0, w: 0.6, h: 1.0 });
  const [statusMessage, setStatusMessage] = useState(null);
  const fileInputRef = useRef(null);
  const previewCanvasRef = useRef(null);

  // Default sample images for quick 1-click testing
  const samplePresets = [
    { name: 'Streamer Cam (Kai Cenat)', path: '/api/channels/kaicenat/frame' },
    { name: 'Streamer Cam (OhnePixel)', path: '/api/channels/ohnepixel/frame' },
    { name: 'Gameplay Focus (xQc)', path: '/api/channels/xqc/frame' }
  ];

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setImageSrc(dataUrl);
      setDetectionResult(null);
      setWebcamBox(null);
      runDetection(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const loadSample = async (url) => {
    setImageSrc(url);
    setDetectionResult(null);
    setWebcamBox(null);
    runDetection(url, true);
  };

  const runDetection = async (imgSource, isUrl = false) => {
    setDetecting(true);
    setStatusMessage('Analyzing frame with hybrid vision detector...');
    try {
      const payload = isUrl ? { image_url: imgSource } : { image_base64: imgSource };
      const res = await axios.post('/api/detect/webcam', payload);
      setDetectionResult(res.data);

      if (res.data.has_webcam && res.data.box) {
        setWebcamBox(res.data.box);
        setStatusMessage(`Webcam detected (${Math.round(res.data.confidence * 100)}% conf)! Automatically applied Facecam Split.`);
      } else {
        setWebcamBox(null);
        setStatusMessage('No webcam overlay found. Automatically switched to Full Gameplay Fallback.');
      }
    } catch (err) {
      console.error(err);
      setStatusMessage('Detection failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setDetecting(false);
    }
  };

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

      if (detectionResult?.has_webcam && webcamBox) {
        // LAYOUT A: FACECAM TOP (38%) + GAMEPLAY BOTTOM (62%)
        // 1. Draw Facecam on Top 38%
        const camSrcX = webcamBox.x * img.naturalWidth;
        const camSrcY = webcamBox.y * img.naturalHeight;
        const camSrcW = webcamBox.w * img.naturalWidth;
        const camSrcH = webcamBox.h * img.naturalHeight;
        ctx.drawImage(img, camSrcX, camSrcY, camSrcW, camSrcH, 0, 0, 1080, 730);

        // Border divider
        ctx.fillStyle = '#8FD3FF';
        ctx.fillRect(0, 726, 1080, 4);

        // 2. Draw Gameplay on Bottom 62%
        const gpSrcX = gameplayBox.x * img.naturalWidth;
        const gpSrcY = gameplayBox.y * img.naturalHeight;
        const gpSrcW = gameplayBox.w * img.naturalWidth;
        const gpSrcH = gameplayBox.h * img.naturalHeight;
        ctx.drawImage(img, gpSrcX, gpSrcY, gpSrcW, gpSrcH, 0, 730, 1080, 1190);
      } else {
        // LAYOUT B: NO WEBCAM FALLBACK -> Full 9:16 Blurred Backdrop + Center Fit
        // 1. Draw Blurred Backdrop
        ctx.filter = 'blur(40px) brightness(0.4)';
        ctx.drawImage(img, 0, 0, 1080, 1920);
        ctx.filter = 'none';

        // 2. Draw 16:9 Center Stream in middle
        const centerH = 1080 * (9 / 16);
        const centerY = (1920 - centerH) / 2;
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, centerY, 1080, centerH);

        // Draw crisp border around center 16:9 box
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, centerY, 1080, centerH);
      }
    };
  }, [imageSrc, detectionResult, webcamBox, gameplayBox]);

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
              Prototype
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Test automated streamer facecam detection. When a webcam is found, it snaps the crop box onto it. If no webcam is found, it switches automatically to the gameplay fallback.
          </p>
        </div>

        {/* Quick Sample Streamer Presets */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 hidden sm:inline">Try Live Frame:</span>
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
          <div className="w-full aspect-video bg-[#0D1017] rounded-xl border border-white/10 relative overflow-hidden flex items-center justify-center shadow-xl group">
            {imageSrc ? (
              <div className="relative w-full h-full">
                <img 
                  src={imageSrc} 
                  alt="Stream frame" 
                  className="w-full h-full object-contain pointer-events-none" 
                />

                {/* Webcam Detection Box (Drawn directly on detected coordinates) */}
                {webcamBox && (
                  <div
                    style={{
                      left: `${webcamBox.x * 100}%`,
                      top: `${webcamBox.y * 100}%`,
                      width: `${webcamBox.w * 100}%`,
                      height: `${webcamBox.h * 100}%`,
                    }}
                    className="absolute border-2 border-emerald-400 bg-emerald-400/10 shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-all flex flex-col justify-between p-1 z-20 pointer-events-none animate-in fade-in"
                  >
                    <div className="flex items-center gap-1 bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow">
                      <Camera size={11} /> WEBCAM DETECTED ({Math.round(webcamBox.w * 100)}% x {Math.round(webcamBox.h * 100)}%)
                    </div>
                    {/* 4 Corner Markers */}
                    <div className="w-2 h-2 border-t-2 border-l-2 border-white absolute -top-0.5 -left-0.5" />
                    <div className="w-2 h-2 border-t-2 border-r-2 border-white absolute -top-0.5 -right-0.5" />
                    <div className="w-2 h-2 border-b-2 border-l-2 border-white absolute -bottom-0.5 -left-0.5" />
                    <div className="w-2 h-2 border-b-2 border-r-2 border-white absolute -bottom-0.5 -right-0.5" />
                  </div>
                )}

                {/* Gameplay Crop Box Overlay */}
                <div
                  style={{
                    left: `${gameplayBox.x * 100}%`,
                    top: `${gameplayBox.y * 100}%`,
                    width: `${gameplayBox.w * 100}%`,
                    height: `${gameplayBox.h * 100}%`,
                  }}
                  className="absolute border border-dashed border-[#8FD3FF]/60 pointer-events-none z-10 p-1 flex items-end justify-end"
                >
                  <span className="text-[9px] font-mono bg-black/80 px-1 py-0.5 rounded text-[#8FD3FF]">
                    Gameplay Box
                  </span>
                </div>
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
                  Or select one of the live channel buttons above to test facecam recognition.
                </span>
              </div>
            )}

            {/* In-Flight Scanning Indicator */}
            {detecting && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30">
                <RefreshCw size={24} className="text-[#8FD3FF] animate-spin" />
                <span className="text-xs font-bold text-[#8FD3FF] uppercase tracking-wider">
                  Analyzing Stream Layout & Searching for Webcam...
                </span>
              </div>
            )}
          </div>

          {/* Diagnostic Result Card */}
          {detectionResult && (
            <div className={`p-4 rounded-xl border flex flex-col gap-2 ${
              detectionResult.has_webcam 
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {detectionResult.has_webcam ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {detectionResult.has_webcam ? 'Webcam Found' : 'No Webcam Detected'}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10 text-white">
                  Method: {detectionResult.method || 'hybrid'} ({Math.round((detectionResult.confidence || 0) * 100)}% conf)
                </span>
              </div>
              <p className="text-xs text-slate-300">{detectionResult.description}</p>
              {detectionResult.has_webcam && webcamBox && (
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/10 text-[11px] font-mono text-slate-400">
                  <div>X: {Math.round(webcamBox.x * 100)}%</div>
                  <div>Y: {Math.round(webcamBox.y * 100)}%</div>
                  <div>Width: {Math.round(webcamBox.w * 100)}%</div>
                  <div>Height: {Math.round(webcamBox.h * 100)}%</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live 9:16 Composite Vertical Simulation */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Smartphone size={14} className="text-[#8FD3FF]" /> Generated 9:16 Vertical Short (Simulated)
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {detectionResult?.has_webcam ? 'Layout: Facecam Split' : 'Layout: Blurred Backdrop Fallback'}
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
                <span className={`w-2 h-2 rounded-full ${detectionResult?.has_webcam ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-[10px] font-bold text-white">
                  {detectionResult?.has_webcam ? 'Auto Facecam Top' : 'Auto Gameplay Fallback'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
