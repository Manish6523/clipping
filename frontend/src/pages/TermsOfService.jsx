import React from 'react';
import { FileText, ExternalLink, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-canvas text-ink py-10 px-4 sm:px-6 max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white mb-2">
        <ArrowLeft size={14} /> Back to Dashboard
      </Link>

      <div className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <FileText className="text-accent" size={24} /> Terms of Service
        </h1>
        <p className="text-xs text-muted mt-1">Last updated: November 2026 · AutoClip Studio</p>
      </div>

      <div className="space-y-5 text-xs sm:text-sm text-slate-300 leading-relaxed">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or using AutoClip Studio, you agree to comply with and be bound by these Terms of Service.
            This service is an internal creator automation tool used for processing and publishing original video content.
          </p>
        </section>

        <section className="space-y-2 bg-surface p-4 rounded-xl border border-line">
          <h2 className="text-base font-semibold text-white">2. YouTube Terms of Service</h2>
          <p>
            AutoClip Studio accesses YouTube API Services. By connecting your YouTube account, you acknowledge and agree that your use of YouTube is governed by the{' '}
            <a
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline inline-flex items-center gap-1"
            >
              YouTube Terms of Service <ExternalLink size={12} />
            </a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">3. User Obligations & Content Ownership</h2>
          <p>
            You represent and warrant that you own or have obtained all necessary licenses, rights, consents, and permissions to publish any content processed through AutoClip Studio to YouTube.
            You must not use this tool to upload content that violates copyright laws or YouTube Community Guidelines.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">4. API Usage & Rate Limits</h2>
          <p>
            AutoClip Studio complies strictly with YouTube API quota policies and rate limits. The software does not attempt to circumvent API restrictions, spoof user agents, or generate artificial traffic.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-white">5. Termination & Access Revocation</h2>
          <p>
            You may stop using the service and revoke API access at any time via your Google Account security permissions.
            We reserve the right to modify or terminate features in accordance with YouTube Developer Policy updates.
          </p>
        </section>
      </div>
    </div>
  );
}
