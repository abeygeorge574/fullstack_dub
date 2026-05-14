// editor.jsx — the StemEditor screen. Header + sub-stage strip + timeline +
// transport bar + corrections history. State lives at the parent (App).

const STAGES = [
  { id: 1, label: "Stems",       short: "STEM",       icon: "graphic_eq",       status: "current" },
  { id: 2, label: "Diarization", short: "DIAR",       icon: "groups",           status: "future" },
  { id: 3, label: "Transcribe",  short: "TRANSCRIBE", icon: "subtitles",        status: "future" },
  { id: 4, label: "Translate",   short: "TRANS",      icon: "translate",        status: "future" },
  { id: 5, label: "TTS",         short: "TTS",        icon: "record_voice_over",status: "future" },
  { id: 6, label: "Lipsync",     short: "LIPSYNC",    icon: "videocam",         status: "future" },
];

// ── Header (project, stages, save & continue) ─────────────────
function TopHeader({ confirmed, onConfirm, currentStage = 1 }) {
  return (
    <header className="top">
      <div className="top-left">
        <div className="brand">
          <span className="dot" />
          <span>ProDub</span>
        </div>
        <div className="divider-v" />
        <div className="proj">
          <span className="proj-name">RIL_EP_49_FHD_SDR_1</span>
          <span className="proj-id" title="Postudio project code">PSPDZBZA2687</span>
        </div>
      </div>

      <nav className="stages" aria-label="Pipeline stages">
        {STAGES.map((s, i) => {
          const cls = (i + 1) < currentStage ? "done" : (i + 1) === currentStage ? "current" : "future";
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <div className="sep" />}
              <div className={`stage ${cls}`} title={s.label}>
                <span className="num">
                  {cls === "done" ? <span className="ms sz-14">check</span> : s.id}
                </span>
                <span className="stage-label">{s.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="top-right">
        <button
          className={`btn primary`}
          disabled={!confirmed}
          onClick={confirmed ? onConfirm : undefined}
          title={confirmed ? "Save & continue to Diarization" : "Mark this stage as reviewed first"}
        >
          <span>Save & Continue</span>
          <span className="ms sz-16">arrow_forward</span>
        </button>
      </div>
    </header>
  );
}

// ── Sub-stage strip ────────────────────────────────────────────
function SubstageStrip({ stats, confirmed, onConfirmToggle, onFocusCorrections, onFocusFlags, onProjectAction }) {
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const actionsRef = React.useRef(null);
  React.useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e) => { if (!actionsRef.current?.contains(e.target)) setActionsOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [actionsOpen]);

  return (
    <div className="substage">
      <div className="substage-title">
        <span className="ix">STAGE 1 / 6</span>
        <h1>Stem Separation Review</h1>
        <span className="sub">Find any bleed between vocals and instrumental, then reassign it.</span>
      </div>

      <div className="bleed-summary">
        <button
          className="stat-chip"
          onClick={onFocusFlags}
          title="Ranges you've flagged for follow-up. Drag-select on the timeline, then press F or click the flag button in the action bar."
        >
          <span className="ms sz-14" style={{ color: "#fb923c" }}>flag</span>
          <span className="v">{stats.suspected}</span>
          <span className="stat-label">{stats.suspected === 1 ? "flag" : "flags"}</span>
        </button>
        <button
          className="stat-chip"
          onClick={onFocusCorrections}
          title="Stem reassignments you've made. Click to open the panel on the right."
        >
          <span className="ms sz-14" style={{ color: "var(--white-50)" }}>history</span>
          <span className="v">{stats.corrections}</span>
          <span className="stat-label">{stats.corrections === 1 ? "correction" : "corrections"}</span>
        </button>
      </div>

      <div className="substage-right">
        <button
          className={`mark-toggle ${confirmed ? "on" : ""}`}
          onClick={onConfirmToggle}
          title="Mark this stage as reviewed to enable Save & Continue"
        >
          <span className={`mark-box ${confirmed ? "on" : ""}`}>
            {confirmed && <span className="ms sz-14">check</span>}
          </span>
          {confirmed ? "Reviewed" : "Mark as reviewed"}
        </button>
        <div className="project-actions" ref={actionsRef}>
          <button
            className={`iconbtn ${actionsOpen ? "active" : ""}`}
            title="Project-level actions"
            onClick={() => setActionsOpen((v) => !v)}
          >
            <span className="ms sz-20">more_horiz</span>
          </button>
          {actionsOpen && (
            <div className="rail-menu project-menu" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rail-menu-head">
                <div className="rail-menu-name">Project actions</div>
                <div className="rail-menu-file mono">stage 1 — stems</div>
              </div>
              <button className="rail-menu-item" onClick={() => { setActionsOpen(false); onProjectAction?.("export-both"); }}>
                <span className="ms sz-16">file_download</span>
                <span>Export both stems</span>
              </button>
              <div className="rail-menu-sep" />
              <button className="rail-menu-item danger" onClick={() => { setActionsOpen(false); onProjectAction?.("re-separate"); }}>
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

// ── Ruler (timecode strip across the timeline) ────────────────
function Ruler({ contentWidth, viewportWidth, scrollLeft, duration }) {
  // Tick step adapts to zoom
  const pxPerSec = contentWidth / duration;
  let majorStep = 30;
  if (pxPerSec > 60) majorStep = 10;
  else if (pxPerSec > 40) majorStep = 15;
  else if (pxPerSec > 18) majorStep = 30;
  else majorStep = 60;
  const minorStep = majorStep / 5;

  const ticks = [];
  for (let t = 0; t <= duration; t += minorStep) {
    const x = (t / duration) * contentWidth - scrollLeft;
    if (x < -50 || x > viewportWidth + 50) continue;
    const isMajor = Math.abs((t / majorStep) - Math.round(t / majorStep)) < 1e-3;
    ticks.push(
      <div key={`t-${t}`} className={`tick ${isMajor ? "" : "minor"}`} style={{ left: x }} />
    );
    if (isMajor) {
      ticks.push(
        <div key={`l-${t}`} className="tlabel" style={{ left: x }}>{window.PD.fmtTC(t)}</div>
      );
    }
  }
  return (
    <div className="ruler">
      <div className="tickwrap">{ticks}</div>
    </div>
  );
}

// ── Track rail (left-column controls for one track) ───────────
function TrackRail({ trackId, label, sublabel, muted, soloed, onToggleMute, onToggleSolo, vol, onVolChange }) {
  const cls = `rail ${trackId}`;
  const initial = trackId === "voc" ? "V" : "I";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setMenuOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const sourceLabel = trackId === "voc" ? "vocals_v2.wav" : "instrumental_v2.wav";

  return (
    <div className={cls} ref={rootRef}>
      <div className="rail-avatar">{initial}</div>
      <div className="rail-meta">
        <div className="rail-label">{label}</div>
        <div className="rail-sublabel">{sublabel}</div>
      </div>
      <div className="rail-controls">
        <button
          className={`tiny-toggle ${menuOpen ? "active" : ""}`}
          title="Track options"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="ms sz-14">more_horiz</span>
        </button>
        <button
          className={`tiny-toggle ${muted ? "active mute" : ""}`}
          onClick={onToggleMute}
          title={muted ? "Unmute (M)" : "Mute (M)"}
        >
          <span className="ms sz-16">{muted ? "volume_off" : "volume_up"}</span>
        </button>
        <button
          className={`tiny-toggle solo ${soloed ? "active" : ""}`}
          onClick={onToggleSolo}
          title={soloed ? "Un-solo (S)" : "Solo (S)"}
        >S</button>

        {menuOpen && (
          <div className="rail-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="rail-menu-head">
              <div className="rail-menu-name">{label} stem</div>
              <div className="rail-menu-file mono">{sourceLabel}</div>
            </div>
            <button className="rail-menu-item">
              <span className="ms sz-16">drive_file_rename_outline</span>
              <span>Rename track</span>
            </button>
            <button className="rail-menu-item">
              <span className="ms sz-16">file_download</span>
              <span>Export stem as WAV</span>
            </button>
            <button className="rail-menu-item">
              <span className="ms sz-16">visibility_off</span>
              <span>Solo only this stem</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transport bar ──────────────────────────────────────────────
function Transport({
  playing, onPlayToggle,
  currentTime, duration,
  onStepFrame, onJumpEdge,
  zoom, onZoomChange, zoomMin, zoomMax,
  onShowShortcuts,
  onUndo, canUndo,
  onRedo, canRedo,
}) {
  return (
    <div className="transport">
      <div className="transport-left">
        <div className="tc">
          <span className="now">{window.PD.fmtTC(currentTime)}</span>
          <span className="slash">/</span>
          <span className="total">{window.PD.fmtTC(duration)}</span>
        </div>
        <button
          className="tport-btn"
          disabled={!canUndo}
          onClick={onUndo}
          title={canUndo ? "Undo last correction (Z)" : "Nothing to undo"}
        >
          <span className="ms sz-18">undo</span>
        </button>
        <button
          className="tport-btn"
          disabled={!canRedo}
          onClick={onRedo}
          title={canRedo ? "Redo (⇧Z / Y)" : "Nothing to redo"}
        >
          <span className="ms sz-18">redo</span>
        </button>
      </div>

      <div className="transport-center">
        <button className="tport-btn" title="Jump to start" onClick={() => onJumpEdge("start")}>
          <span className="ms sz-20">first_page</span>
        </button>
        <button className="tport-btn" title="Step back 1 frame (←)" onClick={() => onStepFrame(-1)}>
          <span className="ms sz-20">skip_previous</span>
        </button>
        <button
          className={`tport-btn play ${playing ? "playing" : ""}`}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={onPlayToggle}
        >
          <span className="ms sz-22">{playing ? "pause" : "play_arrow"}</span>
        </button>
        <button className="tport-btn" title="Step forward 1 frame (→)" onClick={() => onStepFrame(1)}>
          <span className="ms sz-20">skip_next</span>
        </button>
        <button className="tport-btn" title="Jump to end" onClick={() => onJumpEdge("end")}>
          <span className="ms sz-20">last_page</span>
        </button>
      </div>

      <div className="transport-right">
        <div className="zoom" title={`Zoom ${zoom.toFixed(1)}×`}>
          <button className="tport-btn small"
                  onClick={() => onZoomChange(Math.max(zoomMin, zoom - 0.5))}
                  title="Zoom out">
            <span className="ms sz-16">remove</span>
          </button>
          <input
            type="range"
            min={zoomMin}
            max={zoomMax}
            step={0.1}
            value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))}
            className="zoom-slider"
          />
          <button className="tport-btn small"
                  onClick={() => onZoomChange(Math.min(zoomMax, zoom + 0.5))}
                  title="Zoom in">
            <span className="ms sz-16">add</span>
          </button>
        </div>
        <div className="divider-v tall" />
        <button className="tport-btn" title="Keyboard shortcuts (?)" onClick={onShowShortcuts}>
          <span className="ms sz-18">keyboard</span>
        </button>
      </div>
    </div>
  );
}

// ── Floating action button (over selection) ───────────────────
function SelectionFab({ selection, isFlagged, xOf, scrollLeft, viewportWidth, onMove, onFlag, onDismiss }) {
  if (!selection || selection.dragging) return null;
  const dur = Math.abs(selection.end - selection.start);
  if (dur < 0.05) return null;

  const isVoc = selection.trackId === "voc";
  const targetLabel = isVoc ? "Instrumental" : "Vocals";
  const arrowIcon = isVoc ? "south" : "north";
  const arrowColor = isVoc ? "var(--ins-accent)" : "var(--voc-accent)";
  const kbd = isVoc ? "I" : "V";

  const a = xOf(Math.min(selection.start, selection.end)) - scrollLeft;
  const b = xOf(Math.max(selection.start, selection.end)) - scrollLeft;
  const mid = (a + b) / 2;
  const fabWidth = 360;
  const fabLeft = Math.max(8, Math.min(viewportWidth - fabWidth - 8, mid - fabWidth / 2));
  const anchorTop = "calc(36px + var(--track-h) - 18px)";

  return (
    <div
      className="fab"
      style={{ left: fabLeft, top: anchorTop }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="arrow" style={{ background: arrowColor, color: "#022" }}>
        <span className="ms sz-14">{arrowIcon}</span>
      </span>
      <div className="fab-info">
        <div className="range mono">{dur.toFixed(2)}s</div>
      </div>
      <button
        className={`fab-secondary ${isFlagged ? "is-flagged" : ""}`}
        onClick={onFlag}
        title={isFlagged
          ? `Remove this flag (F)`
          : `Flag this ${dur.toFixed(2)}s range without moving it (F)`}
      >
        <span className="ms sz-14">{isFlagged ? "close" : "flag"}</span>
        <span>{isFlagged ? "Unflag" : "Flag"}</span>
        <span className="kbd">F</span>
      </button>
      <button className="go" onClick={onMove} title={`Move audio to ${targetLabel} (${kbd})`}>
        <span className="ms sz-14">{arrowIcon}</span>
        <span>Move to {targetLabel}</span>
        <span className="kbd">{kbd}</span>
      </button>
      <button className="x" onClick={onDismiss} title="Cancel (Esc)">
        <span className="ms sz-16">close</span>
      </button>
    </div>
  );
}

// ── Side panel (Corrections + Flags tabs) ─────────────────────
function HistoryPanel({
  corrections, flags,
  onUndo, onRemoveFlag, onFocusFlag, onFocusCorrection,
  activeTab, onTabChange,
  collapsed, onToggleCollapse,
}) {
  if (collapsed) {
    const total = corrections.length + flags.length;
    return (
      <aside className="history">
        <div className="history-rail">
          <button className="iconbtn" onClick={onToggleCollapse} title="Expand panel">
            <span className="ms sz-20">chevron_left</span>
          </button>
          <div className="vert mono">{total} ITEMS</div>
        </div>
      </aside>
    );
  }

  const items = activeTab === "corrections" ? corrections : flags;

  return (
    <aside className="history">
      <div className="history-head">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "corrections" ? "active" : ""}`}
            onClick={() => onTabChange("corrections")}
          >
            <span className="ms sz-16">history</span>
            <span>Corrections</span>
            <span className="tab-count">{corrections.length}</span>
          </button>
          <button
            className={`tab ${activeTab === "flags" ? "active" : ""}`}
            onClick={() => onTabChange("flags")}
          >
            <span className="ms sz-16">flag</span>
            <span>Flags</span>
            <span className="tab-count">{flags.length}</span>
          </button>
        </div>
        <button className="iconbtn" onClick={onToggleCollapse} title="Collapse panel">
          <span className="ms sz-18">chevron_right</span>
        </button>
      </div>

      <div className="history-body">
        {items.length === 0 ? (
          <div className="history-empty">
            <span className="ms">{activeTab === "flags" ? "flag" : "drag_indicator"}</span>
            <div className="title">
              {activeTab === "flags" ? "No flags yet" : "No corrections yet"}
            </div>
            <div className="sub">
              {activeTab === "flags"
                ? "Drag-select a range on the timeline, then press F or click the flag button to mark it for follow-up."
                : "Drag-select a range on either waveform, then choose where to move it."}
            </div>
          </div>
        ) : activeTab === "corrections" ? (
          corrections.map((c) => (
            <div
              key={c.id}
              className="hist-item"
              onClick={() => onFocusCorrection?.(c)}
            >
              <div className={`dir from-${c.from}`}>
                <span className="ms sz-14">{c.from === "voc" ? "south" : "north"}</span>
              </div>
              <div className="info">
                <div className="desc">
                  <b>{c.from === "voc" ? "Vocals" : "Instrumental"}</b>
                  <span style={{ color: "var(--white-50)" }}> → </span>
                  <b>{c.to === "voc" ? "Vocals" : "Instrumental"}</b>
                </div>
                <div className="range">
                  {window.PD.fmtTC(c.start)} – {window.PD.fmtTC(c.end)}
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>· {(c.end - c.start).toFixed(2)}s</span>
                </div>
              </div>
              <div className="actions">
                <button
                  className="undo"
                  onClick={(e) => { e.stopPropagation(); onUndo(c.id); }}
                  title="Undo this correction"
                >
                  <span className="ms sz-14">undo</span>
                </button>
              </div>
            </div>
          ))
        ) : (
          flags.map((f) => (
            <div
              key={f.id}
              className="hist-item"
              onClick={() => onFocusFlag?.(f)}
            >
              <div className="dir flag-dir">
                <span className="ms sz-14">flag</span>
              </div>
              <div className="info">
                <div className="desc">
                  <b>{f.trackId === "voc" ? "Vocals" : "Instrumental"}</b>
                  <span style={{ color: "var(--white-50)" }}> · flagged</span>
                </div>
                <div className="range">
                  {window.PD.fmtTC(f.start)} – {window.PD.fmtTC(f.end)}
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>· {(f.end - f.start).toFixed(2)}s</span>
                </div>
              </div>
              <div className="actions">
                <button
                  className="undo"
                  onClick={(e) => { e.stopPropagation(); onRemoveFlag(f.id); }}
                  title="Remove this flag"
                >
                  <span className="ms sz-14">close</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ── Shortcuts popover ──────────────────────────────────────────
function ShortcutsPopover({ onClose }) {
  return (
    <div className="shortcuts-pop" onMouseDown={(e) => e.stopPropagation()}>
      <h4>Keyboard</h4>
      {[
        { lbl: "Play / pause",    keys: ["Space"] },
        { lbl: "Step ±1 frame",   keys: ["←", "→"] },
        { lbl: "Move to vocals",  keys: ["V"] },
        { lbl: "Move to instrumental", keys: ["I"] },
        { lbl: "Flag selection",  keys: ["F"] },
        { lbl: "Undo",            keys: ["Z"] },
        { lbl: "Redo",            keys: ["⇧Z", "Y"] },
        { lbl: "Clear selection", keys: ["Esc"] },
        { lbl: "Toggle mute",     keys: ["M"] },
        { lbl: "Toggle solo",     keys: ["S"] },
      ].map((r, i) => (
        <div className="row" key={i}>
          <span>{r.lbl}</span>
          <span className="keys">
            {r.keys.map((k, j) => <span key={j} className="kbd solid">{k}</span>)}
          </span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  TopHeader, SubstageStrip, Ruler, TrackRail, Transport,
  SelectionFab, HistoryPanel, ShortcutsPopover, STAGES,
});
