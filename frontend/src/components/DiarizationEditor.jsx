import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { fmtTC, fmtTCshort } from '../utils/timecode.js';
import {
  getDiarization, runDiarization, confirmDiarization,
  getTranscription, runTranscription, confirmTranscription,
  getTranslation, runTranslation, confirmTranslation,
  getTTS, runTTS, confirmTTS,
  ttsAudioUrl,
} from '../api.js';
import '../styles/editor.css';
import '../styles/diar.css';

// ── Speaker palette ──────────────────────────────────────────────────────────
const SPEAKER_COLORS = [
  { color: '#7dbcff', bg: 'rgba(96,165,250,0.18)',  border: 'rgba(96,165,250,0.35)' },
  { color: '#5eead4', bg: 'rgba(94,234,212,0.18)',  border: 'rgba(94,234,212,0.35)' },
  { color: '#c4b5fd', bg: 'rgba(196,181,253,0.18)', border: 'rgba(196,181,253,0.35)' },
  { color: '#fbbf24', bg: 'rgba(251,191,36,0.18)',  border: 'rgba(251,191,36,0.35)' },
  { color: '#fb923c', bg: 'rgba(251,146,60,0.18)',  border: 'rgba(251,146,60,0.35)' },
  { color: '#f472b6', bg: 'rgba(244,114,182,0.18)', border: 'rgba(244,114,182,0.35)' },
  { color: '#34d399', bg: 'rgba(52,211,153,0.18)',  border: 'rgba(52,211,153,0.35)' },
  { color: '#e879f9', bg: 'rgba(232,121,249,0.18)', border: 'rgba(232,121,249,0.35)' },
];

function getSpeakerPalette(idx) {
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

// ── Stage config ─────────────────────────────────────────────────────────────
// handleSave calls confirm(jobId, speakers, segments).
// confirmDiarization(jobId, speakers, segments) — matches directly.
// confirmTranscription/Translation/TTS(jobId, segments, speakers) — swap order.
const STAGE_CONFIG = {
  diarization:  { num: 2, label: 'Diarization',        statusKey: 'diarization_status',  get: getDiarization,  run: runDiarization,  confirm: confirmDiarization  },
  transcription:{ num: 3, label: 'Transcription',       statusKey: 'transcription_status', get: getTranscription, run: runTranscription, confirm: (id, spk, segs) => confirmTranscription(id, segs, spk) },
  translation:  { num: 4, label: 'Script & Translation',statusKey: 'translation_status',   get: getTranslation,   run: runTranslation,   confirm: (id, spk, segs) => confirmTranslation(id, segs, spk)   },
  tts:          { num: 5, label: 'TTS Generation',      statusKey: 'tts_status',           get: getTTS,           run: runTTS,           confirm: (id, spk, segs) => confirmTTS(id, segs, spk)           },
};

// ── MiniWaveform ──────────────────────────────────────────────────────────────
function MiniWaveform({ data, color }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || canvas.width;
    const H = canvas.offsetHeight || canvas.height;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color || '#7dbcff';
    const barW = W / data.length;
    for (let i = 0; i < data.length; i++) {
      const h = data[i] * H;
      ctx.fillRect(i * barW, (H - h) / 2, Math.max(1, barW - 0.5), h);
    }
  }, [data, color]);
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// ── Ruler ─────────────────────────────────────────────────────────────────────
function Ruler({ contentWidth, viewportWidth, scrollLeft, duration, fps = 24 }) {
  const pxPerSec = contentWidth / duration;
  let majorStep = 60;
  if (pxPerSec > 60) majorStep = 10;
  else if (pxPerSec > 40) majorStep = 15;
  else if (pxPerSec > 18) majorStep = 30;
  const minorStep = majorStep / 5;

  const ticks = [];
  for (let t = 0; t <= duration; t += minorStep) {
    const x = (t / duration) * contentWidth - scrollLeft;
    if (x < -50 || x > viewportWidth + 50) continue;
    const isMajor = Math.abs((t / majorStep) - Math.round(t / majorStep)) < 1e-3;
    ticks.push(
      <div key={`t-${t}`} className={`tick ${isMajor ? '' : 'minor'}`} style={{ left: x }} />
    );
    if (isMajor) {
      ticks.push(
        <div key={`l-${t}`} className="tlabel" style={{ left: x }}>{fmtTCshort(t)}</div>
      );
    }
  }
  return <div className="ruler"><div className="tickwrap">{ticks}</div></div>;
}

// ── Playhead ──────────────────────────────────────────────────────────────────
function Playhead({ currentTime, pxPerSec, scrollLeft, viewportWidth }) {
  const x = currentTime * pxPerSec - scrollLeft;
  if (x < -2 || x > viewportWidth + 2) return null;
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="cap" />
    </div>
  );
}

// ── Scrollbar ─────────────────────────────────────────────────────────────────
function Scrollbar({ contentWidth, viewportWidth, scrollLeft, onScroll }) {
  const dragRef = useRef(null);
  if (contentWidth <= viewportWidth + 1) return null;
  const pad = 8, trackW = viewportWidth - pad * 2;
  const thumbW = Math.max(40, (viewportWidth / contentWidth) * trackW);
  const maxScroll = contentWidth - viewportWidth;
  const thumbLeft = (scrollLeft / maxScroll) * (trackW - thumbW);

  const startDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { startX: e.clientX, startScroll: scrollLeft };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const travel = trackW - thumbW;
      if (travel <= 0) return;
      onScroll(Math.max(0, Math.min(maxScroll, dragRef.current.startScroll + (dx / travel) * maxScroll)));
    };
    const endDrag = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', endDrag);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
  };

  return (
    <div className="scroll-track" style={{ left: pad, right: pad }}>
      <div className="scroll-thumb" onMouseDown={startDrag} style={{ left: thumbLeft, width: thumbW }} />
    </div>
  );
}

// ── SegmentFAB ────────────────────────────────────────────────────────────────
function SegmentFAB({ seg, speaker, mode, pxPerSec, scrollLeft, viewportWidth, laneTop,
  onEdit, onSplit, onDelete, onReassign, onRegen, onFlag, onPlay, onDismiss, isFlagged, speakers }) {
  const [reassignOpen, setReassignOpen] = useState(false);
  const fabRef = useRef(null);

  useEffect(() => {
    if (!reassignOpen) return;
    const handler = (e) => { if (!fabRef.current?.contains(e.target)) setReassignOpen(false); };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [reassignOpen]);

  if (!seg || !speaker) return null;

  const segMidX = ((seg.start + seg.end) / 2) * pxPerSec - scrollLeft;
  const fabWidth = 420;
  const fabLeft = Math.max(8, Math.min(viewportWidth - fabWidth - 8, segMidX - fabWidth / 2));
  const palette = getSpeakerPalette(speaker._idx ?? 0);

  return (
    <div
      ref={fabRef}
      className="seg-fab"
      style={{ left: fabLeft, top: laneTop - 44 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="seg-fab-info">
        <span className="spk-dot" style={{ background: palette.color }} />
        <span>{speaker.name}</span>
        <span style={{ marginLeft: 4, opacity: 0.6 }}>{fmtTCshort(seg.start)}–{fmtTCshort(seg.end)}</span>
      </div>

      {mode === 'diarization' && (
        <>
          <button className="seg-fab-btn" onClick={onSplit}>
            <span className="ms sz-14">content_cut</span><span>Split</span>
          </button>
          <button className="seg-fab-btn danger" onClick={onDelete}>
            <span className="ms sz-14">delete</span><span>Delete</span>
          </button>
          <div className="reassign-wrap">
            <button className="seg-fab-btn" onClick={() => setReassignOpen((v) => !v)}>
              <span className="ms sz-14">swap_horiz</span><span>Reassign</span>
            </button>
            {reassignOpen && (
              <div className="reassign-menu">
                {speakers.filter((s) => s.id !== speaker.id).map((s) => {
                  const p = getSpeakerPalette(s._idx ?? 0);
                  return (
                    <button key={s.id} className="ra-item" onClick={() => { onReassign(s.id); setReassignOpen(false); }}>
                      <span className="ra-dot" style={{ background: p.color, borderRadius: 3 }} />
                      <span>{s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {mode === 'transcription' && (
        <>
          <button className="seg-fab-btn" onClick={onEdit}><span className="ms sz-14">edit</span><span>Edit</span></button>
          <button className="seg-fab-btn" onClick={onRegen}><span className="ms sz-14">refresh</span><span>Regen</span></button>
          <button className={`seg-fab-btn ${isFlagged ? 'is-flagged' : ''}`} onClick={onFlag}>
            <span className="ms sz-14">flag</span><span>{isFlagged ? 'Unflag' : 'Flag'}</span>
          </button>
          <div className="reassign-wrap">
            <button className="seg-fab-btn" onClick={() => setReassignOpen((v) => !v)}>
              <span className="ms sz-14">swap_horiz</span><span>Reassign</span>
            </button>
            {reassignOpen && (
              <div className="reassign-menu">
                {speakers.filter((s) => s.id !== speaker.id).map((s) => {
                  const p = getSpeakerPalette(s._idx ?? 0);
                  return (
                    <button key={s.id} className="ra-item" onClick={() => { onReassign(s.id); setReassignOpen(false); }}>
                      <span className="ra-dot" style={{ background: p.color, borderRadius: 3 }} />
                      <span>{s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {mode === 'translation' && (
        <>
          <button className="seg-fab-btn" onClick={onEdit}><span className="ms sz-14">edit</span><span>Edit</span></button>
          <button className="seg-fab-btn" onClick={onRegen}><span className="ms sz-14">refresh</span><span>Regen</span></button>
          <button className={`seg-fab-btn ${isFlagged ? 'is-flagged' : ''}`} onClick={onFlag}>
            <span className="ms sz-14">flag</span><span>{isFlagged ? 'Unflag' : 'Flag'}</span>
          </button>
        </>
      )}

      {mode === 'tts' && (
        <>
          <button className="seg-fab-btn" onClick={onEdit}><span className="ms sz-14">edit</span><span>Edit</span></button>
          <button className="seg-fab-btn" onClick={onPlay}><span className="ms sz-14">play_arrow</span><span>Play</span></button>
          <button className="seg-fab-btn" onClick={onRegen}><span className="ms sz-14">refresh</span><span>Regen</span></button>
          <button className={`seg-fab-btn ${isFlagged ? 'is-flagged' : ''}`} onClick={onFlag}>
            <span className="ms sz-14">flag</span><span>{isFlagged ? 'Unflag' : 'Flag'}</span>
          </button>
        </>
      )}

      <button className="seg-fab-x" onClick={onDismiss}>
        <span className="ms sz-16">close</span>
      </button>
    </div>
  );
}

// ── EditOverlay ───────────────────────────────────────────────────────────────
function EditOverlay({ seg, speaker, mode, onSave, onCancel }) {
  const palette = getSpeakerPalette(speaker?._idx ?? 0);
  const isTranslation = mode === 'translation';
  const isTTS = mode === 'tts';

  const [textVal, setTextVal] = useState(
    isTranslation || isTTS ? (seg.tx ?? '') : (seg.text ?? '')
  );

  return (
    <div className="modal-scrim" onMouseDown={onCancel}>
      <div className="edit-overlay" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-overlay-head">
          <span className="edit-overlay-dot" style={{ background: palette.color }} />
          <span className="edit-overlay-name">{speaker?.name}</span>
          <span className="edit-overlay-tc">{fmtTCshort(seg.start)} – {fmtTCshort(seg.end)}</span>
          <button className="iconbtn" onClick={onCancel}><span className="ms sz-18">close</span></button>
        </div>

        {isTranslation && seg.text && (
          <div style={{ marginBottom: 8 }}>
            <div className="edit-overlay-help">Source text</div>
            <div style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, fontSize: 12, color: 'var(--white-60)' }}>
              {seg.text}
            </div>
          </div>
        )}

        <div className="edit-overlay-help">{isTranslation ? 'Translation' : isTTS ? 'TTS text' : 'Transcript'}</div>
        <textarea
          className="edit-overlay-textarea"
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); onSave(textVal); } }}
        />

        <div className="edit-overlay-actions">
          <span className="edit-overlay-hint">⌘Enter to save</span>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(textVal)}>
            <span>Save</span><span className="ms sz-16">check</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SpeakerRail ───────────────────────────────────────────────────────────────
function SpeakerRail({ speaker, palette, mode, segCount, muted, soloed, onToggleMute, onToggleSolo, onNameChange, onGenerate }) {
  const [nameVal, setNameVal] = useState(speaker.name);
  useEffect(() => setNameVal(speaker.name), [speaker.name]);

  return (
    <div
      className="rail-spk"
      style={{ '--spk-color': palette.color, '--spk-bg': palette.bg, '--spk-border': palette.border }}
    >
      <div className="rail-avatar">{(speaker.name || 'S')[0].toUpperCase()}</div>
      <div className="rail-meta">
        <div className="rail-namerow">
          <input
            className="rail-name"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={() => { if (nameVal.trim()) onNameChange(nameVal.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setNameVal(speaker.name); e.target.blur(); } }}
          />
        </div>
        <div className="rail-tags">
          {speaker.gender && <span className="spk-tag">{speaker.gender}</span>}
          {speaker.age && <span className="spk-tag">{speaker.age}</span>}
          <span className="spk-tag">{segCount} turn{segCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="rail-controls">
        {(mode === 'transcription' || mode === 'translation' || mode === 'tts') && onGenerate && (
          <button className="track-act" onClick={onGenerate} title="Generate / regenerate all segments">
            <span className="ms sz-14">auto_awesome</span>
            <span>Gen</span>
          </button>
        )}
        <button
          className={`tiny-toggle ${muted ? 'active mute' : ''}`}
          onClick={onToggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          <span className="ms sz-16">{muted ? 'volume_off' : 'volume_up'}</span>
        </button>
        <button
          className={`tiny-toggle solo ${soloed ? 'active' : ''}`}
          onClick={onToggleSolo}
          title={soloed ? 'Unsolo' : 'Solo'}
        >S</button>
      </div>
    </div>
  );
}

// ── SpeakerLane ───────────────────────────────────────────────────────────────
function SpeakerLane({
  speaker, palette, segments, duration, pxPerSec, scrollLeft, viewportWidth,
  selectedSegId, onSegClick, onSegDragEnd, mode, muted,
}) {
  const laneRef = useRef(null);
  const dragRef = useRef(null);

  const visSegs = segments.filter((s) => {
    const lx = s.start * pxPerSec - scrollLeft;
    const rx = s.end * pxPerSec - scrollLeft;
    return rx > -10 && lx < viewportWidth + 10;
  });

  const handleSegMouseDown = (e, seg, handle) => {
    if (mode !== 'diarization') {
      e.stopPropagation();
      onSegClick(seg);
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const origStart = seg.start;
    const origEnd = seg.end;

    dragRef.current = { seg, handle, startX, origStart, origEnd, moved: false };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - startX) / pxPerSec;
      dragRef.current.moved = Math.abs(ev.clientX - startX) > 3;

      if (handle === 'move') {
        const dur = origEnd - origStart;
        const newStart = Math.max(0, Math.min(duration - dur, origStart + dx));
        onSegDragEnd(seg.id, { start: newStart, end: newStart + dur, speakerId: speaker.id, provisional: true });
      } else if (handle === 'l') {
        const newStart = Math.max(0, Math.min(origEnd - 0.2, origStart + dx));
        onSegDragEnd(seg.id, { start: newStart, end: origEnd, speakerId: speaker.id, provisional: true });
      } else if (handle === 'r') {
        const newEnd = Math.max(origStart + 0.2, Math.min(duration, origEnd + dx));
        onSegDragEnd(seg.id, { start: origStart, end: newEnd, speakerId: speaker.id, provisional: true });
      }
    };

    const onUp = () => {
      if (dragRef.current && !dragRef.current.moved) {
        onSegClick(seg);
      }
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const getSegStatus = (seg) => {
    if (mode === 'diarization') return 'draft';
    if (seg.status) return seg.status;
    if (mode === 'transcription') return seg.text ? 'transcribed' : 'pending';
    if (mode === 'translation') return seg.tx ? 'translated' : 'pending';
    if (mode === 'tts') return seg.audio_url ? 'audio-ready' : 'pending';
    return 'draft';
  };

  return (
    <div
      ref={laneRef}
      className={`lane-spk ${muted ? 'muted' : ''}`}
      style={{ '--spk-color': palette.color, '--spk-bg': palette.bg }}
    >
      {visSegs.length === 0 && (
        <div className="lane-empty-hint">no segments</div>
      )}
      {visSegs.map((seg) => {
        const lx = seg.start * pxPerSec - scrollLeft;
        const rw = (seg.end - seg.start) * pxPerSec;
        const status = getSegStatus(seg);
        const isTiny = rw < 60;
        const isSelected = selectedSegId === seg.id;

        return (
          <div
            key={seg.id}
            className={`seg ${status} ${isSelected ? 'selected' : ''} ${seg.flagged ? 'flagged' : ''} ${isTiny ? 'tiny' : ''}`}
            style={{
              left: lx,
              width: rw,
              background: (status === 'draft' || status === 'pending') ? undefined : palette.color,
              color: (status === 'draft' || status === 'pending') ? palette.color : '#0a0a0a',
              '--spk-color': palette.color,
              '--spk-bg': palette.bg,
            }}
            onMouseDown={(e) => handleSegMouseDown(e, seg, 'move')}
          >
            {/* Edge handles — diarization only */}
            {mode === 'diarization' && (
              <>
                <div className="edge l" onMouseDown={(e) => { e.stopPropagation(); handleSegMouseDown(e, seg, 'l'); }} />
                <div className="edge r" onMouseDown={(e) => { e.stopPropagation(); handleSegMouseDown(e, seg, 'r'); }} />
              </>
            )}

            {!isTiny && (
              <div className="seg-meta">
                <span className="seg-status">{status}</span>
                {seg.flagged && <span className="seg-flag-dot" />}
              </div>
            )}

            {!isTiny && mode === 'transcription' && seg.text && (
              <div className="seg-text">{seg.text}</div>
            )}
            {!isTiny && mode === 'translation' && (
              <>
                {seg.text && <div className="seg-text" style={{ opacity: 0.6, fontStyle: 'italic' }}>{seg.text}</div>}
                {seg.tx && <div className="seg-text-translated">{seg.tx}</div>}
              </>
            )}
            {!isTiny && mode === 'tts' && seg.tx && (
              <div className="seg-text">{seg.tx}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── HistoryPanel ──────────────────────────────────────────────────────────────
function DiarHistoryPanel({ speakers, corrections, flags, segments, activeTab, onTabChange,
  collapsed, onToggleCollapse, onFocusFlag, mode }) {
  if (collapsed) {
    return (
      <aside className="history">
        <div className="history-rail">
          <button className="iconbtn" onClick={onToggleCollapse}>
            <span className="ms sz-20">chevron_left</span>
          </button>
          <div className="vert mono">{speakers.length} SPK</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="history">
      <div className="history-head">
        <div className="tabs">
          <button className={`tab ${activeTab === 'speakers' ? 'active' : ''}`} onClick={() => onTabChange('speakers')}>
            <span className="ms sz-16">group</span><span>Speakers</span>
            <span className="tab-count">{speakers.length}</span>
          </button>
          <button className={`tab ${activeTab === 'corrections' ? 'active' : ''}`} onClick={() => onTabChange('corrections')}>
            <span className="ms sz-16">history</span><span>Edits</span>
            <span className="tab-count">{corrections.length}</span>
          </button>
          <button className={`tab ${activeTab === 'flags' ? 'active' : ''}`} onClick={() => onTabChange('flags')}>
            <span className="ms sz-16">flag</span><span>Flags</span>
            <span className="tab-count">{flags.length}</span>
          </button>
        </div>
        <button className="iconbtn" onClick={onToggleCollapse}>
          <span className="ms sz-18">chevron_right</span>
        </button>
      </div>

      <div className="history-body">
        {activeTab === 'speakers' && (
          speakers.length === 0 ? (
            <div className="history-empty">
              <span className="ms">group</span>
              <div className="title">No speakers yet</div>
              <div className="sub">Speakers appear once diarization runs.</div>
            </div>
          ) : (
            speakers.map((spk) => {
              const palette = getSpeakerPalette(spk._idx ?? 0);
              const turns = segments.filter((s) => s.speaker_id === spk.id).length;
              return (
                <div
                  key={spk.id}
                  className="spk-tab-item"
                  style={{ '--spk-color': palette.color, '--spk-bg': palette.bg, '--spk-border': palette.border }}
                >
                  <div className="spk-tab-avatar">{(spk.name || 'S')[0].toUpperCase()}</div>
                  <div className="spk-tab-meta">
                    <div className="spk-tab-name">{spk.name}</div>
                    <div className="spk-tab-tags">
                      {spk.gender && <span className="spk-tab-tag">{spk.gender}</span>}
                      {spk.age && <span className="spk-tab-tag">{spk.age}</span>}
                    </div>
                  </div>
                  <div className="spk-tab-stats">
                    <div className="turns">{turns}</div>
                    <div>turns</div>
                  </div>
                </div>
              );
            })
          )
        )}

        {activeTab === 'corrections' && (
          corrections.length === 0 ? (
            <div className="history-empty">
              <span className="ms">history</span>
              <div className="title">No edits yet</div>
              <div className="sub">Segment edits will appear here.</div>
            </div>
          ) : (
            corrections.map((c, i) => (
              <div key={i} className="hist-item">
                <div className="dir" style={{ color: 'var(--ins-accent)' }}>
                  <span className="ms sz-14">edit</span>
                </div>
                <div className="info">
                  <div className="desc">{c.desc || 'Edit'}</div>
                  <div className="range">{c.time}</div>
                </div>
              </div>
            ))
          )
        )}

        {activeTab === 'flags' && (
          flags.length === 0 ? (
            <div className="history-empty">
              <span className="ms">flag</span>
              <div className="title">No flags yet</div>
              <div className="sub">Flag segments for review.</div>
            </div>
          ) : (
            flags.map((f) => {
              const spk = speakers.find((s) => s.id === f.speakerId);
              const palette = spk ? getSpeakerPalette(spk._idx ?? 0) : SPEAKER_COLORS[0];
              return (
                <div key={f.id} className="hist-item" onClick={() => onFocusFlag?.(f)} style={{ cursor: 'pointer' }}>
                  <div className="dir flag-dir"><span className="ms sz-14">flag</span></div>
                  <div className="info">
                    <div className="desc"><b>{spk?.name ?? 'Unknown'}</b> · flagged</div>
                    <div className="range">{fmtTCshort(f.start)} – {fmtTCshort(f.end)}</div>
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </aside>
  );
}

// ── ScriptPanel (right panel for stages 3-5) ─────────────────────────────────
function ScriptPanel({ segments, speakers, mode, selectedSegId, onSelect, onTextChange, collapsed, onToggleCollapse }) {
  if (collapsed) {
    return (
      <aside className="history">
        <div className="history-rail">
          <button className="iconbtn" onClick={onToggleCollapse}><span className="ms sz-20">chevron_left</span></button>
          <div className="vert mono">{segments.length} SEG</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="history">
      <div className="history-head">
        <div className="tabs">
          <button className="tab active">
            <span className="ms sz-16">article</span>
            <span>{mode === 'tts' ? 'Audio' : mode === 'translation' ? 'Script' : 'Transcript'}</span>
            <span className="tab-count">{segments.length}</span>
          </button>
        </div>
        <button className="iconbtn" onClick={onToggleCollapse}><span className="ms sz-18">chevron_right</span></button>
      </div>
      <div className="history-body" style={{ overflowY: 'auto' }}>
        {segments.length === 0 && (
          <div className="history-empty">
            <span className="ms">article</span>
            <div className="title">No segments</div>
          </div>
        )}
        {segments.map((seg) => {
          const spk = speakers.find((s) => s.id === seg.speaker_id);
          const palette = spk ? getSpeakerPalette(spk._idx ?? 0) : SPEAKER_COLORS[0];
          const isSelected = seg.id === selectedSegId;

          return (
            <div
              key={seg.id}
              className={`script-row ${isSelected ? 'selected' : ''}`}
              style={{ '--spk-color': palette.color, '--spk-bg': palette.bg }}
              onClick={() => onSelect(seg)}
            >
              <div className="script-row-head">
                <span className="script-row-dot" />
                <span className="script-row-name">{spk?.name ?? 'Unknown'}</span>
                <span className="script-row-tc">{fmtTCshort(seg.start)}</span>
                <span className="script-row-dur">&nbsp;·&nbsp;{(seg.end - seg.start).toFixed(1)}s</span>
              </div>

              {mode === 'transcription' && (
                <div
                  className="script-row-text"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => onTextChange(seg.id, 'text', e.currentTarget.textContent)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {seg.text ?? ''}
                </div>
              )}

              {mode === 'translation' && (
                <>
                  <div className="script-row-pair-label">Source</div>
                  <div className="script-row-text source">{seg.text ?? ''}</div>
                  <div className="script-row-pair-label">Translation</div>
                  <div
                    className="script-row-text target"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => onTextChange(seg.id, 'tx', e.currentTarget.textContent)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {seg.tx ?? ''}
                  </div>
                </>
              )}

              {mode === 'tts' && (
                <>
                  <div className="script-row-text" style={{ cursor: 'default' }}>{seg.tx ?? seg.text ?? ''}</div>
                  <div className="script-row-audio">
                    <button className="play">
                      <span className="ms sz-14">play_arrow</span>
                    </button>
                    <div className={`wave-mini ${seg.audio_url ? '' : 'empty'}`} />
                  </div>
                </>
              )}

              {seg.flagged && (
                <div className="script-row-flag">
                  <span className="ms sz-12">flag</span>flagged
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── TopHeader ─────────────────────────────────────────────────────────────────
const STAGES = [
  { id: 1, label: 'Stems' },
  { id: 2, label: 'Diarization' },
  { id: 3, label: 'Transcribe' },
  { id: 4, label: 'Translate' },
  { id: 5, label: 'TTS' },
  { id: 6, label: 'Lipsync' },
];

function TopHeader({ stageNum, stageLabel, filename, onSave, saving }) {
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
          const cls = s.id < stageNum ? 'done' : s.id === stageNum ? 'current' : 'future';
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
        <button className="btn primary" onClick={onSave} disabled={saving}>
          {saving
            ? <><span className="ms sz-16" style={{ animation: 'spin 1.2s linear infinite' }}>progress_activity</span><span>Saving…</span></>
            : <><span>Save & Continue</span><span className="ms sz-16">arrow_forward</span></>
          }
        </button>
      </div>
    </header>
  );
}

// ── SubstageStrip ─────────────────────────────────────────────────────────────
function SubstageStrip({ mode, stageNum, stageLabel, speakerCount, segCount, flagCount }) {
  const sub = {
    diarization:   'Assign audio segments to named speakers.',
    transcription: 'Review ASR transcripts and correct errors.',
    translation:   'Edit duration-aware translations per segment.',
    tts:           'Generate and review dubbed audio per segment.',
  }[mode] || '';

  return (
    <div className="substage">
      <div className="substage-title">
        <span className="ix">STAGE {stageNum} / 6</span>
        <h1>{stageLabel}</h1>
        <span className="sub">{sub}</span>
      </div>
      <div className="bleed-summary">
        {flagCount > 0 && (
          <div className="stat-chip">
            <span className="ms sz-14" style={{ color: '#fb923c' }}>flag</span>
            <span className="v">{flagCount}</span>
            <span className="stat-label">flags</span>
          </div>
        )}
        <div className="stat-chip">
          <span className="ms sz-14">person</span>
          <span className="v">{speakerCount}</span>
          <span className="stat-label">speakers</span>
        </div>
        <div className="stat-chip">
          <span className="ms sz-14">segment</span>
          <span className="v">{segCount}</span>
          <span className="stat-label">segments</span>
        </div>
      </div>
    </div>
  );
}

// ── Transport ─────────────────────────────────────────────────────────────────
function DiarTransport({ currentTime, duration, playing, onPlayToggle, zoom, onZoomChange,
  onUndo, canUndo, onRedo, canRedo, fps = 24 }) {
  return (
    <div className="transport">
      <div className="transport-left">
        <div className="tc">
          <span className="now">{fmtTC(currentTime, fps)}</span>
          <span className="slash">/</span>
          <span className="total">{fmtTC(duration, fps)}</span>
        </div>
        <button className="tport-btn" disabled={!canUndo} onClick={onUndo} title="Undo">
          <span className="ms sz-18">undo</span>
        </button>
        <button className="tport-btn" disabled={!canRedo} onClick={onRedo} title="Redo">
          <span className="ms sz-18">redo</span>
        </button>
      </div>
      <div className="transport-center">
        <button className="tport-btn" onClick={() => {}}><span className="ms sz-20">first_page</span></button>
        <button
          className={`tport-btn play ${playing ? 'playing' : ''}`}
          onClick={onPlayToggle}
        >
          <span className="ms sz-22">{playing ? 'pause' : 'play_arrow'}</span>
        </button>
        <button className="tport-btn" onClick={() => {}}><span className="ms sz-20">last_page</span></button>
      </div>
      <div className="transport-right">
        <div className="zoom">
          <button className="tport-btn small" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.5))}>
            <span className="ms sz-16">remove</span>
          </button>
          <input type="range" min={0.5} max={8} step={0.1} value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))} className="zoom-slider" />
          <button className="tport-btn small" onClick={() => onZoomChange(Math.min(8, zoom + 0.5))}>
            <span className="ms sz-16">add</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LoadingOverlay ────────────────────────────────────────────────────────────
function LoadingOverlay({ message }) {
  return (
    <div className="overlay">
      <div className="panel" style={{ textAlign: 'center' }}>
        <span className="ms sz-32" style={{ animation: 'spin 1.2s linear infinite', display: 'block', marginBottom: 16, color: 'var(--ins-accent)' }}>
          progress_activity
        </span>
        <h3 style={{ margin: '0 0 8px' }}>{message || 'Processing…'}</h3>
        <p style={{ color: 'var(--white-50)', margin: 0 }}>This may take a few minutes.</p>
      </div>
    </div>
  );
}

function ErrorOverlay({ message, onRetry }) {
  return (
    <div className="overlay error">
      <div className="panel">
        <span className="ms sz-32" style={{ color: '#fca5a5', display: 'block', marginBottom: 12 }}>error</span>
        <h3 style={{ margin: '0 0 8px' }}>Something went wrong</h3>
        <p style={{ color: 'var(--white-50)' }}>{message}</p>
        <button className="btn ghost" onClick={onRetry} style={{ marginTop: 16 }}>
          <span className="ms sz-16">refresh</span>Retry
        </button>
      </div>
    </div>
  );
}

function StartScreen({ stageLabel, stageNum, onStart, loading }) {
  return (
    <div className="overlay">
      <div className="panel" style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="ms sz-32" style={{ color: 'var(--ins-accent)', display: 'block' }}>play_circle</span>
        </div>
        <h3 style={{ margin: '0 0 8px' }}>Ready to run Stage {stageNum}</h3>
        <p style={{ color: 'var(--white-50)', marginBottom: 24 }}>
          Start {stageLabel.toLowerCase()} on this job. Results will appear in the timeline.
        </p>
        <button className="btn primary" onClick={onStart} disabled={loading}>
          {loading
            ? <><span className="ms sz-16" style={{ animation: 'spin 1.2s linear infinite' }}>progress_activity</span><span>Starting…</span></>
            : <><span>Start {stageLabel}</span><span className="ms sz-16">arrow_forward</span></>
          }
        </button>
      </div>
    </div>
  );
}

// ── Main DiarizationEditor ───────────────────────────────────────────────────
export default function DiarizationEditor({ jobId, mode, onConfirm, jobData, vocWave, insWave }) {
  const cfg = STAGE_CONFIG[mode] || STAGE_CONFIG.diarization;
  const D = jobData?.duration_s ?? 120;
  const FPS = jobData?.fps ?? 24;
  const filename = jobData?.source_filename ?? 'Untitled';

  // ── Data state ──────────────────────────────────────────────
  const [speakers, setSpeakers] = useState([]);
  const [segments, setSegments] = useState([]);
  const [loadPhase, setLoadPhase] = useState('init'); // init | starting | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('');

  // ── Snapshot undo/redo ──────────────────────────────────────
  const [snapshots, setSnapshots] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const pushSnapshot = useCallback(() => {
    setSnapshots((prev) => [...prev, { speakers: JSON.parse(JSON.stringify(speakers)), segments: JSON.parse(JSON.stringify(segments)) }]);
    setRedoStack([]);
  }, [speakers, segments]);

  const undoLast = useCallback(() => {
    setSnapshots((prev) => {
      if (!prev.length) return prev;
      const snap = prev[prev.length - 1];
      setRedoStack((r) => [...r, { speakers, segments }]);
      setSpeakers(snap.speakers);
      setSegments(snap.segments);
      return prev.slice(0, -1);
    });
  }, [speakers, segments]);

  const redoLast = useCallback(() => {
    setRedoStack((prev) => {
      if (!prev.length) return prev;
      const snap = prev[prev.length - 1];
      setSnapshots((s) => [...s, { speakers, segments }]);
      setSpeakers(snap.speakers);
      setSegments(snap.segments);
      return prev.slice(0, -1);
    });
  }, [speakers, segments]);

  // ── Edit state ──────────────────────────────────────────────
  const [corrections, setCorrections] = useState([]);
  const [flags, setFlags] = useState([]);
  const [selectedSegId, setSelectedSegId] = useState(null);
  const [editingSeg, setEditingSeg] = useState(null);
  const [mutedSpeakers, setMutedSpeakers] = useState(new Set());
  const [soloedSpeakers, setSoloedSpeakers] = useState(new Set());

  // ── Playback (simple placeholder — no audio in this editor) ──
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // ── Viewport ────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1.4);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(800);
  const laneColRef = useRef(null);
  const _wheelState = useRef({ contentWidth: 0, viewportWidth: 0 });

  const pxPerSec = 8 * zoom;
  const contentWidth = D * pxPerSec;

  useLayoutEffect(() => {
    if (!laneColRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setViewportWidth(e.contentRect.width);
    });
    obs.observe(laneColRef.current);
    return () => obs.disconnect();
  }, []);

  _wheelState.current = { contentWidth, viewportWidth };

  useEffect(() => {
    const el = laneColRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((z) => Math.max(0.5, Math.min(8, z - e.deltaY * 0.04)));
      } else {
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        if (Math.abs(dx) < 0.5) return;
        const { contentWidth: cw, viewportWidth: vw } = _wheelState.current;
        setScrollLeft((s) => Math.max(0, Math.min(Math.max(0, cw - vw), s + dx)));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Panel state ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('speakers');
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Polling ref ─────────────────────────────────────────────
  const pollRef = useRef(null);

  // ── Load data on mount ───────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    loadData();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoadPhase('loading');
    try {
      const data = await cfg.get(jobId);

      if (data.status === 'pending' || data.status === undefined) {
        setLoadPhase('pending');
        return;
      }

      if (data.status === 'running' || data.status === 'processing') {
        setLoadPhase('running');
        startPolling();
        return;
      }

      if (data.status === 'error' || data.status === 'failed') {
        setErrorMsg(data.error || 'Stage failed');
        setLoadPhase('error');
        return;
      }

      // ready / done
      const spks = (data.speakers ?? []).map((s, i) => ({ ...s, _idx: i }));
      setSpeakers(spks);
      setSegments(data.segments ?? []);
      setLoadPhase('ready');
    } catch (err) {
      // If 404 / no data yet — show start screen
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        setLoadPhase('pending');
      } else {
        setErrorMsg(err.message);
        setLoadPhase('error');
      }
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await cfg.get(jobId);
        if (data.status !== 'running' && data.status !== 'processing') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (data.status === 'ready' || data.status === 'done') {
            const spks = (data.speakers ?? []).map((s, i) => ({ ...s, _idx: i }));
            setSpeakers(spks);
            setSegments(data.segments ?? []);
            setLoadPhase('ready');
          } else {
            setErrorMsg(data.error || 'Stage failed');
            setLoadPhase('error');
          }
        }
      } catch {}
    }, 3000);
  }

  async function handleStart() {
    setLoadPhase('starting');
    try {
      await cfg.run(jobId);
      setLoadPhase('running');
      startPolling();
    } catch (err) {
      setErrorMsg(err.message);
      setLoadPhase('error');
    }
  }

  // ── Save & Continue ──────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      await cfg.confirm(jobId, speakers, segments);
      onConfirm?.(speakers, segments);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Mutations ────────────────────────────────────────────────
  const updateSegment = (id, patch, { record = true } = {}) => {
    if (record) pushSnapshot();
    setSegments((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
    if (record) {
      setCorrections((prev) => [
        { desc: `Edited segment`, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 49),
      ]);
    }
  };

  const deleteSegment = (id) => {
    pushSnapshot();
    setSegments((prev) => prev.filter((s) => s.id !== id));
    setSelectedSegId(null);
    setCorrections((prev) => [{ desc: 'Deleted segment', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)]);
  };

  const splitSegment = (id) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const mid = (seg.start + seg.end) / 2;
    pushSnapshot();
    setSegments((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const newSegs = [...prev];
      newSegs.splice(idx, 1,
        { ...seg, id: `${id}_a`, end: mid },
        { ...seg, id: `${id}_b`, start: mid }
      );
      return newSegs;
    });
    setSelectedSegId(null);
  };

  const reassignSegment = (segId, newSpeakerId) => {
    pushSnapshot();
    setSegments((prev) => prev.map((s) => s.id === segId ? { ...s, speaker_id: newSpeakerId } : s));
    setSelectedSegId(null);
    setCorrections((prev) => [{ desc: 'Reassigned segment', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)]);
  };

  const toggleFlag = (segId) => {
    const seg = segments.find((s) => s.id === segId);
    if (!seg) return;
    updateSegment(segId, { flagged: !seg.flagged }, { record: false });
    if (!seg.flagged) {
      setFlags((prev) => [...prev, { id: segId, speakerId: seg.speaker_id, start: seg.start, end: seg.end }]);
    } else {
      setFlags((prev) => prev.filter((f) => f.id !== segId));
    }
  };

  const updateSpeakerName = (spkId, name) => {
    setSpeakers((prev) => prev.map((s) => s.id === spkId ? { ...s, name } : s));
  };

  const addSpeaker = () => {
    const newId = `spk_${Date.now()}`;
    setSpeakers((prev) => [...prev, { id: newId, name: `Speaker ${prev.length + 1}`, _idx: prev.length }]);
  };

  const selectedSeg = segments.find((s) => s.id === selectedSegId) || null;
  const selectedSpeaker = selectedSeg ? speakers.find((s) => s.id === selectedSeg.speaker_id) : null;

  // Speaker lane top position for FAB
  const REF_LANE_H = 58, DIVIDER_H = 28, RULER_H = 36;
  const getSpeakerLaneTop = (spkIdx) => {
    return RULER_H + REF_LANE_H * 2 + DIVIDER_H + spkIdx * 64;
  };
  const selectedSpkIdx = selectedSpeaker ? speakers.indexOf(selectedSpeaker) : 0;
  const fabLaneTop = getSpeakerLaneTop(selectedSpkIdx);

  // ── Keyboard ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return;
      if (e.key === 'Escape') { setSelectedSegId(null); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSegId && mode === 'diarization') { e.preventDefault(); deleteSegment(selectedSegId); }
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) redoLast(); else undoLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSegId, mode, undoLast, redoLast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mute / solo logic ─────────────────────────────────────────
  const isMuted = (spkId) => {
    if (soloedSpeakers.size > 0 && !soloedSpeakers.has(spkId)) return true;
    return mutedSpeakers.has(spkId);
  };

  const toggleMute = (spkId) => {
    setMutedSpeakers((prev) => {
      const n = new Set(prev);
      if (n.has(spkId)) n.delete(spkId); else n.add(spkId);
      return n;
    });
  };

  const toggleSolo = (spkId) => {
    setSoloedSpeakers((prev) => {
      const n = new Set(prev);
      if (n.has(spkId)) n.delete(spkId); else n.add(spkId);
      return n;
    });
  };

  const flagCount = flags.length;

  // ── Render loading states ─────────────────────────────────────
  const renderOverlay = () => {
    if (loadPhase === 'init' || loadPhase === 'loading') {
      return <LoadingOverlay message="Loading…" />;
    }
    if (loadPhase === 'starting') {
      return <LoadingOverlay message="Starting…" />;
    }
    if (loadPhase === 'running') {
      return <LoadingOverlay message={`Running ${cfg.label}…`} />;
    }
    if (loadPhase === 'pending') {
      return <StartScreen stageLabel={cfg.label} stageNum={cfg.num} onStart={handleStart} loading={false} />;
    }
    if (loadPhase === 'error') {
      return <ErrorOverlay message={errorMsg} onRetry={loadData} />;
    }
    return null;
  };

  return (
    <div className="app app-diar">
      <TopHeader
        stageNum={cfg.num}
        stageLabel={cfg.label}
        filename={filename}
        onSave={handleSave}
        saving={saving}
      />

      <SubstageStrip
        mode={mode}
        stageNum={cfg.num}
        stageLabel={cfg.label}
        speakerCount={speakers.length}
        segCount={segments.length}
        flagCount={flagCount}
      />

      <DiarTransport
        currentTime={currentTime}
        duration={D}
        playing={playing}
        onPlayToggle={() => setPlaying((v) => !v)}
        zoom={zoom}
        onZoomChange={setZoom}
        onUndo={undoLast}
        canUndo={snapshots.length > 0}
        onRedo={redoLast}
        canRedo={redoStack.length > 0}
        fps={FPS}
      />

      <div className={`body ${historyCollapsed ? 'history-collapsed' : ''}`}>
        <div className="workspace">
          <div className="timeline">

            {/* ── Rail column ── */}
            <div className="rail-col">
              {/* Rail head */}
              <div className="rail-head">
                <span className="caps">TRACKS</span>
              </div>

              {/* Reference rails section header */}
              <div className="rail-section-head">
                Reference
              </div>

              {/* Vocals reference rail */}
              <div className="rail-ref voc">
                <div className="rail-avatar">V</div>
                <div className="rail-meta">
                  <div className="rail-label">Vocals</div>
                  <div className="rail-sublabel">Reference</div>
                </div>
                <span className="rail-lock ms sz-14">lock</span>
              </div>

              {/* Instrumental reference rail */}
              <div className="rail-ref ins">
                <div className="rail-avatar">I</div>
                <div className="rail-meta">
                  <div className="rail-label">Instrumental</div>
                  <div className="rail-sublabel">Reference</div>
                </div>
                <span className="rail-lock ms sz-14">lock</span>
              </div>

              {/* Speakers section header */}
              <div className="rail-section-head">
                Speakers
                <button className="add-speaker" onClick={addSpeaker} title="Add speaker">
                  <span className="ms sz-14">add</span>
                </button>
              </div>

              {/* Speaker rails */}
              {speakers.map((spk, i) => {
                const palette = getSpeakerPalette(spk._idx ?? i);
                const segCount = segments.filter((s) => s.speaker_id === spk.id).length;
                return (
                  <SpeakerRail
                    key={spk.id}
                    speaker={spk}
                    palette={palette}
                    mode={mode}
                    segCount={segCount}
                    muted={isMuted(spk.id)}
                    soloed={soloedSpeakers.has(spk.id)}
                    onToggleMute={() => toggleMute(spk.id)}
                    onToggleSolo={() => toggleSolo(spk.id)}
                    onNameChange={(name) => updateSpeakerName(spk.id, name)}
                    onGenerate={() => {/* future: trigger per-speaker generation */}}
                  />
                );
              })}
            </div>

            {/* ── Lane column ── */}
            <div className="lane-col" ref={laneColRef}>
              {/* Ruler */}
              <div className="ruler-wrap" onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const t = (e.clientX - rect.left + scrollLeft) / pxPerSec;
                setCurrentTime(Math.max(0, Math.min(D, t)));
              }} style={{ cursor: 'ew-resize' }}>
                <Ruler contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} duration={D} fps={FPS} />
              </div>

              {/* Vocals reference lane */}
              <div className="lane-ref voc">
                <MiniWaveform data={vocWave} color="rgba(96,165,250,0.6)" />
              </div>

              {/* Instrumental reference lane */}
              <div className="lane-ref ins">
                <MiniWaveform data={insWave} color="rgba(94,234,212,0.6)" />
              </div>

              {/* Divider */}
              <div className="lanes-divider">
                <div className="pulse" />
                <span>Speakers</span>
                <span className="count">{speakers.length} tracks · {segments.length} segs</span>
              </div>

              {/* Speaker lanes */}
              {speakers.map((spk, i) => {
                const palette = getSpeakerPalette(spk._idx ?? i);
                const spkSegs = segments.filter((s) => s.speaker_id === spk.id);
                return (
                  <SpeakerLane
                    key={spk.id}
                    speaker={spk}
                    palette={palette}
                    segments={spkSegs}
                    duration={D}
                    pxPerSec={pxPerSec}
                    scrollLeft={scrollLeft}
                    viewportWidth={viewportWidth}
                    selectedSegId={selectedSegId}
                    onSegClick={(seg) => setSelectedSegId(seg.id === selectedSegId ? null : seg.id)}
                    onSegDragEnd={(segId, patch) => updateSegment(segId, patch, { record: !patch.provisional })}
                    mode={mode}
                    muted={isMuted(spk.id)}
                  />
                );
              })}

              {/* Playhead */}
              <Playhead currentTime={currentTime} pxPerSec={pxPerSec} scrollLeft={scrollLeft} viewportWidth={viewportWidth} />

              {/* Segment FAB */}
              {selectedSeg && selectedSpeaker && (
                <SegmentFAB
                  seg={selectedSeg}
                  speaker={selectedSpeaker}
                  mode={mode}
                  pxPerSec={pxPerSec}
                  scrollLeft={scrollLeft}
                  viewportWidth={viewportWidth}
                  laneTop={fabLaneTop}
                  speakers={speakers}
                  isFlagged={!!selectedSeg.flagged}
                  onEdit={() => setEditingSeg(selectedSeg)}
                  onSplit={() => splitSegment(selectedSeg.id)}
                  onDelete={() => deleteSegment(selectedSeg.id)}
                  onReassign={(newSpkId) => reassignSegment(selectedSeg.id, newSpkId)}
                  onRegen={() => {/* TODO: per-segment regen */}}
                  onFlag={() => toggleFlag(selectedSeg.id)}
                  onPlay={() => {
                    const url = ttsAudioUrl(jobId, selectedSeg.id);
                    new Audio(url).play().catch(() => {});
                  }}
                  onDismiss={() => setSelectedSegId(null)}
                />
              )}

              {/* Scrollbar */}
              <Scrollbar
                contentWidth={contentWidth}
                viewportWidth={viewportWidth}
                scrollLeft={scrollLeft}
                onScroll={setScrollLeft}
              />
            </div>
          </div>
        </div>

        {/* Right panel */}
        {mode === 'diarization' ? (
          <DiarHistoryPanel
            speakers={speakers}
            corrections={corrections}
            flags={flags}
            segments={segments}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            collapsed={historyCollapsed}
            onToggleCollapse={() => setHistoryCollapsed((v) => !v)}
            mode={mode}
            onFocusFlag={(f) => {
              setSelectedSegId(f.id);
              setCurrentTime(f.start);
            }}
          />
        ) : (
          <ScriptPanel
            segments={segments}
            speakers={speakers}
            mode={mode}
            selectedSegId={selectedSegId}
            onSelect={(seg) => { setSelectedSegId(seg.id); setCurrentTime(seg.start); }}
            onTextChange={(segId, field, val) => updateSegment(segId, { [field]: val }, { record: false })}
            collapsed={historyCollapsed}
            onToggleCollapse={() => setHistoryCollapsed((v) => !v)}
          />
        )}
      </div>

      {/* Edit text overlay */}
      {editingSeg && selectedSpeaker && (
        <EditOverlay
          seg={editingSeg}
          speaker={selectedSpeaker}
          mode={mode}
          onSave={(val) => {
            const field = (mode === 'translation' || mode === 'tts') ? 'tx' : 'text';
            updateSegment(editingSeg.id, { [field]: val });
            setEditingSeg(null);
          }}
          onCancel={() => setEditingSeg(null)}
        />
      )}

      {/* Loading / start overlay */}
      {renderOverlay()}
    </div>
  );
}
