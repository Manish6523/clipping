import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-4">
          <div role="alert" className="w-full max-w-md rounded-2xl border border-bad/30 bg-surface p-5 text-center space-y-3 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-bad/15 text-bad flex items-center justify-center mx-auto"><AlertTriangle size={22} /></div>
            <h2 className="text-[17px] font-semibold">Something went wrong</h2>
            <p className="text-xs text-muted">The page crashed while drawing. Reloading usually fixes it - if not, the log below helps debugging.</p>
            <pre className="text-[11px] text-slate-300 font-mono bg-canvas border border-line p-3 rounded-xl overflow-x-auto text-left whitespace-pre-wrap break-words">
              {this.state.error?.message || 'Unknown render error'}
            </pre>
            <button type="button"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-accent-strong text-white text-[13px] font-semibold hover:bg-[#3987e5] transition-colors">
              <RefreshCw size={15} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
