import React from 'react';
import { Shield, ExternalLink, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-canvas text-ink py-10 px-4 sm:px-6 max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white mb-2">
        <ArrowLeft size={14} /> Back to Dashboard
      </Link>

      <div className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="text-accent" size={24} /> Privacy Policy
        </h1>
        <p className="text-xs text-muted mt-1">Last updated: November 2026 · AutoClip Studio</p>
      </div>

      <div className="space-y-5 text-xs sm:text-sm text-slate-300 leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">1. Overview</h2>
          <p>
            AutoClip Studio ("we", "us", or "our") is an internal video production and publishing automation tool designed
            to help content creators process highlight moments and publish them to their authenticated YouTube channels.
          </p>
        </section>

        <section className="space-y-2 bg-surface p-4 rounded-xl border border-line">
          <h2 className="text-base font-semibold text-white">2. YouTube API Services & Google Privacy Policy</h2>
          <p>
            AutoClip Studio utilizes the <strong>YouTube Data API v3</strong> to upload videos and monitor channel publication status.
            By using this application, you agree to be bound by the{' '}
            <a
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline inline-flex items-center gap-1"
            >
              YouTube Terms of Service <ExternalLink size={12} />
            </a>.
          </p>
          <p>
            Our application adheres to the{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline inline-flex items-center gap-1"
            >
              Google Privacy Policy <ExternalLink size={12} />
            </a>. Please refer to Google's Privacy Policy to understand how Google collects and processes data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">3. Information Collected & How It Is Used</h2>
          <p>
            AutoClip Studio only accesses the minimum necessary OAuth scopes required to upload videos on behalf of the channel owner (<code>youtube.upload</code> and <code>youtube.readonly</code>).
          </p>
          <ul className="list-disc pl-5 space-y-1 text-slate-400">
            <li>We store OAuth authentication tokens securely on your local server solely to authenticate API requests to YouTube.</li>
            <li>We do not collect, sell, transfer, or distribute personal user information or viewing habits to any third parties.</li>
            <li>We do not use YouTube user data for advertising, machine learning model training, or profiling.</li>
          </ul>
        </section>

        <section className="space-y-2 bg-surface p-4 rounded-xl border border-line">
          <h2 className="text-base font-semibold text-white">4. Data Storage and Deletion Policy</h2>
          <p>
            Users can revoke AutoClip Studio's access to their Google account at any time via the{' '}
            <a
              href="https://security.google.com/settings/security/permissions"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline inline-flex items-center gap-1"
            >
              Google Security Settings Permissions Page <ExternalLink size={12} />
            </a>.
          </p>
          <p className="mt-2">
            Upon revoking access or disconnecting an account in AutoClip Studio's Settings, all associated access tokens and cached credentials are immediately purged from the server database.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">5. Contact Information</h2>
          <p>
            For any questions, compliance requests, or data deletion inquiries, contact the administrator at{' '}
            <span className="text-accent font-mono">admin@clip.manish.casa</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
