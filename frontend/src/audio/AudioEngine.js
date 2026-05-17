/**
 * Web Audio API playback engine — 3-track (voc / htd / ins).
 *
 * Each track can have corrections:
 *   c.from === trackId  → silence that region on the source track
 *   c.to   === trackId  → graft audio from c.from buffer into this track
 *
 * Node graph is rebuilt from scratch on every play/seek/correction change.
 */
export class AudioEngine {
  constructor() {
    this._ctx = null;
    this._buffers = { voc: null, htd: null, ins: null };
    this._enabled = { voc: true, htd: true, ins: true };
    this._playing = false;
    this._startedAt = 0;
    this._offsetAtStart = 0;
    this._nodes = [];
    this._corrections = [];
    this._loaded = false;
  }

  get isLoaded() { return this._loaded; }
  get isPlaying() { return this._playing; }

  async load(vocUrl, htdUrl, insUrl) {
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    const fetchBuf = async (url) => {
      if (!url) return null;
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ab = await r.arrayBuffer();
        return await this._ctx.decodeAudioData(ab);
      } catch {
        return null;
      }
    };

    const [vBuf, hBuf, iBuf] = await Promise.all([
      fetchBuf(vocUrl),
      fetchBuf(htdUrl),
      fetchBuf(insUrl),
    ]);
    this._buffers = { voc: vBuf, htd: hBuf, ins: iBuf };
    // Ready when the two primary tracks are loaded
    this._loaded = !!(vBuf && iBuf);
    if (!this._loaded) throw new Error('Failed to load voc or ins audio buffer');
  }

  _maxDuration() {
    return Math.max(...Object.values(this._buffers).map((b) => b?.duration ?? 0));
  }

  getCurrentTime() {
    if (!this._ctx || !this._playing) return this._offsetAtStart;
    return Math.min(
      this._maxDuration(),
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

  // vocEnabled, htdEnabled, insEnabled
  setEnabled(vocEnabled, htdEnabled, insEnabled) {
    const next = { voc: vocEnabled, htd: htdEnabled, ins: insEnabled };
    if (
      next.voc === this._enabled.voc &&
      next.htd === this._enabled.htd &&
      next.ins === this._enabled.ins
    ) return;
    this._enabled = next;
    if (this._playing) {
      const t = this.getCurrentTime();
      this._stopNodes();
      this._startFrom(t);
    }
  }

  _startFrom(offset) {
    const dur = this._maxDuration() - offset;
    if (dur <= 0) { this._offsetAtStart = offset; return; }
    const startWhen = this._ctx.currentTime;
    this._offsetAtStart = offset;
    this._startedAt = startWhen;
    this._buildGraph(startWhen, offset, dur);
  }

  _buildGraph(startWhen, offset, duration) {
    const ctx = this._ctx;
    const cs = this._corrections;

    for (const [trackId, mainBuf] of Object.entries(this._buffers)) {
      if (!mainBuf || !this._enabled[trackId]) continue;

      // Base layer: full buffer with gain automation for silenced regions
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

      // Graft layer: play slices from source buffer for moved-in regions
      for (const c of cs.filter((c) => c.to === trackId)) {
        const srcBuf = this._buffers[c.from];
        if (!srcBuf) continue;
        const clipStart = Math.max(c.start, offset);
        const clipEnd   = Math.min(c.end,   offset + duration);
        if (clipEnd <= clipStart) continue;
        const graft = ctx.createBufferSource();
        graft.buffer = srcBuf;
        graft.connect(ctx.destination);
        graft.start(startWhen + (clipStart - offset), clipStart, clipEnd - clipStart);
        this._nodes.push(graft);
      }
    }
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
