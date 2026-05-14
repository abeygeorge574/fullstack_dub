// waveform.jsx — Canvas waveform renderer + lane interaction (selection + hover).

const { useRef, useEffect, useState, useMemo, useCallback, useLayoutEffect } = React;

// ── Waveform canvas ───────────────────────────────────────────
// Draws thin vertical bars from amplitude data, mirrored around mid.
// `clipStart` / `clipEnd` are sample-fractions [0..1] — when set, only the
// subrange is drawn (used by grafted regions to render a slice of source data).
function WaveformCanvas({
  data, color, dimColor, width, height, contentLeft, lit,
  clipStart = 0, clipEnd = 1,
  barW: barWProp = 1.2, gap: gapProp = 1.2,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const barW = barWProp;
    const gap = gapProp;
    const step = barW + gap;
    const nBars = Math.floor(width / step);
    const sliceLen = Math.max(1, (clipEnd - clipStart) * data.length);
    const samplesPerBar = sliceLen / nBars;
    const offset = clipStart * data.length;
    const maxBarH = height - 6;

    for (let i = 0; i < nBars; i++) {
      const s = Math.floor(offset + i * samplesPerBar);
      const e = Math.max(s + 1, Math.floor(offset + (i + 1) * samplesPerBar));
      let max = 0, sum = 0;
      for (let j = s; j < e; j++) {
        const v = data[j] || 0;
        if (v > max) max = v;
        sum += v;
      }
      const avg = sum / (e - s);
      const h = Math.max(1, Math.pow(0.35 * avg + 0.65 * max, 1.0) * maxBarH);
      const x = i * step;
      ctx.fillStyle = lit ? color : dimColor || color;
      ctx.fillRect(x, mid - h / 2, barW, h);
    }
  }, [data, color, dimColor, width, height, lit, clipStart, clipEnd, barWProp, gapProp]);

  return <canvas ref={ref} style={{ position: "absolute", left: contentLeft || 0, top: 0 }} />;
}

// ── Lane (one track's waveform area + selection + regions) ────
// Props:
//   trackId, data, color, dimColor
//   regions: [{ kind: 'silenced'|'grafted', from?, to?, start, end }]
//   bleeds: [{ start, end }] — auto-detected suspect ranges
//   muted: bool
//   contentWidth, viewportWidth, scrollLeft, duration
//   selection: { trackId, start, end } | null
//   onSelectionChange, onLaneClick
function Lane({
  trackId, data, otherData, color, dimColor, otherColor,
  regions, bleeds, onFlagClick,
  muted,
  contentWidth, viewportWidth, scrollLeft, duration,
  selection, onSelectionChange,
  laneHeight,
}) {
  const ref = useRef(null);
  const dragRef = useRef(null);

  const xOf = (t) => (t / duration) * contentWidth;
  const tOf = (x) => (x / contentWidth) * duration;

  // Mouse drag select
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    dragRef.current = { startX: x, lastX: x };
    onSelectionChange({ trackId, start: tOf(x), end: tOf(x), dragging: true });
    e.preventDefault();
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(contentWidth, e.clientX - rect.left + scrollLeft));
    dragRef.current.lastX = x;
    const a = Math.min(dragRef.current.startX, x);
    const b = Math.max(dragRef.current.startX, x);
    onSelectionChange({ trackId, start: tOf(a), end: tOf(b), dragging: true });
  };
  const onMouseUp = () => {
    if (!dragRef.current) return;
    const a = Math.min(dragRef.current.startX, dragRef.current.lastX);
    const b = Math.max(dragRef.current.startX, dragRef.current.lastX);
    if (b - a < 4) {
      onSelectionChange(null); // tap, no range
    } else {
      onSelectionChange({ trackId, start: tOf(a), end: tOf(b), dragging: false });
    }
    dragRef.current = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  // Build cut-out mask for silenced regions (so the waveform isn't drawn there)
  const silencedRanges = regions.filter(r => r.kind === "silenced");
  const hasSelectionOnThis = selection && selection.trackId === trackId;

  return (
    <div className={`lane ${trackId}`} ref={ref} onMouseDown={onMouseDown}>
      {/* Gridlines (echoed from ruler) */}
      <Gridlines
        contentWidth={contentWidth}
        scrollLeft={scrollLeft}
        duration={duration}
      />

      {/* Waveform canvas — scrolls inside the lane */}
      <div style={{
        position: "absolute",
        left: -scrollLeft,
        top: 0,
        width: contentWidth,
        height: laneHeight,
        pointerEvents: "none",
        // mask: punch out silenced ranges
        WebkitMaskImage: silencedMask(silencedRanges, contentWidth, duration),
        maskImage: silencedMask(silencedRanges, contentWidth, duration),
      }}>
        <WaveformCanvas
          data={data}
          color={muted ? "rgba(255,255,255,0.18)" : color}
          dimColor={muted ? "rgba(255,255,255,0.08)" : dimColor}
          width={contentWidth}
          height={laneHeight}
          lit={!muted}
        />
      </div>

      {/* Bleed flags (manual user flags) */}
      <div style={{ position: "absolute", inset: 0 }}>
        {bleeds.map((b, i) => {
          const left = xOf(b.s) - scrollLeft;
          const w = xOf(b.e) - xOf(b.s);
          if (left + w < 0 || left > viewportWidth) return null;
          const isManual = b.kind === "manual";
          return (
            <div
              key={b.id || i}
              className={`bleed-flag ${isManual ? "manual" : ""}`}
              style={{ left, width: w }}
              title={`Flagged · ${window.PD.fmtTC(b.s)} – ${window.PD.fmtTC(b.e)} · click to select`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onFlagClick?.(trackId, b.s, b.e);
              }}
            />
          );
        })}
      </div>

      {/* Region overlays (silenced / grafted) */}
      <div style={{ position: "absolute", inset: 0 }}>
        {regions.map((r, i) => {
          const left = xOf(r.start) - scrollLeft;
          const w = xOf(r.end) - xOf(r.start);
          if (left + w < 0 || left > viewportWidth) return null;
          if (r.kind === "silenced") {
            return (
              <div key={i} className="region silenced" style={{ left, width: w }} title={r.title}>
                <span className="ms sz-14 icon">block</span>
              </div>
            );
          }
          // grafted
          const cls = r.from === "voc" ? "from-voc" : "from-ins";
          const clipStart = r.start / duration;
          const clipEnd = r.end / duration;
          return (
            <div key={i} className={`region grafted ${cls} ${muted ? "muted" : ""}`} style={{ left, width: w }} title={r.title}>
              <WaveformCanvas
                data={otherData}
                color={muted ? "rgba(255,255,255,0.22)" : otherColor}
                dimColor={muted ? "rgba(255,255,255,0.10)" : otherColor}
                width={w}
                height={laneHeight - 8}
                clipStart={clipStart}
                clipEnd={clipEnd}
                barW={1.2}
                gap={1.2}
                lit={!muted}
              />
              <span className="badge">
                <span className="ms sz-14" style={{ fontSize: 11 }}>swap_horiz</span>
                from {r.from === "voc" ? "vocals" : "instrumental"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Selection overlay (only on this lane) */}
      {hasSelectionOnThis && (
        <SelectionOverlay
          selection={selection}
          xOf={xOf}
          scrollLeft={scrollLeft}
        />
      )}
    </div>
  );
}

// Build a CSS mask-image that hides silenced ranges from the waveform canvas layer.
function silencedMask(ranges, contentWidth, duration) {
  if (!ranges.length) return "none";
  const xOf = (t) => (t / duration) * contentWidth;
  const stops = ["#000 0px"];
  let cursor = 0;
  for (const r of ranges) {
    const a = xOf(r.start);
    const b = xOf(r.end);
    stops.push(`#000 ${a}px`);
    stops.push(`transparent ${a}px`);
    stops.push(`transparent ${b}px`);
    stops.push(`#000 ${b}px`);
    cursor = b;
  }
  stops.push(`#000 ${contentWidth}px`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

// ── Gridlines ──
function Gridlines({ contentWidth, scrollLeft, duration }) {
  // Draw a vertical line every 5s; majors every 30s.
  const lines = [];
  const stepSec = 5;
  for (let t = 0; t < duration; t += stepSec) {
    const x = (t / duration) * contentWidth - scrollLeft;
    if (x < -5 || x > 5000) continue;
    const major = t % 30 === 0;
    lines.push(<div key={t} className={`gl ${major ? "major" : ""}`} style={{ left: x }} />);
  }
  return <div className="gridlines">{lines}</div>;
}

// ── Selection overlay ──
function SelectionOverlay({ selection, xOf, scrollLeft }) {
  const a = xOf(Math.min(selection.start, selection.end)) - scrollLeft;
  const b = xOf(Math.max(selection.start, selection.end)) - scrollLeft;
  return (
    <div className="selection" style={{ left: a, width: b - a }}>
      <div className="handle l" />
      <div className="handle r" />
    </div>
  );
}

Object.assign(window, { WaveformCanvas, Lane, Gridlines, SelectionOverlay, silencedMask });
