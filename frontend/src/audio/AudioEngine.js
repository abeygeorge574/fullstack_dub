/**
 * Web Audio API playback engine.
 *
 * Applies corrections in real-time:
 *   - Silences regions moved OUT of a track (c.from === trackId)
 *   - Grafts audio from the other track for regions moved IN (c.to === trackId)
 *
 * On every play/seek/correction-change the node graph is rebuilt from scratch.
 * Corrections are assumed non-overlapping (the editor enforces this).
 */
export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._vocBuffer = null;
    this._insBuffer = null;
    this._playing = false;
    this._startedAt = 0;
    this._offsetAtStart = 0;
    this._nodes = [];
    this._corrections = [];
    this._vocEnabled = true;
    this._insEnabled = true;
    this._loaded = false;
  }

  get isLoaded() { return this._loaded; }
  get isPlaying() { return this._playing; }

  async load(vocUrl, insUrl) {
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    const [vAB, iAB] = await Promise.all([
      fetch(vocUrl).then((r) => r.arrayBuffer()),
      fetch(insUrl).then((r) => r.arrayBuffer()),
    ]);
    [this._vocBuffer, this._insBuffer] = await Promise.all([
      this._ctx.decodeAudioData(vAB),
      this._ctx.decodeAudioData(iAB),
    ]);
    this._loaded = true;
  }

  getCurrentTime() {
    if (!this._ctx || !this._playing) return this._offsetAtStart;
    return Math.min(
      this._vocBuffer?.duration ?? Infinity,
      this._offsetAtStart + (this._ctx.currentTime - this._startedAt),
    );
  }

  play(fromTime) {
    if (!this._loaded) return;
    this._stopNodes();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    this._startFrom(fromTime ?? this._offsetAtStart);
  }

  pause() {
    if (!this._playing) return;
    this._offsetAtStart = this.getCurrentTime();
    this._stopNodes();
    this._playing = false;
  }

  seek(t) {
    const wasPlaying = this._playing;
    this._stopNodes();
    this._playing = false;
    this._offsetAtStart = Math.max(0, t);
    if (wasPlaying) {
      if (this._ctx?.state === 'suspended') this._ctx.resume();
      this._playing = true;
      this._startFrom(this._offsetAtStart);
    }
  }

  setCorrections(corrections) {
    this._corrections = corrections;
    if (this._playing) {
      const t = this.getCurrentTime();
      this._stopNodes();
      this._startFrom(t);
    }
  }

  setEnabled(vocEnabled, insEnabled) {
    if (vocEnabled === this._vocEnabled && insEnabled === this._insEnabled) return;
    this._vocEnabled = vocEnabled;
    this._insEnabled = insEnabled;
    if (this._playing) {
      const t = this.getCurrentTime();
      this._stopNodes();
      this._startFrom(t);
    }
  }

  _startFrom(offset) {
    const dur = (this._vocBuffer?.duration ?? 0) - offset;
    if (dur <= 0) { this._offsetAtStart = offset; return; }
    const startWhen = this._ctx.currentTime;
    this._offsetAtStart = offset;
    this._startedAt = startWhen;
    this._buildGraph(startWhen, offset, dur);
  }

  _buildGraph(startWhen, offset, duration) {
    const ctx = this._ctx;
    const cs = this._corrections;

    const buildLayer = (mainBuf, otherBuf, trackId, enabled) => {
      if (!enabled) return;

      // Base layer — full buffer with gain automation to silence moved-out regions
      const src = ctx.createBufferSource();
      src.buffer = mainBuf;
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(1, startWhen);

      for (const c of cs.filter((c) => c.from === trackId)) {
        const silStart = startWhen + Math.max(0, c.start - offset);
        const silEnd   = startWhen + Math.max(0, c.end   - offset);
        if (silStart < startWhen + duration && silEnd > startWhen) {
          gain.gain.setValueAtTime(0, Math.max(startWhen, silStart));
          gain.gain.setValueAtTime(1, Math.min(startWhen + duration, silEnd));
        }
      }

      src.start(startWhen, offset, duration);
      this._nodes.push(src);

      // Graft layer — play slices from the other buffer for moved-in regions
      for (const c of cs.filter((c) => c.to === trackId)) {
        const clipStart = Math.max(c.start, offset);
        const clipEnd   = Math.min(c.end,   offset + duration);
        if (clipEnd <= clipStart) continue;
        const graft = ctx.createBufferSource();
        graft.buffer = otherBuf;
        graft.connect(ctx.destination);
        graft.start(startWhen + (clipStart - offset), clipStart, clipEnd - clipStart);
        this._nodes.push(graft);
      }
    };

    buildLayer(this._vocBuffer, this._insBuffer, 'voc', this._vocEnabled);
    buildLayer(this._insBuffer, this._vocBuffer, 'ins', this._insEnabled);
  }

  _stopNodes() {
    for (const node of this._nodes) {
      try { node.stop(); } catch {}
    }
    this._nodes = [];
  }

  destroy() {
    this._stopNodes();
    this._ctx?.close();
  }
}
