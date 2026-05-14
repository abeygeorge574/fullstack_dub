// app.jsx — top-level state, the timeline composition, and state overlays + tweaks.

const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "state": "active",
  "showShortcuts": false,
  "loadProgress": 64,
  "manyCorrections": false,
  "historyCollapsed": false,
  "playing": false
}/*EDITMODE-END*/;

// Build a fictional "many corrections" list for the dense state demo.
function buildManyCorrections() {
  const names = ["Aman Roy", "Priya M.", "Kabir S.", "Anika V.", "Rohan K."];
  const reasons = [
    "Score swell crept into vocals during cutaway.",
    "Crowd ambience picked up as music in instrumental stem.",
    "Wide-shot dialog 'aaiye, baith jaaiye' lost to music stem.",
    "Foley footstep mistaken for vocal sibilance.",
    "Background TV chatter leaking into vocals.",
    "Door slam moved to instrumental.",
    "Phone ring isolated to instrumental.",
    "Soft music bed in dialog scene.",
  ];
  const out = [];
  let t = 1.0;
  for (let i = 0; i < 22; i++) {
    const len = 1.4 + Math.random() * 4.5;
    const from = Math.random() < 0.55 ? "voc" : "ins";
    out.push({
      id: `m${i}`,
      from, to: from === "voc" ? "ins" : "voc",
      start: t, end: t + len,
      by: names[i % names.length],
      at: `${Math.floor(Math.random() * 30) + 1}m ago`,
      reason: reasons[i % reasons.length],
    });
    t += len + 1 + Math.random() * 4;
    if (t > 130) t = 1 + Math.random() * 10;
  }
  return out;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const D = window.PD.DURATION_SEC;
  const FPS = window.PD.FPS;

  // Core editor state
  const [currentTime, setCurrentTime] = useState(42.0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1.4);
  const ZOOM_MIN = 0.5, ZOOM_MAX = 8;

  const [vocMuted, setVocMuted] = useState(false);
  const [insMuted, setInsMuted] = useState(false);
  const [vocSolo, setVocSolo] = useState(false);
  const [insSolo, setInsSolo] = useState(false);

  const [selection, setSelection] = useState(
    // Pre-seeded selection so the "active" state is visually populated
    { trackId: "voc", start: 22.5, end: 26.0, dragging: false }
  );

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("corrections"); // 'corrections' | 'flags'

  // Corrections + redo stack
  const [corrections, setCorrections] = useState(window.PD.INITIAL_CORRECTIONS);
  const [redoStack, setRedoStack] = useState([]); // most recent at end
  useEffect(() => {
    if (t.state === "empty") {
      setCorrections([]);
    } else if (t.manyCorrections) {
      setCorrections([...window.PD.INITIAL_CORRECTIONS, ...buildManyCorrections()]);
    } else {
      setCorrections(window.PD.INITIAL_CORRECTIONS);
    }
  }, [t.state, t.manyCorrections]);

  // Viewport sizing
  const laneColRef = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(800);
  useLayoutEffect(() => {
    if (!laneColRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setViewportWidth(e.contentRect.width);
    });
    obs.observe(laneColRef.current);
    return () => obs.disconnect();
  }, []);

  const pxPerSec = 8 * zoom;
  const contentWidth = D * pxPerSec;

  // Scroll
  const [scrollLeft, setScrollLeft] = useState(0);
  useEffect(() => {
    // clamp scroll on zoom change
    setScrollLeft((s) => Math.max(0, Math.min(s, Math.max(0, contentWidth - viewportWidth))));
  }, [contentWidth, viewportWidth]);

  // Auto-scroll to keep playhead in view while playing
  useEffect(() => {
    const phX = currentTime * pxPerSec - scrollLeft;
    const pad = 80;
    if (phX > viewportWidth - pad) {
      setScrollLeft(Math.min(contentWidth - viewportWidth, currentTime * pxPerSec - (viewportWidth - pad)));
    } else if (phX < pad) {
      setScrollLeft(Math.max(0, currentTime * pxPerSec - pad));
    }
  }, [currentTime, pxPerSec, viewportWidth, contentWidth]);

  // Animate currentTime when playing
  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setCurrentTime((c) => {
        const nc = c + dt;
        if (nc >= D) { setPlaying(false); return D; }
        return nc;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, D]);

  const xOf = (sec) => sec * pxPerSec;

  // ── Region computation from corrections ────────────────────
  // For each track, build:
  //   - silenced regions (where audio was removed from this track)
  //   - grafted regions (where audio was added onto this track from the other)
  const regions = useMemo(() => {
    const vocRegions = [];
    const insRegions = [];
    for (const c of corrections) {
      if (c.from === "voc") {
        vocRegions.push({ kind: "silenced", start: c.start, end: c.end, title: `Moved to instrumental ${window.PD.fmtTC(c.start)}` });
        insRegions.push({ kind: "grafted", from: "voc", start: c.start, end: c.end, title: `From vocals ${window.PD.fmtTC(c.start)}` });
      } else {
        insRegions.push({ kind: "silenced", start: c.start, end: c.end, title: `Moved to vocals ${window.PD.fmtTC(c.start)}` });
        vocRegions.push({ kind: "grafted", from: "ins", start: c.start, end: c.end, title: `From instrumental ${window.PD.fmtTC(c.start)}` });
      }
    }
    return { voc: vocRegions, ins: insRegions };
  }, [corrections]);

  // ── Manual flags (user-added — there is no auto-flagging; the model just
  //    separates as best it can, and the editor flags anything questionable) ──
  const [manualFlags, setManualFlags] = useState([
    // Seed: one user-flagged region the dubbing editor wants to revisit later.
    { id: "seed1", trackId: "voc", start: 27.0, end: 30.0 },
  ]);

  // ── Flag overlays passed to lanes (user-only) ──
  const remainingBleeds = useMemo(() => {
    const vocManual = manualFlags
      .filter(f => f.trackId === "voc")
      .map(f => ({ id: f.id, s: f.start, e: f.end, kind: "manual" }));
    const insManual = manualFlags
      .filter(f => f.trackId === "ins")
      .map(f => ({ id: f.id, s: f.start, e: f.end, kind: "manual" }));
    return { voc: vocManual, ins: insManual };
  }, [manualFlags]);

  // ── Actions ────────────────────────────────────────────────
  const moveSelectionTo = useCallback((target) => {
    if (!selection || selection.dragging) return;
    if (target === "voc" && selection.trackId === "voc") return;
    if (target === "ins" && selection.trackId === "ins") return;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.05) return;
    const newC = {
      id: `u${Date.now()}`,
      from: selection.trackId,
      to: target,
      start: a, end: b,
      by: "You", at: "just now",
      reason: null,
    };
    setCorrections((arr) => [newC, ...arr]);
    setRedoStack([]); // new action invalidates the redo stack
    setSelection(null);
  }, [selection]);

  // Find a manual flag matching the current selection (within a small tolerance).
  const flagForSelection = useMemo(() => {
    if (!selection || selection.dragging) return null;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    return manualFlags.find(f =>
      f.trackId === selection.trackId &&
      Math.abs(f.start - a) < 0.05 &&
      Math.abs(f.end - b) < 0.05
    ) || null;
  }, [selection, manualFlags]);

  const flagSelection = useCallback(() => {
    if (!selection || selection.dragging) return;
    const a = Math.min(selection.start, selection.end);
    const b = Math.max(selection.start, selection.end);
    if (b - a < 0.05) return;
    // If selection matches an existing flag → remove it. Otherwise add a new one.
    if (flagForSelection) {
      setManualFlags((arr) => arr.filter((f) => f.id !== flagForSelection.id));
    } else {
      setManualFlags((arr) => [...arr, { id: `f${Date.now()}`, trackId: selection.trackId, start: a, end: b }]);
    }
    setSelection(null);
  }, [selection, flagForSelection]);

  // Clicking a flag on the timeline selects its range, so the FAB exposes the Unflag affordance.
  const onFlagClick = useCallback((trackId, start, end) => {
    setSelection({ trackId, start, end, dragging: false });
  }, []);

  const undoCorrection = useCallback((id) => {
    setCorrections((arr) => {
      const item = arr.find((c) => c.id === id);
      if (item) setRedoStack((r) => [...r, item]);
      return arr.filter((c) => c.id !== id);
    });
  }, []);
  const undoLast = useCallback(() => {
    setCorrections((arr) => {
      if (arr.length === 0) return arr;
      const [head, ...rest] = arr;
      setRedoStack((r) => [...r, head]);
      return rest;
    });
  }, []);
  const redoLast = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const item = r[r.length - 1];
      setCorrections((arr) => [item, ...arr]);
      return r.slice(0, -1);
    });
  }, []);

  // ── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setCurrentTime((c) => Math.max(0, c - 1 / FPS)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setCurrentTime((c) => Math.min(D, c + 1 / FPS)); }
      else if (e.key === "v" || e.key === "V") { moveSelectionTo("voc"); }
      else if (e.key === "i" || e.key === "I") { moveSelectionTo("ins"); }
      else if (e.key === "f" || e.key === "F") { flagSelection(); }
      else if (e.key === "z" || e.key === "Z") {
        if (e.shiftKey) redoLast();
        else undoLast();
      }
      else if (e.key === "y" || e.key === "Y") { redoLast(); }
      else if (e.key === "Escape") { setSelection(null); setShortcutsOpen(false); }
      else if (e.key === "?") { setShortcutsOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveSelectionTo, flagSelection, undoLast, redoLast, D]);

  // Stats for substage strip
  const stats = useMemo(() => ({
    suspected: remainingBleeds.voc.length + remainingBleeds.ins.length,
    corrections: corrections.length,
  }), [remainingBleeds, corrections]);

  // Ruler click → seek
  const onRulerSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    setCurrentTime(Math.max(0, Math.min(D, x / pxPerSec)));
  };

  // ── Render ─────────────────────────────────────────────────
  const state = t.state;

  // The upload screen REPLACES the editor entirely — it's the page before Stage 1 begins.
  if (state === "upload") {
    return (
      <>
        <UploadScreen />
        <TweaksPanel>
          <TweakSection label="State" />
          <TweakSelect
            label="Screen"
            value={t.state}
            options={["upload", "loading", "empty", "active", "error"]}
            onChange={(v) => setTweak("state", v)}
          />
        </TweaksPanel>
      </>
    );
  }

  return (
    <div className="app">
      <TopHeader
        confirmed={confirmed}
        onConfirm={() => setSaveModalOpen(true)}
        currentStage={1}
      />
      <SubstageStrip
        stats={stats}
        confirmed={confirmed}
        onConfirmToggle={() => setConfirmed((v) => !v)}
        onFocusCorrections={() => {
          setActiveTab("corrections");
          setTweak("historyCollapsed", false);
          const panel = document.querySelector(".history");
          if (panel) {
            panel.classList.add("flash");
            setTimeout(() => panel.classList.remove("flash"), 700);
          }
        }}
        onFocusFlags={() => {
          setActiveTab("flags");
          setTweak("historyCollapsed", false);
          const panel = document.querySelector(".history");
          if (panel) {
            panel.classList.add("flash");
            setTimeout(() => panel.classList.remove("flash"), 700);
          }
        }}
        onProjectAction={(kind) => {
          if (kind === "re-separate") {
            if (confirm("Re-run stem separation? This will discard your corrections and flags.")) {
              setTweak("state", "loading");
              setTweak("loadProgress", 0);
            }
          }
        }}
      />

      <div className={`body ${t.historyCollapsed ? "history-collapsed" : ""} ${state === "loading" || state === "error" ? "no-history" : ""}`}>
        <div className="workspace">
          <div className="timeline">
            {/* Left rail column */}
            <div className="rail-col">
              <div className="rail-head">
                <span className="caps">TRACKS</span>
                <span style={{ marginLeft: "auto", color: "var(--white-30)" }} className="mono">
                  2 / 2
                </span>
              </div>
              <TrackRail
                trackId="voc"
                label="Vocals"
                sublabel="Speech track"
                muted={vocMuted} soloed={vocSolo}
                onToggleMute={() => setVocMuted((v) => !v)}
                onToggleSolo={() => setVocSolo((v) => !v)}
                vol={0.82}
              />
              <TrackRail
                trackId="ins"
                label="Instrumental"
                sublabel="Music & ambience"
                muted={insMuted} soloed={insSolo}
                onToggleMute={() => setInsMuted((v) => !v)}
                onToggleSolo={() => setInsSolo((v) => !v)}
                vol={0.62}
              />
            </div>

            {/* Lane column */}
            <div
              className="lane-col"
              ref={laneColRef}
              onWheel={(e) => {
                // Horizontal scroll via shift+wheel or trackpad horizontal swipe;
                // also allow vertical wheel to scroll horizontally (DAW convention).
                const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                if (Math.abs(dx) < 0.5) return;
                const maxScroll = Math.max(0, contentWidth - viewportWidth);
                setScrollLeft((s) => Math.max(0, Math.min(maxScroll, s + dx)));
                e.preventDefault();
              }}
            >
              <div onClick={onRulerSeek} style={{ cursor: "ew-resize" }}>
                <Ruler
                  contentWidth={contentWidth}
                  viewportWidth={viewportWidth}
                  scrollLeft={scrollLeft}
                  duration={D}
                />
              </div>

              {/* Tracks (lanes) */}
              <Lane
                trackId="voc"
                data={window.PD.WAVE.voc}
                otherData={window.PD.WAVE.ins}
                color="#7dbcff"
                dimColor="rgba(96,165,250,0.18)"
                otherColor="#5eead4"
                regions={regions.voc}
                bleeds={remainingBleeds.voc}
                onFlagClick={onFlagClick}
                muted={vocMuted || (insSolo && !vocSolo)}
                contentWidth={contentWidth}
                viewportWidth={viewportWidth}
                scrollLeft={scrollLeft}
                duration={D}
                selection={selection}
                onSelectionChange={setSelection}
                laneHeight={104}
              />
              <Lane
                trackId="ins"
                data={window.PD.WAVE.ins}
                otherData={window.PD.WAVE.voc}
                color="#5eead4"
                dimColor="rgba(94,234,212,0.18)"
                otherColor="#7dbcff"
                regions={regions.ins}
                bleeds={remainingBleeds.ins}
                onFlagClick={onFlagClick}
                muted={insMuted || (vocSolo && !insSolo)}
                contentWidth={contentWidth}
                viewportWidth={viewportWidth}
                scrollLeft={scrollLeft}
                duration={D}
                selection={selection}
                onSelectionChange={setSelection}
                laneHeight={104}
              />

              {/* Playhead — full-height through both lanes + ruler */}
              <Playhead
                currentTime={currentTime}
                pxPerSec={pxPerSec}
                scrollLeft={scrollLeft}
                viewportWidth={viewportWidth}
              />

              {/* FAB (selection action) */}
              <SelectionFab
                selection={selection}
                isFlagged={!!flagForSelection}
                xOf={(s) => s * pxPerSec}
                scrollLeft={scrollLeft}
                viewportWidth={viewportWidth}
                onMove={() => moveSelectionTo(selection?.trackId === "voc" ? "ins" : "voc")}
                onFlag={flagSelection}
                onDismiss={() => setSelection(null)}
              />

              {/* Horizontal scrollbar (custom) */}
              <Scrollbar
                contentWidth={contentWidth}
                viewportWidth={viewportWidth}
                scrollLeft={scrollLeft}
                onScroll={setScrollLeft}
              />
            </div>
          </div>

          <Transport
            playing={playing}
            onPlayToggle={() => setPlaying((p) => !p)}
            currentTime={currentTime}
            duration={D}
            onStepFrame={(dir) => setCurrentTime((c) => Math.max(0, Math.min(D, c + dir / FPS)))}
            onJumpEdge={(edge) => setCurrentTime(edge === "start" ? 0 : D)}
            zoom={zoom}
            onZoomChange={setZoom}
            zoomMin={ZOOM_MIN}
            zoomMax={ZOOM_MAX}
            onShowShortcuts={() => setShortcutsOpen((v) => !v)}
            onUndo={undoLast}
            canUndo={corrections.length > 0}
            onRedo={redoLast}
            canRedo={redoStack.length > 0}
          />

          {shortcutsOpen && <ShortcutsPopover onClose={() => setShortcutsOpen(false)} />}

          {/* State overlays */}
          {state === "loading" && <LoadingOverlay progress={t.loadProgress} />}
          {state === "error" && <ErrorOverlay />}
        </div>

        {state !== "loading" && state !== "error" && (
          <HistoryPanel
            corrections={corrections}
            flags={manualFlags}
            onUndo={undoCorrection}
            onRemoveFlag={(id) => setManualFlags((arr) => arr.filter((f) => f.id !== id))}
            onFocusFlag={(f) => {
              setSelection({ trackId: f.trackId, start: f.start, end: f.end, dragging: false });
              setCurrentTime(f.start);
            }}
            onFocusCorrection={(c) => {
              setCurrentTime(c.start);
            }}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            collapsed={t.historyCollapsed}
            onToggleCollapse={() => setTweak("historyCollapsed", !t.historyCollapsed)}
          />
        )}
      </div>

      {/* Save success modal */}
      {saveModalOpen && (
        <SaveContinueModal
          stats={stats}
          remainingBleeds={remainingBleeds}
          onCancel={() => setSaveModalOpen(false)}
          onConfirm={() => { setSaveModalOpen(false); /* would navigate to stage 2 */ }}
        />
      )}

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="State" />
        <TweakSelect
          label="Screen"
          value={t.state}
          options={["upload", "loading", "empty", "active", "error"]}
          onChange={(v) => setTweak("state", v)}
        />
        {t.state === "loading" && (
          <TweakSlider label="Separation progress" value={t.loadProgress} min={0} max={100} unit="%"
                       onChange={(v) => setTweak("loadProgress", v)} />
        )}
        <TweakSection label="View" />
        <TweakToggle label="Many corrections" value={t.manyCorrections}
                     onChange={(v) => setTweak("manyCorrections", v)} />
        <TweakToggle label="Collapse history" value={t.historyCollapsed}
                     onChange={(v) => setTweak("historyCollapsed", v)} />
      </TweaksPanel>
    </div>
  );
}

// ── Playhead ──
function Playhead({ currentTime, pxPerSec, scrollLeft, viewportWidth }) {
  const x = currentTime * pxPerSec - scrollLeft;
  if (x < -2 || x > viewportWidth + 2) return null;
  return (
    <div className="playhead" style={{ left: x }}>
      <div className="cap" />
      <div className="time mono">{window.PD.fmtTC(currentTime)}</div>
    </div>
  );
}

// ── Scrollbar ──
function Scrollbar({ contentWidth, viewportWidth, scrollLeft, onScroll }) {
  const dragRef = useRef(null);
  if (contentWidth <= viewportWidth + 1) return null;
  const trackPadding = 8;
  const trackW = viewportWidth - trackPadding * 2;
  const thumbW = Math.max(40, (viewportWidth / contentWidth) * trackW);
  const maxScroll = contentWidth - viewportWidth;
  const thumbLeft = (scrollLeft / maxScroll) * (trackW - thumbW);

  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startScroll: scrollLeft };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const trackTravel = trackW - thumbW;
    if (trackTravel <= 0) return;
    const dScroll = (dx / trackTravel) * maxScroll;
    onScroll(Math.max(0, Math.min(maxScroll, dragRef.current.startScroll + dScroll)));
  };
  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", endDrag);
  };

  // Click-on-track to page-jump
  const onTrackClick = (e) => {
    if (e.target.classList.contains("scroll-thumb")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const click = e.clientX - rect.left;
    const trackTravel = trackW - thumbW;
    const targetThumb = Math.max(0, Math.min(trackTravel, click - thumbW / 2));
    onScroll((targetThumb / trackTravel) * maxScroll);
  };

  return (
    <div
      className="scroll-track"
      onMouseDown={onTrackClick}
      style={{ left: trackPadding, right: trackPadding }}
    >
      <div
        className="scroll-thumb"
        onMouseDown={startDrag}
        style={{ left: thumbLeft, width: thumbW }}
      />
    </div>
  );
}

// ── State overlays ──
function LoadingOverlay({ progress }) {
  const steps = [
    { lbl: "Decoding source audio", pct: Math.min(100, progress * 4) },
    { lbl: "Separating vocals & instrumental", pct: Math.max(0, Math.min(100, (progress - 25) * 1.34)) },
  ];
  return (
    <div className="overlay">
      <div className="panel">
        <h3>Separating stems</h3>
        <p>Splitting your source audio into vocals and instrumental. You can leave this tab — we'll notify you when review is ready.</p>
        <div className="pbar"><div className="pfill" style={{ width: `${progress}%` }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--white-50)" }}>
          <span className="mono">{progress}%</span>
          <span>About {Math.max(1, Math.ceil((100 - progress) * 0.18))}m remaining</span>
        </div>
        <div className="stagestrip">
          {steps.map((s, i) => {
            const done = s.pct >= 100;
            const cur = !done && s.pct > 0;
            return (
              <div key={i} className={`step ${done ? "done" : ""} ${cur ? "cur" : ""}`}>
                <span className="ms sz-18">
                  {done ? "check_circle" : cur ? "progress_activity" : "radio_button_unchecked"}
                </span>
                <span className="lbl">{s.lbl}</span>
                <span className="pct mono">{Math.floor(s.pct)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ErrorOverlay() {
  return (
    <div className="overlay error">
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span className="ms sz-32" style={{ color: "#fca5a5", fontSize: 28 }}>error</span>
          <h3 style={{ margin: 0 }}>Source audio failed to load</h3>
        </div>
        <p>
          We couldn't fetch <span className="mono" style={{ color: "var(--fg)" }}>RIL_EP_49_FHD_SDR_1.mxf</span> from the project bucket.
          The asset may have been moved, or your session expired.
        </p>
        <p style={{ marginTop: 12, color: "var(--white-50)", fontSize: 12 }}>
          <span className="mono">err.stems.404</span> · 03:11 IST · attempt 3/3
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button className="btn ghost"><span className="ms sz-16">refresh</span>Retry</button>
          <button className="btn ghost"><span className="ms sz-16">upload_file</span>Upload a new file</button>
          <button className="btn ghost" style={{ marginLeft: "auto" }}>
            <span className="ms sz-16">arrow_back</span>Back to project
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Upload screen (precedes Stage 1) ─────────────────────────
function UploadScreen() {
  const [dragOver, setDragOver] = useState(false);
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
          className={`dropzone ${dragOver ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); }}
        >
          <input type="file" accept="video/*,audio/*" hidden />
          <div className="drop-icon">
            <span className="ms sz-32">upload_file</span>
          </div>
          <div className="drop-title">Drop file here, or <u>browse</u></div>
          <div className="drop-formats">MXF · MP4 · MOV · WAV · MP3 · up to 8 GB</div>
        </label>

        <div className="upload-meta">
          <div className="meta-row">
            <div className="meta-k">Source language</div>
            <div className="meta-v">
              <select className="meta-select" defaultValue="hi">
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
              <select className="meta-select" defaultValue="en">
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
              <select className="meta-select" defaultValue="24">
                <option value="23.976">23.976</option>
                <option value="24">24</option>
                <option value="25">25</option>
                <option value="29.97">29.97</option>
                <option value="30">30</option>
              </select>
            </div>
          </div>
        </div>

        <div className="upload-actions">
          <button className="btn ghost"><span className="ms sz-16">link</span>Paste S3 / Drive URL</button>
          <button className="btn primary">
            <span>Start separation</span>
            <span className="ms sz-16">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Save & Continue modal ──
function SaveContinueModal({ stats, remainingBleeds, onCancel, onConfirm }) {
  const [phase, setPhase] = useState("review"); // 'review' | 'saving' | 'done'
  const totalFlags = remainingBleeds.voc.length + remainingBleeds.ins.length;

  const handleConfirm = () => {
    setPhase("saving");
    setTimeout(() => setPhase("done"), 1200);
  };

  return (
    <div className="modal-scrim" onMouseDown={onCancel}>
      <div className="save-modal" onMouseDown={(e) => e.stopPropagation()}>
        {phase === "review" && (
          <>
            <div className="save-modal-art">
              <div className="ribbon">
                <div className="ribbon-track ribbon-voc">
                  <div className="ribbon-bar" style={{ left: "10%", width: "18%" }} />
                  <div className="ribbon-bar dimmed" style={{ left: "32%", width: "14%" }} />
                  <div className="ribbon-bar" style={{ left: "50%", width: "22%" }} />
                  <div className="ribbon-bar" style={{ left: "76%", width: "12%" }} />
                </div>
                <div className="ribbon-track ribbon-ins">
                  <div className="ribbon-bar" style={{ left: "4%", width: "94%" }} />
                </div>
                <div className="ribbon-check">
                  <span className="ms sz-22">check</span>
                </div>
              </div>
            </div>
            <h3>Lock in stem assignments?</h3>
            <p>
              Your corrections become the source-of-truth for downstream stages.
              You'll still be able to come back and edit until lipsync is finalized.
            </p>
            <div className="save-stats">
              <div className="save-stat">
                <div className="save-stat-v mono">{stats.corrections}</div>
                <div className="save-stat-l">corrections<br />applied</div>
              </div>
              <div className="save-stat-sep" />
              <div className="save-stat">
                <div className="save-stat-v mono">{totalFlags}</div>
                <div className="save-stat-l">
                  flagged regions<br />
                  <span style={{ color: totalFlags > 0 ? "#fde047" : "var(--white-50)" }}>
                    {totalFlags > 0 ? "left unreviewed" : "all reviewed"}
                  </span>
                </div>
              </div>
              <div className="save-stat-sep" />
              <div className="save-stat">
                <div className="save-stat-v mono">02:14:08</div>
                <div className="save-stat-l">runtime<br />locked</div>
              </div>
            </div>
            {totalFlags > 0 && (
              <div className="save-warn">
                <span className="ms sz-16">warning</span>
                <span>
                  {totalFlags} bleed flag{totalFlags === 1 ? "" : "s"} {totalFlags === 1 ? "is" : "are"} still unresolved — they'll carry forward as-is.
                </span>
              </div>
            )}
            <div className="save-actions">
              <button className="btn ghost" onClick={onCancel}>Keep editing</button>
              <button className="btn primary" onClick={handleConfirm}>
                <span>Continue to Diarization</span>
                <span className="ms sz-16">arrow_forward</span>
              </button>
            </div>
          </>
        )}
        {phase === "saving" && (
          <div className="save-progress">
            <div className="save-spinner"><span className="ms sz-32">progress_activity</span></div>
            <h3>Committing stems…</h3>
            <p>Writing tracks to project bucket and notifying the diarization stage.</p>
          </div>
        )}
        {phase === "done" && (
          <div className="save-progress done">
            <div className="save-spinner-check"><span className="ms sz-32">check</span></div>
            <h3>Stage 1 complete</h3>
            <p>Diarization is ready when you are. We've notified <b>Aman Roy</b> on the project.</p>
            <div className="save-actions" style={{ marginTop: 24 }}>
              <button className="btn ghost" onClick={onCancel}>Stay on stems</button>
              <button className="btn primary" onClick={onConfirm}>
                <span>Open Diarization</span>
                <span className="ms sz-16">arrow_forward</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { App, Playhead, Scrollbar, LoadingOverlay, ErrorOverlay, UploadScreen, SaveContinueModal });
