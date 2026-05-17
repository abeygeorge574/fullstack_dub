import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { fmtTC } from '../utils/timecode.js';
import { Lane } from './Waveform.jsx';
import { saveCorrections, saveFlags, confirmStems, renameTrack, audioUrl, exportUrl } from '../api.js';
import { AudioEngine } from '../audio/AudioEngine.js';

const STAGES = [
  { id: 1, label: 'Stems' },
  { id: 2, label: 'Diarization' },
  { id: 3, label: 'Transcribe' },
  { id: 4, label: 'Translate' },
  { id: 5, label: 'TTS' },
  { id: 6, label: 'Lipsync' },
];

const TRACK_LABEL = { voc: 'EL Vocals', htd: 'HTDemucs', ins: 'Instrumental' };
const TRACK_ICON  = { voc: 'mic', htd: 'merge', ins: 'music_note' };

// Destination options for each source track
const MOVE_OPTS = {
  voc: [
    { id: 'htd', label: 'HTDemucs', key: 'H', icon: 'merge',      color: 'rgba(167,139,250,0.20)', border: 'rgba(167,139,250,0.5)', text: '#a78bfa' },
    { id: 'ins', label: 'Instrumental', key: 'I', icon: 'south',   color: 'rgba(94,234,212,0.14)',  border: 'rgba(94,234,212,0.4)',  text: '#5eead4' },
  ],
  htd: [
    { id: 'voc', label: 'EL Vocals',   key: 'V', icon: 'north',   color: 'rgba(96,165,250,0.14)',  border: 'rgba(96,165,250,0.4)',  text: '#7dbcff' },
    { id: 'ins', label: 'Instrumental', key: 'I', icon: 'south',   color: 'rgba(94,234,212,0.14)',  border: 'rgba(94,234,212,0.4)',  text: '#5eead4' },
  ],
  ins: [
    { id: 'voc', label: 'EL Vocals',   key: 'V', icon: 'north',   color: 'rgba(96,165,250,0.14)',  border: 'rgba(96,165,250,0.4)',  text: '#7dbcff' },
    { id: 'htd', label: 'HTDemucs',    key: 'H', icon: 'merge',   color: 'rgba(167,139,250,0.20)', border: 'rgba(167,139,250,0.5)', text: '#a78bfa' },
  ],
};

// ── TopHeader ──────────────────────────────────────────────────
function TopHeader({ confirmed, onConfirm, filename }) {
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
          const cls = i + 1 === 1 ? 'current' : 'future';
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
        <button
          className="btn primary"
          disabled={!confirmed}
          onClick={confirmed ? onConfirm : undefined}
          title={confirmed ? 'Save & continue' : 'Mark as reviewed first'}
        >
          <span>Save & Continue</span>
          <span className="ms sz-16">arrow_forward</span>
        </button>
      </div>
    </header>
  );
}

// ── SubstageStrip ──────────────────────────────────────────────
function SubstageStrip({ stats, confirmed, onConfirmToggle, onFocusCorrections, onFocusFlags, onProjectAction }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e) => { if (!actionsRef.current?.contains(e.target)) setActionsOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [actionsOpen]);

  return (
    <div className="substage">
      <div className="substage-title">
        <span className="ix">STAGE 1 / 6</span>
        <h1>Stem Separation Review</h1>
        <span className="sub">Review all three tracks, move audio between them, then pick your vocal track.</span>
      </div>
      <div className="bleed-summary">
        <button className="stat-chip" onClick={onFocusFlags}>
          <span className="ms sz-14" style={{ color: '#fb923c' }}>flag</span>
          <span className="v">{stats.flags}</span>
          <span className="stat-label">flags</span>
        </button>
        <div className="divider-v tall" />
        <button className="stat-chip" onClick={onFocusCorrections}>
          <span className="ms sz-14">swap_horiz</span>
          <span className="v">{stats.corrections}</span>
          <span className="stat-label">corrections</span>
        </button>
      </div>
      <div className="substage-right">
        <button
          className={`mark-toggle ${confirmed ? 'on' : ''}`}
          onClick={onConfirmToggle}
          title={confirmed ? 'Mark as not reviewed' : 'Mark as reviewed'}
        >
          <div className={`mark-box ${confirmed ? 'on' : ''}`}>
            {confirmed && <span className="ms sz-14">check</span>}
          </div>
          <span>Reviewed</span>
        </button>
        <div className="project-actions" ref={actionsRef}>
          <button className="btn ghost" onClick={() => setActionsOpen((v) => !v)}>
            <span className="ms sz-16">more_horiz</span>
            <span>Project</span>
          </button>
          {actionsOpen && (
            <div className="rail-menu project-menu" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rail-menu-head"><div className="rail-menu-name">Project actions</div></div>
              <button className="rail-menu-item" onClick={() => { setActionsOpen(false); onProjectAction?.('export-both'); }}>
                <span className="ms sz-16">file_download</span>
                <span>Export both stems</span>
              </button>
              <div className="rail-menu-sep" />
              <button className="rail-menu-item" onClick={() => { setActionsOpen(false); onProjectAction?.('new-upload'); }}>
                <span className="ms sz-16">upload_file</span>
                <span>New upload</span>
              </button>
              <button className="rail-menu-item danger" onClick={() => { setActionsOpen(false); onProjectAction?.('re-separate'); }}>
                <span className="ms sz-16">refresh</span>
                <span>Re-run separation</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ruler ──────────────────────────────────────────────────────
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
    ticks.push(<div key={`t-${t}`} className={`tick ${isMajor ? '' : 'minor'}`} style={{ left: x }} />);
    if (isMajor) ticks.push(<div key={`l-${t}`} className="tlabel" style={{ left: x }}>{fmtTC(t, fps)}</div>);
  }
  return <div className="ruler"><div className="tickwrap">{ticks}</div></div>;
}

// ── TrackRail ──────────────────────────────────────────────────
function TrackRail({ trackId, label, sublabel, muted, soloed, onToggleMute, onToggleSolo, jobId, isWinner, onSelectWinner }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(label);
  const rootRef = useRef(null);

  const canRename = trackId === 'voc' || trackId === 'ins';
  const canSolo   = trackId === 'voc' || trackId === 'ins';
  const STEM_MAP  = { voc: 'vocals', htd: 'htdemucs_vocals', ins: 'instrumental' };
  const FILE_MAP  = { voc: 'vocals.wav', htd: 'htdemucs_vocals.wav', ins: 'instrumental.wav' };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setMenuOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const handleRename = async () => {
    const v = renameVal.trim();
    if (!v) return;
    try { await renameTrack(jobId, trackId, v); } catch {}
    setRenaming(false);
    setMenuOpen(false);
  };

  const handleExport = () => {
    const a = document.createElement('a');
    a.href = exportUrl(jobId, STEM_MAP[trackId] || trackId);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setMenuOpen(false);
  };

  const avatarLetter = trackId === 'voc' ? 'V' : trackId === 'htd' ? 'H' : 'I';

  return (
    <div className={`rail ${trackId}`} ref={rootRef}>
      <div className="rail-avatar">{avatarLetter}</div>
      <div className="rail-meta">
        {renaming ? (
          <input
            className="meta-select"
            style={{ width: '100%' }}
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
            onBlur={handleRename}
            autoFocus
          />
        ) : (
          <div className="rail-label">{label}</div>
        )}
        <div className="rail-sublabel">{sublabel}</div>
      </div>
      <div className="rail-controls">
        {/* Winner radio — shown on vocal tracks */}
        {onSelectWinner && (
          <button
            className={`tiny-toggle winner-radio ${isWinner ? 'active winner' : ''}`}
            onClick={onSelectWinner}
            title={isWinner ? 'Selected for diarization output' : 'Use this vocal track for output'}
          >
            <span className="ms sz-16">{isWinner ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
          </button>
        )}
        {/* Fixed output indicator for instrumental */}
        {trackId === 'ins' && (
          <span className="caps rail-output-tag">OUT</span>
        )}
        <button className={`tiny-toggle ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen((v) => !v)}>
          <span className="ms sz-14">more_horiz</span>
        </button>
        <button className={`tiny-toggle ${muted ? 'active mute' : ''}`} onClick={onToggleMute} title={muted ? 'Unmute' : 'Mute'}>
          <span className="ms sz-16">{muted ? 'volume_off' : 'volume_up'}</span>
        </button>
        {canSolo && (
          <button className={`tiny-toggle solo ${soloed ? 'active' : ''}`} onClick={onToggleSolo}>S</button>
        )}
        {menuOpen && (
          <div className="rail-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="rail-menu-head">
              <div className="rail-menu-name">{label} stem</div>
              <div className="rail-menu-file mono">{FILE_MAP[trackId]}</div>
            </div>
            {canRename && (
              <button className="rail-menu-item" onClick={() => { setRenaming(true); setMenuOpen(false); }}>
                <span className="ms sz-16">drive_file_rename_outline</span>
                <span>Rename track</span>
              </button>
            )}
            <button className="rail-menu-item" onClick={handleExport}>
              <span className="ms sz-16">file_download</span>
              <span>Export stem as WAV</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transport ──────────────────────────────────────────────────
function Transport({
  playing, onPlayToggle, audioReady,
  currentTime, duration, fps,
  onStepFrame, onJumpEdge,
  zoom, onZoomChange, zoomMin, zoomMax,
  onShowShortcuts, onUndo, canUndo, onRedo, canRedo,
}) {
  return (
    <div className="transport">
      <div className="transport-left">
        <div className="tc">
          <span className="now">{fmtTC(currentTime, fps)}</span>
          <span className="slash">/</span>
          <span className="total">{fmtTC(duration, fps)}</span>
        </div>
        <button className="tport-btn" disabled={!canUndo} onClick={onUndo} title="Undo (Z)">
          <span className="ms sz-18">undo</span>
        </button>
        <button className="tport-btn" disabled={!canRedo} onClick={onRedo} title="Redo (⇧Z)">
          <span className="ms sz-18">redo</span>
        </button>
      </div>
      <div className="transport-center">
        <button className="tport-btn" onClick={() => onJumpEdge('start')}><span className="ms sz-20">first_page</span></button>
        <button className="tport-btn" onClick={() => onStepFrame(-1)}><span className="ms sz-20">skip_previous</span></button>
        <button
          className={`tport-btn play ${playing ? 'playing' : ''}`}
          onClick={onPlayToggle}
          disabled={!audioReady}
          title={audioReady ? (playing ? 'Pause (Space)' : 'Play (Space)') : 'Loading audio…'}
        >
          {!audioReady
            ? <span className="ms sz-22" style={{ animation: 'spin 1.2s linear infinite' }}>progress_activity</span>
            : <span className="ms sz-22">{playing ? 'pause' : 'play_arrow'}</span>
          }
        </button>
        <button className="tport-btn" onClick={() => onStepFrame(1)}><span className="ms sz-20">skip_next</span></button>
        <button className="tport-btn" onClick={() => onJumpEdge('end')}><span className="ms sz-20">last_page</span></button>
      </div>
      <div className="transport-right">
        <div className="zoom">
          <button className="tport-btn small" onClick={() => onZoomChange(Math.max(zoomMin, zoom - 0.5))}>
            <span className="ms sz-16">remove</span>
          </button>
          <input type="range" min={zoomMin} max={zoomMax} step={0.1} value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))} className="zoom-slider" />
          <button className="tport-btn small" onClick={() => onZoomChange(Math.min(zoomMax, zoom + 0.5))}>
            <span className="ms sz-16">add</span>
          </button>
        </div>
        <div className="divider-v tall" />
        <button className="tport-btn" onClick={onShowShortcuts}><span className="ms sz-18">keyboard</span></button>
      </div>
    </div>
  );
}

// ── SelectionFab ───────────────────────────────────────────────
function SelectionFab({ selection, isFlagged, xOf, scrollLeft, viewportWidth, fabTop, onMoveTo, onFlag, onDelete, onDismiss }) {
  if (!selection || selection.dragging) return null;
  const dur = Math.abs(selection.end - selection.start);
  if (dur < 0.05) return null;

  const tid = selection.trackId;
  const dests = MOVE_OPTS[tid] || [];
  const ACCENT = { voc: '#7dbcff', htd: '#a78bfa', ins: '#5eead4' };

  const a = xOf(Math.min(selection.start, selection.end)) - scrollLeft;
  const b = xOf(Math.max(selection.start, selection.end)) - scrollLeft;
  const mid = (a + b) / 2;
  const fabWidth = 480;
  const fabLeft = Math.max(8, Math.min(viewportWidth - fabWidth - 8, mid - fabWidth / 2));

  return (
    <div className="fab" style={{ left: fabLeft, top: fabTop }} onMouseDown={(e) => e.stopPropagation()}>
      <span className="arrow" style={{ background: ACCENT[tid] || 'var(--fg)', color: '#022' }}>
        <span className="ms sz-14">swap_horiz</span>
      </span>
      <div className="fab-info">
        <div className="range mono">{dur.toFixed(2)}s</div>
      </div>

      {dests.map((d) => (
        <button
          key={d.id}
          className="go"
          style={{ background: d.color, border: `1px solid ${d.border}`, color: d.text }}
          onClick={() => onMoveTo(d.id)}
        >
          <span className="ms sz-14">{d.icon}</span>
          <span>→ {d.label}</span>
          <span className="kbd" style={{ background: 'rgba(0,0,0,0.15)', color: d.text }}>{d.key}</span>
        </button>
      ))}

      <button className={`fab-secondary ${isFlagged ? 'is-flagged' : ''}`} onClick={onFlag}>
        <span className="ms sz-14">{isFlagged ? 'close' : 'flag'}</span>
        <span>{isFlagged ? 'Unflag' : 'Flag'}</span>
        <span className="kbd">F</span>
      </button>
      <button className="fab-delete" onClick={onDelete}>
        <span className="ms sz-14">delete</span>
        <span>Delete</span>
        <span className="kbd">D</span>
      </button>
      <button className="x" onClick={onDismiss}><span className="ms sz-16">close</span></button>
    </div>
  );
}

// ── HistoryPanel ───────────────────────────────────────────────
function HistoryPanel({ corrections, flags, onUndo, onRemoveFlag, onFocusFlag, onFocusCorrection, activeTab, onTabChange, collapsed, onToggleCollapse, fps = 24 }) {
  if (collapsed) {
    return (
      <aside className="history">
        <div className="history-rail">
          <button className="iconbtn" onClick={onToggleCollapse}><span className="ms sz-20">chevron_left</span></button>
          <div className="vert mono">{corrections.length + flags.length} ITEMS</div>
        </div>
      </aside>
    );
  }
  const items = activeTab === 'corrections' ? corrections : flags;
  return (
    <aside className="history">
      <div className="history-head">
        <div className="tabs">
          <button className={`tab ${activeTab === 'corrections' ? 'active' : ''}`} onClick={() => onTabChange('corrections')}>
            <span className="ms sz-16">history</span><span>Corrections</span>
            <span className="tab-count">{corrections.length}</span>
          </button>
          <button className={`tab ${activeTab === 'flags' ? 'active' : ''}`} onClick={() => onTabChange('flags')}>
            <span className="ms sz-16">flag</span><span>Flags</span>
            <span className="tab-count">{flags.length}</span>
          </button>
        </div>
        <button className="iconbtn" onClick={onToggleCollapse}><span className="ms sz-18">chevron_right</span></button>
      </div>
      <div className="history-body">
        {items.length === 0 ? (
          <div className="history-empty">
            <span className="ms">{activeTab === 'flags' ? 'flag' : 'drag_indicator'}</span>
            <div className="title">{activeTab === 'flags' ? 'No flags yet' : 'No corrections yet'}</div>
            <div className="sub">
              {activeTab === 'flags'
                ? 'Drag-select a range, then press F or click Flag.'
                : 'Drag-select a range on any waveform, then move or delete it.'}
            </div>
          </div>
        ) : activeTab === 'corrections' ? (
          corrections.map((c) => (
            <div key={c.id} className="hist-item" onClick={() => onFocusCorrection?.(c)}>
              <div className={`dir from-${c.from}`}>
                <span className="ms sz-14">{TRACK_ICON[c.from] || 'swap_horiz'}</span>
              </div>
              <div className="info">
                <div className="desc">
                  <b>{TRACK_LABEL[c.from] || c.from}</b>
                  <span style={{ color: 'var(--white-50)' }}> → </span>
                  <b>{c.to ? (TRACK_LABEL[c.to] || c.to) : 'Deleted'}</b>
                </div>
                <div className="range">{fmtTC(c.start, fps)} – {fmtTC(c.end, fps)}<span style={{ marginLeft: 6, opacity: 0.7 }}>· {(c.end - c.start).toFixed(2)}s</span></div>
              </div>
              <div className="actions">
                <button className="undo" onClick={(e) => { e.stopPropagation(); onUndo(c.id); }}><span className="ms sz-14">undo</span></button>
              </div>
            </div>
          ))
        ) : (
          flags.map((f) => (
            <div key={f.id} className="hist-item" onClick={() => onFocusFlag?.(f)}>
              <div className="dir flag-dir"><span className="ms sz-14">flag</span></div>
              <div className="info">
                <div className="desc"><b>{TRACK_LABEL[f.trackId] || f.trackId}</b><span style={{ color: 'var(--white-50)' }}> · flagged</span></div>
                <div className="range">{fmtTC(f.start, fps)} – {fmtTC(f.end, fps)}<span style={{ marginLeft: 6, opacity: 0.7 }}>· {(f.end - f.start).toFixed(2)}s</span></div>
              </div>
              <div className="actions">
                <button className="undo" onClick={(e) => { e.stopPropagation(); onRemoveFlag(f.id); }}><span className="ms sz-14">close</span></button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ── ShortcutsPopover ───────────────────────────────────────────
function ShortcutsPopover() {
  return (
    <div className="shortcuts-pop">
      <h4>Keyboard</h4>
      {[
        { lbl: 'Play / pause',             keys: ['Space'] },
        { lbl: 'Step ±1 frame',            keys: ['←', '→'] },
        { lbl: 'Move to EL Vocals',        keys: ['V'] },
        { lbl: 'Move to HTDemucs Vocals',  keys: ['H'] },
        { lbl: 'Move to Instrumental',     keys: ['I'] },
        { lbl: 'Delete selection',         keys: ['D'] },
        { lbl: 'Flag selection',           keys: ['F'] },
        { lbl: 'Undo',                     keys: ['Z'] },
        { lbl: 'Redo',                     keys: ['⇧Z', 'Y'] },
        { lbl: 'Clear selection',          keys: ['Esc'] },
      ].map((r, i) => (
        <div className="row" key={i}>
          <span>{r.lbl}</span>
          <span className="keys">{r.keys.map((k, j) => <span key={j} className="kbd solid">{k}</span>)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Playhead ───────────────────────────────────────────────────
function Playhead({ currentTime, pxPerSec, scrollLeft, viewportWidth, fps = 24 }) {
  const x = currentTime * pxPerSec - scrollLeft;
  if (x < -2 || x > viewportWidth + 2) return null;
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="cap" />
      <div className="time mono">{fmtTC(currentTime, fps)}</div>
    </div>
  );
}

// ── Scrollbar ──────────────────────────────────────────────────
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
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const travel = trackW - thumbW;
    if (travel <= 0) return;
    onScroll(Math.max(0, Math.min(maxScroll, dragRef.current.startScroll + (dx / travel) * maxScroll)));
  };
  const endDrag = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', endDrag); };
  const onTrackClick = (e) => {
    if (e.target.classList.contains('scroll-thumb')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const travel = trackW - thumbW;
    const target = Math.max(0, Math.min(travel, e.clientX - rect.left - thumbW / 2));
    onScroll((target / travel) * maxScroll);
  };

  return (
    <div className="scroll-track" onMouseDown={onTrackClick} style={{ left: pad, right: pad }}>
      <div className="scroll-thumb" onMouseDown={startDrag} style={{ left: thumbLeft, width: thumbW }} />
    </div>
  );
}

// ── SaveContinueModal ──────────────────────────────────────────
function SaveContinueModal({ stats, flags, jobId, vocalWinner, onVocalWinnerChange, hasHtd, onCancel }) {
  const [phase, setPhase] = useState('review');
  const totalFlags = flags.length;

  const handleConfirm = async () => {
    setPhase('saving');
    try { await confirmStems(jobId, vocalWinner); } catch (err) { console.error('[confirm-stems]', err); }
    setPhase('done');
  };

  const winnerLabel = vocalWinner === 'htd' ? 'HTDemucs Vocals' : 'ElevenLabs Vocals';
  const winnerIcon  = vocalWinner === 'htd' ? 'merge' : 'mic';
  const winnerColor = vocalWinner === 'htd' ? '#a78bfa' : '#7dbcff';

  return (
    <div className="modal-scrim" onMouseDown={onCancel}>
      <div className="save-modal" onMouseDown={(e) => e.stopPropagation()}>
        {phase === 'review' && (
          <>
            <div className="save-modal-art">
              <div className="ribbon">
                <div className="ribbon-track ribbon-voc">
                  <div className="ribbon-bar" style={{ left: '10%', width: '18%' }} />
                  <div className="ribbon-bar dimmed" style={{ left: '32%', width: '14%' }} />
                  <div className="ribbon-bar" style={{ left: '50%', width: '22%' }} />
                </div>
                <div className="ribbon-track ribbon-ins">
                  <div className="ribbon-bar" style={{ left: '4%', width: '94%' }} />
                </div>
                <div className="ribbon-check"><span className="ms sz-22">check</span></div>
              </div>
            </div>
            <h3>Lock in stem assignments?</h3>
            <p>Your corrections become the source-of-truth for downstream stages.</p>

            {/* Vocal track winner selection */}
            {hasHtd && (
              <div className="vocal-winner-section">
                <div className="vocal-winner-label caps" style={{ marginBottom: 8, color: 'var(--white-50)' }}>Vocal track for diarization</div>
                <div className="vocal-winner-options">
                  {[
                    { id: 'voc', label: 'ElevenLabs Vocals', icon: 'mic', color: '#7dbcff' },
                    { id: 'htd', label: 'HTDemucs Vocals',   icon: 'merge', color: '#a78bfa' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      className={`vocal-winner-btn ${vocalWinner === opt.id ? 'active' : ''}`}
                      onClick={() => onVocalWinnerChange(opt.id)}
                      style={{ '--winner-color': opt.color }}
                    >
                      <span className="ms sz-18" style={{ color: vocalWinner === opt.id ? opt.color : 'var(--white-30)' }}>
                        {vocalWinner === opt.id ? 'radio_button_checked' : 'radio_button_unchecked'}
                      </span>
                      <span className="ms sz-14" style={{ color: opt.color }}>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--white-40)', marginTop: 8 }}>
                  <span className="ms sz-12" style={{ verticalAlign: 'middle', marginRight: 4 }}>info</span>
                  Instrumental is always HTDemucs (bass + drums + other).
                </div>
              </div>
            )}

            <div className="save-stats">
              <div className="save-stat">
                <div className="save-stat-v mono">{stats.corrections}</div>
                <div className="save-stat-l">corrections<br />applied</div>
              </div>
              <div className="save-stat-sep" />
              <div className="save-stat">
                <div className="save-stat-v mono">{totalFlags}</div>
                <div className="save-stat-l">flagged regions<br /><span style={{ color: totalFlags > 0 ? '#fde047' : 'var(--white-50)' }}>{totalFlags > 0 ? 'left unreviewed' : 'all reviewed'}</span></div>
              </div>
              <div className="save-stat-sep" />
              <div className="save-stat">
                <div className="save-stat-v mono">{stats.durationLabel}</div>
                <div className="save-stat-l">runtime<br />locked</div>
              </div>
            </div>
            {totalFlags > 0 && (
              <div className="save-warn">
                <span className="ms sz-16">warning</span>
                <span>{totalFlags} flag{totalFlags === 1 ? '' : 's'} still unresolved — they'll carry forward.</span>
              </div>
            )}
            {hasHtd && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--white-10)', marginBottom: 16, fontSize: 12 }}>
                <span className="ms sz-16" style={{ color: winnerColor }}>{winnerIcon}</span>
                <span style={{ color: 'var(--white-60)' }}>Vocal output: </span>
                <span style={{ color: winnerColor, fontWeight: 500 }}>{winnerLabel}</span>
              </div>
            )}
            <div className="save-actions">
              <button className="btn ghost" onClick={onCancel}>Keep editing</button>
              <button className="btn primary" onClick={handleConfirm}>
                <span>Continue to Diarization</span><span className="ms sz-16">arrow_forward</span>
              </button>
            </div>
          </>
        )}
        {phase === 'saving' && (
          <div className="save-progress">
            <div className="save-spinner"><span className="ms sz-32">progress_activity</span></div>
            <h3>Committing stems…</h3>
            <p>Writing tracks to project storage.</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="save-progress done">
            <div className="save-spinner-check"><span className="ms sz-32">check</span></div>
            <h3>Stage 1 complete</h3>
            <p>Diarization is ready when you are.</p>
            <div className="save-actions" style={{ marginTop: 24 }}>
              <button className="btn ghost" onClick={onCancel}>Stay on stems</button>
              <button className="btn primary" onClick={onCancel}><span>Open Diarization</span><span className="ms sz-16">arrow_forward</span></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ErrorOverlay ───────────────────────────────────────────────
function ErrorOverlay({ message, onRetry, onNewUpload }) {
  return (
    <div className="overlay error">
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span className="ms sz-32" style={{ color: '#fca5a5', fontSize: 28 }}>error</span>
          <h3 style={{ margin: 0 }}>Stem separation failed</h3>
        </div>
        <p>{message || 'An unexpected error occurred during processing.'}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn ghost" onClick={onRetry}><span className="ms sz-16">refresh</span>Retry</button>
          <button className="btn ghost" onClick={onNewUpload}><span className="ms sz-16">upload_file</span>Upload a new file</button>
        </div>
      </div>
    </div>
  );
}

// ── Editor (main) ──────────────────────────────────────────────
export default function Editor({ jobId, jobData, vocWave, insWave, htdWave, appState, errorMessage, onRetry, onNewUpload }) {
  const D   = jobData?.duration_s ?? 134;
  const FPS = jobData?.fps ?? 24;
  const sourceFilename = jobData?.source_filename ?? 'source';
  const vocLabel = jobData?.vocals_label ?? 'EL Vocals';
  const insLabel = jobData?.instrumental_label ?? 'Instrumental';

  // ── Audio engine ──────────────────────────────────────────
  const engineRef = useRef(null);
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const engine = new AudioEngine();
    engineRef.current = engine;
    engine.load(
      audioUrl(jobId, 'vocals'),
      htdWave ? audioUrl(jobId, 'htdemucs_vocals') : null,
      audioUrl(jobId, 'instrumental'),
    )
      .then(() => setAudioReady(true))
      .catch((err) => console.error('[audio] load failed:', err));
    return () => { engine.destroy(); engineRef.current = null; setAudioReady(false); };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playback state ────────────────────────────────────────
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1.4);
  const ZOOM_MIN = 0.5, ZOOM_MAX = 8;

  const [vocMuted, setVocMuted] = useState(false);
  const [insMuted, setInsMuted] = useState(false);
  const [htdMuted, setHtdMuted] = useState(false);
  const [vocSolo, setVocSolo]   = useState(false);
  const [insSolo, setInsSolo]   = useState(false);

  // Which vocal track to use as final output
  const [vocalWinner, setVocalWinner] = useState('voc');

  // Sync mute/solo to engine
  useEffect(() => {
    const vocEnabled = !(vocMuted || (insSolo && !vocSolo));
    const htdEnabled = !htdMuted;
    const insEnabled = !(insMuted || (vocSolo && !insSolo));
    engineRef.current?.setEnabled(vocEnabled, htdEnabled, insEnabled);
  }, [vocMuted, htdMuted, insMuted, vocSolo, insSolo]);

  // RAF loop
  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = () => {
      const t = engineRef.current?.getCurrentTime() ?? 0;
      setCurrentTime(t);
      if (t >= D) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, D]);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !audioReady) return;
    if (playing) {
      engine.pause();
      setCurrentTime(engine.getCurrentTime());
      setPlaying(false);
    } else {
      engine.play(currentTime);
      setPlaying(true);
    }
  }, [playing, currentTime, audioReady]);

  const seekTo = useCallback((t) => {
    const clamped = Math.max(0, Math.min(D, t));
    setCurrentTime(clamped);
    engineRef.current?.seek(clamped);
  }, [D]);

  // ── Editor state ──────────────────────────────────────────
  const [selection, setSelection]   = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [confirmed, setConfirmed]   = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [activeTab, setActiveTab]   = useState('corrections');
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [corrections, setCorrections] = useState(() => jobData?.corrections ?? []);
  const [redoStack, setRedoStack]   = useState([]);
  const [manualFlags, setManualFlags] = useState(() => jobData?.flags ?? []);

  // Keep engine in sync with corrections
  useEffect(() => {
    engineRef.current?.setCorrections(corrections);
  }, [corrections]);

  // ── Viewport ──────────────────────────────────────────────
  const laneColRef = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(800);

  const _wheelState = useRef({ contentWidth: 0, viewportWidth: 0 });
  useEffect(() => {
    const el = laneColRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z - e.deltaY * 0.04)));
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
  useLayoutEffect(() => {
    if (!laneColRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setViewportWidth(e.contentRect.width);
    });
    obs.observe(laneColRef.current);
    return () => obs.disconnect();
  }, []);

  const pxPerSec    = 8 * zoom;
  const contentWidth = D * pxPerSec;
  _wheelState.current = { contentWidth, viewportWidth };

  const [scrollLeft, setScrollLeft] = useState(0);
  useEffect(() => {
    setScrollLeft((s) => Math.max(0, Math.min(s, Math.max(0, contentWidth - viewportWidth))));
  }, [contentWidth, viewportWidth]);

  useEffect(() => {
    const phX = currentTime * pxPerSec - scrollLeft;
    const pad = 80;
    if (phX > viewportWidth - pad)
      setScrollLeft(Math.min(contentWidth - viewportWidth, currentTime * pxPerSec - (viewportWidth - pad)));
    else if (phX < pad)
      setScrollLeft(Math.max(0, currentTime * pxPerSec - pad));
  }, [currentTime, pxPerSec, viewportWidth, contentWidth]);

  // ── Auto-save ──────────────────────────────────────────────
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!jobId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveCorrections(jobId, corrections).catch(console.error), 800);
    return () => clearTimeout(saveTimer.current);
  }, [corrections, jobId]);

  const flagTimer = useRef(null);
  useEffect(() => {
    if (!jobId) return;
    clearTimeout(flagTimer.current);
    flagTimer.current = setTimeout(() => saveFlags(jobId, manualFlags).catch(console.error), 800);
    return () => clearTimeout(flagTimer.current);
  }, [manualFlags, jobId]);

  // ── Regions ───────────────────────────────────────────────
  // Generic 3-track region computation from corrections list
  const regions = useMemo(() => {
    const tracks = { voc: [], htd: [], ins: [] };
    for (const c of corrections) {
      const to = c.to ?? null;
      if (tracks[c.from] !== undefined) {
        tracks[c.from].push({
          kind: 'silenced',
          deleted: to === null,
          start: c.start,
          end: c.end,
          title: to === null ? 'Deleted' : `Moved to ${TRACK_LABEL[to] ?? to}`,
        });
      }
      if (to !== null && tracks[to] !== undefined) {
        tracks[to].push({
          kind: 'grafted',
          from: c.from,
          start: c.start,
          end: c.end,
          title: `From ${TRACK_LABEL[c.from] ?? c.from}`,
        });
      }
    }
    return tracks;
  }, [corrections]);

  const remainingBleeds = useMemo(() => ({
    voc: manualFlags.filter((f) => f.trackId === 'voc').map((f) => ({ id: f.id, s: f.start, e: f.end })),
    htd: manualFlags.filter((f) => f.trackId === 'htd').map((f) => ({ id: f.id, s: f.start, e: f.end })),
    ins: manualFlags.filter((f) => f.trackId === 'ins').map((f) => ({ id: f.id, s: f.start, e: f.end })),
  }), [manualFlags]);

  const flagForSelection = useMemo(() => {
    if (!selection || selection.dragging) return null;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    return manualFlags.find((f) => f.trackId === selection.trackId && Math.abs(f.start - a) < 0.05 && Math.abs(f.end - b) < 0.05) || null;
  }, [selection, manualFlags]);

  // ── FAB positioning ───────────────────────────────────────
  // Top offset of FAB: positioned just below the selected track's lane
  const RULER_H = 36, LANE_H = 104;
  const fabTop = useMemo(() => {
    if (!selection) return 0;
    const htdH = htdWave ? LANE_H : 0;
    switch (selection.trackId) {
      case 'voc': return RULER_H + LANE_H - 18;
      case 'htd': return RULER_H + LANE_H + LANE_H - 18;
      case 'ins': return RULER_H + LANE_H + htdH + LANE_H - 18;
      default:    return RULER_H + LANE_H - 18;
    }
  }, [selection, htdWave]);

  // ── Actions ───────────────────────────────────────────────
  const moveSelectionTo = useCallback((target) => {
    if (!selection || selection.dragging) return;
    if (target === selection.trackId) return;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.05) return;
    setCorrections((arr) => [{ id: `u${Date.now()}`, from: selection.trackId, to: target, start: a, end: b }, ...arr]);
    setRedoStack([]);
    setSelection(null);
  }, [selection]);

  const deleteSelection = useCallback(() => {
    if (!selection || selection.dragging) return;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.05) return;
    setCorrections((arr) => [{ id: `u${Date.now()}`, from: selection.trackId, to: null, start: a, end: b }, ...arr]);
    setRedoStack([]);
    setSelection(null);
  }, [selection]);

  const flagSelection = useCallback(() => {
    if (!selection || selection.dragging) return;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.05) return;
    if (flagForSelection) {
      setManualFlags((arr) => arr.filter((f) => f.id !== flagForSelection.id));
    } else {
      setManualFlags((arr) => [...arr, { id: `f${Date.now()}`, trackId: selection.trackId, start: a, end: b }]);
    }
    setSelection(null);
  }, [selection, flagForSelection]);

  const undoCorrection = useCallback((id) => {
    setCorrections((arr) => {
      const item = arr.find((c) => c.id === id);
      if (item) setRedoStack((r) => [...r, item]);
      return arr.filter((c) => c.id !== id);
    });
  }, []);
  const undoLast = useCallback(() => {
    setCorrections((arr) => {
      if (!arr.length) return arr;
      const [head, ...rest] = arr;
      setRedoStack((r) => [...r, head]);
      return rest;
    });
  }, []);
  const redoLast = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      const item = r[r.length - 1];
      setCorrections((arr) => [item, ...arr]);
      return r.slice(0, -1);
    });
  }, []);

  // ── Keyboard ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ')           { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); seekTo(currentTime - 1 / FPS); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(currentTime + 1 / FPS); }
      else if (e.key === 'v' || e.key === 'V') moveSelectionTo('voc');
      else if (e.key === 'h' || e.key === 'H') moveSelectionTo('htd');
      else if (e.key === 'i' || e.key === 'I') moveSelectionTo('ins');
      else if (e.key === 'd' || e.key === 'D') deleteSelection();
      else if (e.key === 'f' || e.key === 'F') flagSelection();
      else if (e.key === 'z' || e.key === 'Z') { if (e.shiftKey) redoLast(); else undoLast(); }
      else if (e.key === 'y' || e.key === 'Y') redoLast();
      else if (e.key === 'Escape') { setSelection(null); setShortcutsOpen(false); }
      else if (e.key === '?') setShortcutsOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekTo, moveSelectionTo, deleteSelection, flagSelection, undoLast, redoLast, currentTime, FPS]);

  const stats = useMemo(() => ({
    flags: manualFlags.length,
    corrections: corrections.length,
    durationLabel: fmtTC(D, FPS).slice(0, 8),
  }), [manualFlags, corrections, D, FPS]);

  const flashPanel = (tab) => {
    setActiveTab(tab);
    setHistoryCollapsed(false);
    const panel = document.querySelector('.history');
    if (panel) { panel.classList.add('flash'); setTimeout(() => panel.classList.remove('flash'), 700); }
  };

  const onRulerSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo((e.clientX - rect.left + scrollLeft) / pxPerSec);
  };

  const isError = appState === 'error';
  const hasHtd = !!htdWave;
  const trackCount = hasHtd ? 3 : 2;

  return (
    <div className="app">
      <TopHeader confirmed={confirmed} onConfirm={() => setSaveModalOpen(true)} filename={sourceFilename} />
      <SubstageStrip
        stats={stats} confirmed={confirmed}
        onConfirmToggle={() => setConfirmed((v) => !v)}
        onFocusCorrections={() => flashPanel('corrections')}
        onFocusFlags={() => flashPanel('flags')}
        onProjectAction={(kind) => {
          if (kind === 'new-upload') onNewUpload?.();
          if (kind === 're-separate' && window.confirm('Re-run stem separation? This discards all corrections and flags.')) onRetry?.();
          if (kind === 'export-both') {
            ['vocals', 'instrumental'].forEach((stem, i) => {
              setTimeout(() => {
                const a = document.createElement('a');
                a.href = exportUrl(jobId, stem);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }, i * 600);
            });
          }
        }}
      />

      <Transport
        playing={playing} onPlayToggle={togglePlay} audioReady={audioReady}
        currentTime={currentTime} duration={D} fps={FPS}
        onStepFrame={(dir) => seekTo(currentTime + dir / FPS)}
        onJumpEdge={(edge) => seekTo(edge === 'start' ? 0 : D)}
        zoom={zoom} onZoomChange={setZoom} zoomMin={ZOOM_MIN} zoomMax={ZOOM_MAX}
        onShowShortcuts={() => setShortcutsOpen((v) => !v)}
        onUndo={undoLast} canUndo={corrections.length > 0}
        onRedo={redoLast} canRedo={redoStack.length > 0} />

      <div className={`body ${historyCollapsed ? 'history-collapsed' : ''} ${isError ? 'no-history' : ''}`}>
        <div className="workspace">
          <div className="timeline">
            {/* ── Rail column ─────────────────────────────────── */}
            <div className="rail-col">
              <div className="rail-head">
                <span className="caps">TRACKS</span>
                <span style={{ marginLeft: 'auto', color: 'var(--white-30)' }} className="mono">{trackCount} / {trackCount}</span>
              </div>

              {/* ElevenLabs Vocals rail */}
              <TrackRail
                trackId="voc" label={vocLabel} sublabel="ElevenLabs isolation"
                muted={vocMuted} soloed={vocSolo}
                onToggleMute={() => setVocMuted((v) => !v)}
                onToggleSolo={() => setVocSolo((v) => !v)}
                jobId={jobId}
                isWinner={vocalWinner === 'voc'}
                onSelectWinner={() => setVocalWinner('voc')}
              />

              {/* HTDemucs Vocals rail — always visible when data is available */}
              {hasHtd && (
                <TrackRail
                  trackId="htd" label="HTDemucs Vocals" sublabel="Model separation"
                  muted={htdMuted} soloed={false}
                  onToggleMute={() => setHtdMuted((v) => !v)}
                  onToggleSolo={() => {}}
                  jobId={jobId}
                  isWinner={vocalWinner === 'htd'}
                  onSelectWinner={() => setVocalWinner('htd')}
                />
              )}

              {/* Instrumental rail */}
              <TrackRail
                trackId="ins" label={insLabel} sublabel="HTDemucs instrumental"
                muted={insMuted} soloed={insSolo}
                onToggleMute={() => setInsMuted((v) => !v)}
                onToggleSolo={() => setInsSolo((v) => !v)}
                jobId={jobId}
              />
            </div>

            {/* ── Lane column ─────────────────────────────────── */}
            <div className="lane-col" ref={laneColRef}>
              <div onClick={onRulerSeek} style={{ cursor: 'ew-resize' }}>
                <Ruler contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} duration={D} fps={FPS} />
              </div>

              {/* Shared waveform lookup for 3-track graft rendering */}
              {(() => {
                const allWaves = { voc: vocWave ?? [], htd: htdWave ?? [], ins: insWave ?? [] };
                return (
                  <>
                    {/* ElevenLabs Vocals lane */}
                    <Lane
                      trackId="voc" data={vocWave ?? []} otherData={insWave ?? []} htdData={htdWave ?? []}
                      allWaves={allWaves}
                      color="#7dbcff" dimColor="rgba(96,165,250,0.18)" otherColor="#5eead4"
                      regions={regions.voc} bleeds={remainingBleeds.voc}
                      onFlagClick={(tid, s, e) => setSelection({ trackId: tid, start: s, end: e, dragging: false })}
                      muted={vocMuted || (insSolo && !vocSolo)}
                      contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} duration={D}
                      selection={selection} onSelectionChange={setSelection} laneHeight={LANE_H} fps={FPS}
                    />

                    {/* HTDemucs Vocals lane */}
                    {hasHtd && (
                      <Lane
                        trackId="htd" data={htdWave} otherData={vocWave ?? []} htdData={htdWave ?? []}
                        allWaves={allWaves}
                        color="#a78bfa" dimColor="rgba(167,139,250,0.15)" otherColor="#7dbcff"
                        regions={regions.htd} bleeds={remainingBleeds.htd}
                        onFlagClick={(tid, s, e) => setSelection({ trackId: tid, start: s, end: e, dragging: false })}
                        muted={htdMuted}
                        contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} duration={D}
                        selection={selection} onSelectionChange={setSelection} laneHeight={LANE_H} fps={FPS}
                      />
                    )}

                    {/* Instrumental lane */}
                    <Lane
                      trackId="ins" data={insWave ?? []} otherData={vocWave ?? []} htdData={htdWave ?? []}
                      allWaves={allWaves}
                      color="#5eead4" dimColor="rgba(94,234,212,0.18)" otherColor="#7dbcff"
                      regions={regions.ins} bleeds={remainingBleeds.ins}
                      onFlagClick={(tid, s, e) => setSelection({ trackId: tid, start: s, end: e, dragging: false })}
                      muted={insMuted || (vocSolo && !insSolo)}
                      contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} duration={D}
                      selection={selection} onSelectionChange={setSelection} laneHeight={LANE_H} fps={FPS}
                    />
                  </>
                );
              })()}

              <Playhead currentTime={currentTime} pxPerSec={pxPerSec} scrollLeft={scrollLeft} viewportWidth={viewportWidth} fps={FPS} />

              <SelectionFab
                selection={selection}
                isFlagged={!!flagForSelection}
                xOf={(s) => s * pxPerSec}
                scrollLeft={scrollLeft}
                viewportWidth={viewportWidth}
                fabTop={fabTop}
                onMoveTo={moveSelectionTo}
                onFlag={flagSelection}
                onDelete={deleteSelection}
                onDismiss={() => setSelection(null)}
              />

              <Scrollbar contentWidth={contentWidth} viewportWidth={viewportWidth} scrollLeft={scrollLeft} onScroll={setScrollLeft} />
            </div>
          </div>

          {shortcutsOpen && <ShortcutsPopover />}
          {isError && <ErrorOverlay message={errorMessage} onRetry={onRetry} onNewUpload={onNewUpload} />}
        </div>

        {!isError && (
          <HistoryPanel
            corrections={corrections} flags={manualFlags}
            onUndo={undoCorrection}
            onRemoveFlag={(id) => setManualFlags((arr) => arr.filter((f) => f.id !== id))}
            onFocusFlag={(f) => { setSelection({ trackId: f.trackId, start: f.start, end: f.end, dragging: false }); seekTo(f.start); }}
            onFocusCorrection={(c) => seekTo(c.start)}
            activeTab={activeTab} onTabChange={setActiveTab}
            collapsed={historyCollapsed} onToggleCollapse={() => setHistoryCollapsed((v) => !v)}
            fps={FPS} />
        )}
      </div>

      {saveModalOpen && (
        <SaveContinueModal
          stats={stats} flags={manualFlags} jobId={jobId}
          vocalWinner={vocalWinner} onVocalWinnerChange={setVocalWinner}
          hasHtd={hasHtd}
          onCancel={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
}
