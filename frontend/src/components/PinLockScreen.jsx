import React, { useState } from 'react';
import { Lock, ArrowRight, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { verifyPin } from '../api';

export default function PinLockScreen({ onAuthenticated }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanPin = pin.replace(/\D/g, '');
    if (cleanPin.length !== 6) {
      setError('Please enter a 6-digit numeric PIN.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await verifyPin(cleanPin);
      if (res && res.token) {
        localStorage.setItem('autoclip_session_token', res.token);
        if (res.expires_at) {
          localStorage.setItem('autoclip_session_expires', res.expires_at);
        }
        onAuthenticated();
      } else {
        setError('Unexpected verification response.');
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Invalid or expired PIN. Send /pin in Telegram.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(val);
    if (error) setError('');
  };

  return (
    <div className="min-h-screen bg-[#07090E] flex items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-violet-600/10 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[350px] h-[350px] bg-indigo-600/10 blur-[110px] rounded-full pointer-events-none" />

      <div className="w-full max-w-sm z-10">
        {/* Card Container */}
        <div className="bg-[#0D1017]/90 border border-white/[0.08] backdrop-blur-2xl rounded-2xl p-7 shadow-2xl shadow-black/80 flex flex-col items-center text-center">
          
          {/* Logo */}
          <div className="relative mb-5 group">
            <div className="w-16 h-16 rounded-2xl overflow-hidden border border-white/10 shadow-xl shadow-violet-500/20 flex items-center justify-center bg-[#131722]">
              <img 
                src="/logo.png" 
                alt="AutoClip Logo" 
                className="w-full h-full object-cover" 
              />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-violet-600 border-2 border-[#0D1017] flex items-center justify-center text-white">
              <Lock className="w-3 h-3" />
            </div>
          </div>

          {/* Title & Badge */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="font-black text-lg tracking-tight text-white">
              AUTOCLIP
            </span>
            <span className="text-[10px] uppercase font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-[#A78BFA]">
              STUDIO
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-6">
            Private Terminal • Access Restricted
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={handleInputChange}
                  placeholder="• • •   • • •"
                  autoFocus
                  className="w-full text-center tracking-[0.35em] text-xl font-mono py-3.5 px-4 bg-white/[0.04] border border-white/[0.1] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-left animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span className="leading-tight">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || pin.length !== 6}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs tracking-wide uppercase transition-all shadow-lg shadow-violet-600/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 group cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying PIN...</span>
                </>
              ) : (
                <>
                  <span>Unlock Studio</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Help hint */}
          <div className="mt-6 pt-5 border-t border-white/[0.06] w-full text-left space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <ShieldCheck className="w-3.5 h-3.5 text-violet-400" />
              <span>How to get an access code:</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Open your private Telegram bot and send <code className="text-violet-300 bg-white/[0.05] px-1 py-0.5 rounded font-mono">/pin</code> (e.g. <code className="text-violet-300 bg-white/[0.05] px-1 py-0.5 rounded font-mono">/pin 11min</code> or <code className="text-violet-300 bg-white/[0.05] px-1 py-0.5 rounded font-mono">/pin 24h</code>).
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
