import { useState, useEffect, useRef } from 'react';
import { runLipsync, getLipsync } from '../api.js';
import '../styles/editor.css';
import '../styles/diar.css';

const STAGES = [
  { id: 1, label: 'Stems' },
  { id: 2, label: 'Diarization' },
  { id: 3, label: 'Transcribe' },
  { id: 4, label: 'Translate' },
  { id: 5, label: 'TTS' },
  { id: 6, label: 'Lipsync' },
];

function TopHeader({ filename, onNewJob }) {
  return (
    <header className="top">
      <div className="top-left">
        <div className="brand">
          <span className="dot" />
          <span>ProDub</span>
        </div>
        <div className="divider-v" />
        <div className="proj">
          <span className="proj-name">{filename || 'Untitled'}</span>
        </div>
      </div>
      <nav className="stages" aria-label="Pipeline stages">
        {STAGES.map((s, i) => {
          const cls = s.id < 6 ? 'done' : 'current';
          return (
            <span key={s.id} style={{ display: 'contents' }}>
              {i > 0 && <div className="sep" />}
              <div className={`stage ${cls}`} title={s.label}>
                <span className="num">{s.id}</span>
                <span className="stage-label">{s.label}</span>
              </div>
            </span>
          );
        })}
      </nav>
      <div className="top-right">
        {onNewJob && (
          <button className="btn ghost" onClick={onNewJob}>
            <span className="ms sz-16">upload_file</span>
            <span>New Job</span>
          </button>
        )}
      </div>
    </header>
  );
}

function SubstageStrip() {
  return (
    <div className="substage">
      <div className="substage-title">
        <span className="ix">STAGE 6 / 6</span>
        <h1>Lipsync</h1>
        <span className="sub">Generate the final lip-synced output video.</span>
      </div>
    </div>
  );
}

// ── Status card content ───────────────────────────────────────────────────────
function StatusCard({ phase, outputUrl, errorMsg, onStart, onRetry }) {
  if (phase === 'pending') {
    return (
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ marginBottom: 20 }}>
          <span className="ms sz-32" style={{ color: 'var(--ins-accent)', display: 'block', fontSize: 48 }}>
            sync
          </span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>Ready for Lipsync</h2>
        <p style={{ color: 'var(--white-50)', marginBottom: 28, fontSize: 14, lineHeight: 1.6 }}>
          The dubbed audio will be processed against the source video to produce
          lip-synced output. This typically takes 2–5 minutes.
        </p>
        <button className="btn primary" onClick={onStart} style={{ padding: '10px 24px', fontSize: 14 }}>
          <span className="ms sz-18">play_circle</span>
          <span>Run Lipsync</span>
        </button>
      </div>
    );
  }

  if (phase === 'starting' || phase === 'running') {
    const isStarting = phase === 'starting';
    return (
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ marginBottom: 20, position: 'relative', display: 'inline-block' }}>
          <span
            className="ms sz-32"
            style={{
              color: 'var(--ins-accent)',
              display: 'block',
              fontSize: 48,
              animation: 'spin 1.4s linear infinite',
            }}
          >
            progress_activity
          </span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>
          {isStarting ? 'Starting…' : 'Processing…'}
        </h2>
        <p style={{ color: 'var(--white-50)', fontSize: 14, lineHeight: 1.6 }}>
          {isStarting
            ? 'Submitting lipsync job…'
            : 'Generating the lip-synced video. This may take a few minutes.'}
        </p>
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div
            style={{
              width: 180,
              height: 4,
              borderRadius: 999,
              background: 'var(--white-10)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0,
                width: '40%',
                borderRadius: 999,
                background: 'var(--ins-accent)',
                animation: 'indeterminate 1.6s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ marginBottom: 20 }}>
          <span
            className="ms sz-32"
            style={{ color: '#34d399', display: 'block', fontSize: 56 }}
          >
            check_circle
          </span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, color: '#34d399' }}>Lipsync Complete</h2>
        <p style={{ color: 'var(--white-50)', marginBottom: 28, fontSize: 14, lineHeight: 1.6 }}>
          Your dubbed video with lip sync is ready.
        </p>
        {outputUrl && (
          <div style={{ marginBottom: 24 }}>
            <video
              src={outputUrl}
              controls
              style={{
                width: '100%',
                maxWidth: 540,
                borderRadius: 12,
                border: '1px solid var(--white-10)',
                background: '#000',
              }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {outputUrl && (
            <a
              href={outputUrl}
              download
              className="btn primary"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 24px' }}
            >
              <span className="ms sz-18">file_download</span>
              <span>Download Video</span>
            </a>
          )}
          <button className="btn ghost" onClick={onRetry} style={{ padding: '10px 18px' }}>
            <span className="ms sz-16">refresh</span>
            <span>Re-run</span>
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="ms sz-32" style={{ color: '#fca5a5', display: 'block', fontSize: 48 }}>
            error
          </span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#fca5a5' }}>Lipsync Failed</h2>
        <p style={{ color: 'var(--white-50)', marginBottom: 24, fontSize: 13, lineHeight: 1.6 }}>
          {errorMsg || 'An unexpected error occurred during lipsync processing.'}
        </p>
        <button className="btn ghost" onClick={onRetry}>
          <span className="ms sz-16">refresh</span>
          <span>Retry</span>
        </button>
      </div>
    );
  }

  // init / loading
  return (
    <div style={{ textAlign: 'center' }}>
      <span
        className="ms sz-32"
        style={{ color: 'var(--white-30)', display: 'block', fontSize: 40, animation: 'spin 1.2s linear infinite' }}
      >
        progress_activity
      </span>
    </div>
  );
}

// ── Main LipsyncEditor ────────────────────────────────────────────────────────
export default function LipsyncEditor({ jobId, jobData, onNewJob, onNewUpload }) {
  const filename = jobData?.source_filename ?? 'Untitled';
  const handleNewJob = onNewJob ?? onNewUpload;

  const [phase, setPhase] = useState('init'); // init | pending | starting | running | ready | error
  const [outputUrl, setOutputUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    checkStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkStatus() {
    setPhase('init');
    try {
      const data = await getLipsync(jobId);
      applyStatus(data);
    } catch (err) {
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        setPhase('pending');
      } else {
        // Lipsync hasn't been started yet — show pending
        setPhase('pending');
      }
    }
  }

  function applyStatus(data) {
    if (!data) { setPhase('pending'); return; }
    const st = data.status;
    if (st === 'pending' || !st) {
      setPhase('pending');
    } else if (st === 'running' || st === 'processing') {
      setPhase('running');
      startPolling();
    } else if (st === 'ready' || st === 'done') {
      setPhase('ready');
      setOutputUrl(data.output_url ?? null);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } else if (st === 'error' || st === 'failed') {
      setPhase('error');
      setErrorMsg(data.error ?? 'Lipsync failed');
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } else {
      setPhase('pending');
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await getLipsync(jobId);
        applyStatus(data);
      } catch {}
    }, 5000);
  }

  async function handleStart() {
    setPhase('starting');
    try {
      await runLipsync(jobId);
      setPhase('running');
      startPolling();
    } catch (err) {
      setErrorMsg(err.message);
      setPhase('error');
    }
  }

  const handleRetry = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    handleStart();
  };

  return (
    <div className="app app-diar">
      <TopHeader filename={filename} onNewJob={handleNewJob} />
      <SubstageStrip />

      {/* Empty transport placeholder to maintain grid layout */}
      <div className="transport" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ color: 'var(--white-30)', fontSize: 12 }}>
          Stage 6 — Lipsync
        </div>
      </div>

      {/* Body — centered card */}
      <div className="body no-history" style={{ display: 'flex', alignItems: 'stretch' }}>
        <div
          className="workspace"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          <div
            style={{
              padding: '48px 56px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.01) 100%)',
              border: '1px solid var(--white-10)',
              borderRadius: 20,
              boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
              minWidth: 380,
              maxWidth: 600,
              width: '100%',
            }}
          >
            <StatusCard
              phase={phase}
              outputUrl={outputUrl}
              errorMsg={errorMsg}
              onStart={handleStart}
              onRetry={handleRetry}
            />
          </div>
        </div>
      </div>

      {/* Keyframes for indeterminate progress bar */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          60% { transform: translateX(250%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}
