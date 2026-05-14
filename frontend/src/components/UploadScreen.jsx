import { useState, useEffect, useRef } from 'react';
import { listJobs } from '../api.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDur(s) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const STATUS_ICON = {
  ready:      { icon: 'check_circle',        color: '#5eead4' },
  error:      { icon: 'error',               color: '#fca5a5' },
  separating: { icon: 'progress_activity',   color: '#fde047' },
  extracting: { icon: 'progress_activity',   color: '#fde047' },
  pending:    { icon: 'schedule',            color: 'var(--white-40)' },
};

export default function UploadScreen({ onUpload, uploading, uploadError, onResume }) {
  const [dragOver, setDragOver]   = useState(false);
  const [file, setFile]           = useState(null);
  const [sourceLang, setSourceLang] = useState('hi');
  const [targetLang, setTargetLang] = useState('en');
  const [fps, setFps]             = useState('25');
  const [recents, setRecents]     = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    listJobs(8).then(setRecents).catch(() => {});
  }, []);

  const handleFile = (f) => { if (f) setFile(f); };

  const handleSubmit = () => {
    if (!file || uploading) return;
    onUpload(file, { sourceLang, targetLang, fps: parseFloat(fps) });
  };

  const fileSizeMB = file ? (file.size / 1e6).toFixed(1) : null;

  return (
    <div className="upload-screen">
      <div className="upload-wrap">
        <div className="upload-eyebrow mono">NEW PROJECT · PRE-STEM</div>
        <h2 className="upload-h">Upload the master to start dubbing</h2>
        <p className="upload-sub">
          Drop your video or audio file. We'll separate vocals from the instrumental
          and hand you off to the editor when it's ready.
        </p>

        <label
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.mxf,.wav,.mp3,.mp4,.mov,.mkv,.avi"
            hidden
            onChange={(e) => handleFile(e.target.files[0])}
          />
          <div className="drop-icon">
            <span className="ms sz-32">upload_file</span>
          </div>
          {file ? (
            <>
              <div className="drop-title" style={{ color: 'var(--ins-accent)' }}>{file.name}</div>
              <div className="drop-formats">{fileSizeMB} MB</div>
            </>
          ) : (
            <>
              <div className="drop-title">Drop file here, or <u>browse</u></div>
              <div className="drop-formats">MXF · MP4 · MOV · WAV · MP3 · up to 2 GB</div>
            </>
          )}
        </label>

        <div className="upload-meta">
          <div className="meta-row">
            <div className="meta-k">Source language</div>
            <div className="meta-v">
              <select className="meta-select" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
                <option value="te">Telugu</option>
                <option value="ml">Malayalam</option>
                <option value="bn">Bengali</option>
              </select>
            </div>
          </div>
          <div className="meta-row">
            <div className="meta-k">Target language</div>
            <div className="meta-v">
              <select className="meta-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="ar">Arabic</option>
              </select>
            </div>
          </div>
          <div className="meta-row">
            <div className="meta-k">Frame rate</div>
            <div className="meta-v">
              <select className="meta-select" value={fps} onChange={(e) => setFps(e.target.value)}>
                <option value="23.976">23.976</option>
                <option value="24">24</option>
                <option value="25">25</option>
                <option value="29.97">29.97</option>
                <option value="30">30</option>
              </select>
            </div>
          </div>
        </div>

        {uploadError && (
          <div className="save-warn" style={{ marginBottom: 12 }}>
            <span className="ms sz-16">error</span>
            <span>{uploadError}</span>
          </div>
        )}

        <div className="upload-actions">
          <button className="btn ghost" disabled>
            <span className="ms sz-16">link</span>Paste S3 / Drive URL
          </button>
          <button className="btn primary" disabled={!file || uploading} onClick={handleSubmit}>
            {uploading ? (
              <>
                <span className="ms sz-16" style={{ animation: 'spin 1.2s linear infinite' }}>progress_activity</span>
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <span>Start separation</span>
                <span className="ms sz-16">arrow_forward</span>
              </>
            )}
          </button>
        </div>

        {recents.length > 0 && (
          <div className="recents">
            <div className="recents-head mono">RECENT PROJECTS</div>
            {recents.map((j) => {
              const s = STATUS_ICON[j.status] ?? STATUS_ICON.pending;
              return (
                <button key={j.id} className="recent-row" onClick={() => onResume?.(j.id)}>
                  <span className="ms sz-16" style={{ color: s.color, flexShrink: 0 }}>{s.icon}</span>
                  <span className="recent-name">{j.source_filename}</span>
                  {j.duration_s && <span className="recent-dur mono">{fmtDur(j.duration_s)}</span>}
                  <span className="recent-date">{fmtDate(j.created_at)}</span>
                  <span className="ms sz-14" style={{ color: 'var(--white-30)', flexShrink: 0 }}>chevron_right</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
