import { useState, useEffect, lazy, Suspense } from 'react';
import UploadScreen from './components/UploadScreen.jsx';
import Editor from './components/Editor.jsx';
import { uploadJob, getJob, getWaveform, reSeparate } from './api.js';

const DiarizationEditor = lazy(() => import('./components/DiarizationEditor.jsx'));
const LipsyncEditor = lazy(() => import('./components/LipsyncEditor.jsx'));

async function loadJob(id, setters) {
  const { setJobId, setJobData, setVocWave, setInsWave, setHtdWave, setLoadError, setAppState } = setters;
  const data = await getJob(id);
  setJobId(id);
  setJobData(data);
  if (data.status === 'ready') {
    const [vRes, iRes, hRes] = await Promise.all([
      getWaveform(id, 'vocals'),
      getWaveform(id, 'instrumental'),
      getWaveform(id, 'htdemucs_vocals').catch(() => null),
    ]);
    setVocWave(vRes.samples);
    setInsWave(iRes.samples);
    setHtdWave(hRes?.samples ?? null);
    setAppState('active');
  } else if (data.status === 'error') {
    setLoadError(data.error_message || 'Pipeline failed.');
    setAppState('error');
  } else {
    setAppState('loading');
  }
}

const STORAGE_KEY = 'produb_job_id';

function LoadingScreen({ jobData }) {
  const progress = jobData?.progress ?? 0;
  const steps = [
    { lbl: 'Decoding source audio', pct: Math.min(100, progress * (100 / 30)) },
    { lbl: 'Separating vocals & instrumental', pct: Math.max(0, Math.min(100, (progress - 30) * (100 / 70))) },
  ];
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#050912',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 'min(520px, 90%)',
        background: 'linear-gradient(180deg, #0a1530, #050912)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 32,
      }}>
        <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 22 }}>
          Separating stems
        </h3>
        <p style={{ margin: 0, color: 'var(--white-60)', fontSize: 13, lineHeight: 1.55 }}>
          Splitting your source audio into vocals and instrumental. This may take a few minutes.
        </p>
        <div style={{ margin: '20px 0 12px', height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: 'linear-gradient(90deg, #2af598, #009efd)', transition: 'width 600ms ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--white-50)' }}>
          <span className="mono">{progress}%</span>
          <span>{jobData?.status ?? 'pending'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
          {steps.map((s, i) => {
            const done = s.pct >= 100;
            const cur = !done && s.pct > 0;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 12,
                padding: '8px 10px', borderRadius: 8,
                border: cur ? '1px solid rgba(42,245,152,0.3)' : '1px solid rgba(255,255,255,0.08)',
                background: cur ? 'rgba(42,245,152,0.06)' : 'rgba(255,255,255,0.02)',
              }}>
                <span className="ms sz-18" style={{ color: done ? '#5eead4' : cur ? '#2af598' : 'rgba(255,255,255,0.3)' }}>
                  {done ? 'check_circle' : cur ? 'progress_activity' : 'radio_button_unchecked'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--fg)' }}>{s.lbl}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--white-50)' }}>{Math.floor(s.pct)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Always start on upload screen; user resumes from the recents list
  const [appState, setAppState] = useState('upload');
  const [jobId, setJobId]       = useState(null);
  const [jobData, setJobData]   = useState(null);
  const [vocWave, setVocWave]   = useState(null);
  const [insWave, setInsWave]   = useState(null);
  const [htdWave, setHtdWave]   = useState(null);
  const [loadError, setLoadError]   = useState(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const stateSetters = { setJobId, setJobData, setVocWave, setInsWave, setHtdWave, setLoadError, setAppState };

  const handleResume = (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setVocWave(null); setInsWave(null); setHtdWave(null); setLoadError(null);
    loadJob(id, stateSetters).catch((err) => {
      setLoadError(err.message);
      setAppState('error');
    });
  };

  // ── Poll while separating ────────────────────────────────────────────────────
  useEffect(() => {
    if (appState !== 'loading' || !jobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getJob(jobId);
        if (cancelled) return;
        setJobData(data);
        if (data.status === 'ready') {
          const [vRes, iRes, hRes] = await Promise.all([
            getWaveform(jobId, 'vocals'),
            getWaveform(jobId, 'instrumental'),
            getWaveform(jobId, 'htdemucs_vocals').catch(() => null),
          ]);
          if (cancelled) return;
          setVocWave(vRes.samples);
          setInsWave(iRes.samples);
          setHtdWave(hRes?.samples ?? null);
          setAppState('active');
        } else if (data.status === 'error') {
          setLoadError(data.error_message || 'Pipeline failed.');
          setAppState('error');
        } else {
          setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!cancelled) { setLoadError(err.message); setAppState('error'); }
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [appState, jobId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleUpload = async (file, options) => {
    setUploading(true);
    setUploadError(null);
    try {
      const { job_id } = await uploadJob(file, options);
      localStorage.setItem(STORAGE_KEY, job_id);
      setJobId(job_id);
      setJobData(null);
      setVocWave(null);
      setInsWave(null);
      setHtdWave(null);
      setAppState('loading');
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRetry = async () => {
    setLoadError(null);
    try {
      await reSeparate(jobId);
      setJobData(null);
      setVocWave(null);
      setInsWave(null);
      setAppState('loading');
    } catch (err) {
      setLoadError(err.message);
      setAppState('error');
    }
  };

  const handleNewUpload = () => {
    localStorage.removeItem(STORAGE_KEY);
    setJobId(null);
    setJobData(null);
    setVocWave(null);
    setInsWave(null);
    setHtdWave(null);
    setLoadError(null);
    setAppState('upload');
  };

  const handleStageConfirm = async (speakers, segments) => {
    // Called by DiarizationEditor after confirm — reload job data
    try {
      const data = await getJob(jobId);
      setJobData(data);
    } catch (err) {
      setLoadError(err.message);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (appState === 'upload') {
    return <UploadScreen onUpload={handleUpload} uploading={uploading} uploadError={uploadError} onResume={handleResume} />;
  }

  if (appState === 'loading') {
    return <LoadingScreen jobData={jobData} />;
  }

  const stage = jobData?.current_stage ?? 1;

  // Stage 6 — Lipsync
  if (stage >= 6) {
    return (
      <Suspense fallback={null}>
        <LipsyncEditor
          jobId={jobId}
          jobData={jobData}
          onNewUpload={handleNewUpload}
        />
      </Suspense>
    );
  }

  // Stages 2–5 — Timeline editor (diarization / transcription / translation / TTS)
  const STAGE_MODE = { 2: 'diarization', 3: 'transcription', 4: 'translation', 5: 'tts' };
  if (stage >= 2 && stage <= 5) {
    return (
      <Suspense fallback={null}>
        <DiarizationEditor
          jobId={jobId}
          mode={STAGE_MODE[stage]}
          jobData={jobData}
          vocWave={vocWave}
          insWave={insWave}
          onConfirm={handleStageConfirm}
          onNewUpload={handleNewUpload}
        />
      </Suspense>
    );
  }

  // Stage 1 — Stem separation editor
  return (
    <Editor
      jobId={jobId}
      jobData={jobData}
      vocWave={vocWave}
      insWave={insWave}
      htdWave={htdWave}
      appState={appState}
      errorMessage={loadError}
      onRetry={handleRetry}
      onNewUpload={handleNewUpload}
    />
  );
}
