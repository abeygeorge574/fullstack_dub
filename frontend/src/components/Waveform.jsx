import { useRef, useEffect } from 'react';
import { fmtTC } from '../utils/timecode.js';

export function WaveformCanvas({
  data, color, dimColor, width, height,
  lit, clipStart = 0, clipEnd = 1,
  barW: barWProp = 1.0, gap: gapProp = 0.5,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width || !height || !data) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
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
      ctx.fillStyle = lit ? color : (dimColor || color);
      ctx.fillRect(x, mid - h / 2, barW, h);
    }
  }, [data, color, dimColor, width, height, lit, clipStart, clipEnd, barWProp, gapProp]);

  return <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 0 }} />;
}

function silencedMask(ranges, contentWidth, duration) {
  if (!ranges.length) return 'none';
  const xOf = (t) => (t / duration) * contentWidth;
  const stops = ['#000 0px'];
  for (const r of ranges) {
    const a = xOf(r.start);
    const b = xOf(r.end);
    stops.push(`#000 ${a}px`);
    stops.push(`transparent ${a}px`);
    stops.push(`transparent ${b}px`);
    stops.push(`#000 ${b}px`);
  }
  stops.push(`#000 ${contentWidth}px`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function Gridlines({ contentWidth, scrollLeft, duration }) {
  const lines = [];
  const stepSec = 5;
  for (let t = 0; t < duration; t += stepSec) {
    const x = (t / duration) * contentWidth - scrollLeft;
    if (x < -5 || x > 5000) continue;
    const major = t % 30 === 0;
    lines.push(<div key={t} className={`gl ${major ? 'major' : ''}`} style={{ left: x }} />);
  }
  return <div className="gridlines">{lines}</div>;
}

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

export function Lane({
  trackId, data, otherData, htdData, color, dimColor, otherColor,
  allWaves,  // { voc, htd, ins } — preferred over otherData for 3-track grafts
  regions, bleeds, onFlagClick,
  muted,
  contentWidth, viewportWidth, scrollLeft, duration,
  selection, onSelectionChange,
  laneHeight, fps = 24,
}) {
  const ref = useRef(null);
  const dragRef = useRef(null);

  const xOf = (t) => (t / duration) * contentWidth;
  const tOf = (x) => (x / contentWidth) * duration;

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft;
    dragRef.current = { startX: x, lastX: x };
    onSelectionChange({ trackId, start: tOf(x), end: tOf(x), dragging: true });
    e.preventDefault();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
      onSelectionChange(null);
    } else {
      onSelectionChange({ trackId, start: tOf(a), end: tOf(b), dragging: false });
    }
    dragRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  const silencedRanges = regions.filter((r) => r.kind === 'silenced');
  const hasSelectionOnThis = selection && selection.trackId === trackId;

  return (
    <div className={`lane ${trackId}`} ref={ref} onMouseDown={onMouseDown}>
      <Gridlines contentWidth={contentWidth} scrollLeft={scrollLeft} duration={duration} />

      <div style={{
        position: 'absolute',
        left: -scrollLeft,
        top: 0,
        width: contentWidth,
        height: laneHeight,
        pointerEvents: 'none',
        WebkitMaskImage: silencedMask(silencedRanges, contentWidth, duration),
        maskImage: silencedMask(silencedRanges, contentWidth, duration),
      }}>
        <WaveformCanvas
          data={data}
          color={muted ? 'rgba(255,255,255,0.18)' : color}
          dimColor={muted ? 'rgba(255,255,255,0.08)' : dimColor}
          width={contentWidth}
          height={laneHeight}
          lit={!muted}
        />
      </div>

      <div style={{ position: 'absolute', inset: 0 }}>
        {bleeds.map((b, i) => {
          const left = xOf(b.s) - scrollLeft;
          const w = xOf(b.e) - xOf(b.s);
          if (left + w < 0 || left > viewportWidth) return null;
          return (
            <div
              key={b.id || i}
              className="bleed-flag manual"
              style={{ left, width: w }}
              title={`Flagged · ${fmtTC(b.s, fps)} – ${fmtTC(b.e, fps)} · click to select`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onFlagClick?.(trackId, b.s, b.e);
              }}
            />
          );
        })}
      </div>

      <div style={{ position: 'absolute', inset: 0 }}>
        {regions.map((r, i) => {
          const left = xOf(r.start) - scrollLeft;
          const w = xOf(r.end) - xOf(r.start);
          if (left + w < 0 || left > viewportWidth) return null;
          if (r.kind === 'silenced') {
            return (
              <div key={i} className={`region silenced ${r.deleted ? 'deleted' : ''}`} style={{ left, width: w }} title={r.title}>
                <span className="ms sz-14 icon">{r.deleted ? 'cut' : 'block'}</span>
              </div>
            );
          }
          const isHtd = r.from === 'htd';
          const cls = r.from === 'voc' ? 'from-voc' : isHtd ? 'from-htd' : 'from-ins';
          const clipStart = r.start / duration;
          const clipEnd = r.end / duration;
          const graftColor = isHtd ? '#a78bfa' : otherColor;
          // Pick source waveform: allWaves map is preferred for 3-track accuracy
          const sourceData = allWaves
            ? (allWaves[r.from] ?? otherData)
            : isHtd ? (htdData ?? otherData) : otherData;
          const badgeLabel = isHtd ? 'htdemucs' : r.from === 'voc' ? 'vocals' : 'instrumental';
          return (
            <div
              key={i}
              className={`region grafted ${cls} ${muted ? 'muted' : ''}`}
              style={{ left, width: w }}
              title={r.title}
            >
              <WaveformCanvas
                data={sourceData}
                color={muted ? 'rgba(255,255,255,0.22)' : graftColor}
                dimColor={muted ? 'rgba(255,255,255,0.10)' : graftColor}
                width={w}
                height={laneHeight - 8}
                clipStart={clipStart}
                clipEnd={clipEnd}
                barW={1.0}
                gap={0.5}
                lit={!muted}
              />
              <span className="badge">
                <span className="ms sz-14" style={{ fontSize: 11 }}>{isHtd ? 'merge' : 'swap_horiz'}</span>
                from {badgeLabel}
              </span>
            </div>
          );
        })}
      </div>

      {hasSelectionOnThis && (
        <SelectionOverlay selection={selection} xOf={xOf} scrollLeft={scrollLeft} />
      )}
    </div>
  );
}
