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
    <div className="min-h-[100dvh] bg-canvas flex items-center justify-center p-4 relative overflow-hidden select-none">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-accent-strong/10 blur-[140px] rounded-full pointer-events-none" />
      <main className="w-full max-w-sm z-10">
        <div className="bg-surface border border-line-strong rounded-2xl p-6 sm:p-7 shadow-2xl shadow-black/70 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <img src="/logo.png" alt="AutoClip" className="w-16 h-16 rounded-2xl object-cover border border-line-strong" />
            <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-accent-strong border-2 border-surface flex items-center justify-center text-white"><Lock className="w-3 h-3" /></span>
          </div>
          <h1 className="font-bold text-[19px] tracking-tight text-ink">AutoClip</h1>
          <p className="text-xs text-muted mt-1 mb-5">Private dashboard · enter your 6-digit code</p>

          <form onSubmit={handleSubmit} className="w-full space-y-3">
            <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pin} onChange={handleInputChange}
              placeholder="••••••" autoFocus autoComplete="one-time-code" aria-label="6-digit PIN"
              className="w-full text-center tracking-[0.4em] text-2xl font-mono h-14 px-4 bg-canvas border border-line-strong rounded-xl text-ink placeholder:text-faint focus:outline-none focus:border-accent/70 transition-colors" />
            {error && (
              <div role="alert" className="flex items-start gap-2 p-2.5 rounded-xl bg-bad/10 border border-bad/25 text-bad text-xs text-left">
                <AlertCircle className="w-4 h-4 shrink-0" /><span className="leading-snug">{error}</span>
              </div>
            )}
            <button type="submit" disabled={loading || pin.length !== 6}
              className="w-full h-12 rounded-xl bg-accent-strong hover:bg-[#3987e5] text-white font-semibold text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</> : <>Unlock <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-line w-full text-left space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-300"><ShieldCheck className="w-3.5 h-3.5 text-accent" /> How to get a code</div>
            <p className="text-[11.5px] text-muted leading-relaxed">
              Open your private Telegram bot and send <code className="text-accent bg-white/[0.05] px-1 py-0.5 rounded font-mono">/pin</code>
              {' '}(for example <code className="text-accent bg-white/[0.05] px-1 py-0.5 rounded font-mono">/pin 24h</code> for a day).
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
