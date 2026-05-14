// data.jsx — waveform synthesis + initial state for the prototype.
// Pure data + helpers. No React.

const FPS = 24;
const DURATION_SEC = 134 + 8 / 24;   // 02:14:08
const SAMPLES = 1600;                 // amplitude samples for the whole duration

// ── Timecode helpers ──────────────────────────────────────────
function pad(n, w = 2) { return String(Math.max(0, Math.floor(n))).padStart(w, "0"); }
function fmtTC(sec) {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total - Math.floor(total)) * FPS);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}
function fmtTCshort(sec) {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${pad(m)}:${pad(s)}`;
}

// ── Seeded RNG ────────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Speech / music synthesis ──────────────────────────────────
// Vocals: bursts of high-amp activity (speech) separated by quiet.
// Instrumental: continuous lower-amp envelope (music).
function buildWaveforms() {
  const N = SAMPLES;
  const voc = new Float32Array(N);
  const ins = new Float32Array(N);

  const rngV = mulberry32(0x51c0ffee);
  const rngI = mulberry32(0xbeef0011);

  // Vocals — define a set of "speech windows" (in seconds)
  // Note: a couple of these are deliberately MUSIC-LIKE (bleed of instrumental into vocals)
  const speechWindows = [
    { s: 2.2,  e: 7.4,  kind: "speech" },
    { s: 9.0,  e: 14.6, kind: "speech" },
    { s: 17.2, e: 21.5, kind: "speech" },
    { s: 22.5, e: 26.0, kind: "music-bleed" }, // BLEED — seeded selection
    { s: 28.4, e: 30.6, kind: "speech" },
    { s: 31.0, e: 38.8, kind: "music-bleed" }, // BLEED — already corrected (c1)
    { s: 41.4, e: 47.5, kind: "speech" },
    { s: 50.8, e: 56.6, kind: "speech" },
    { s: 59.2, e: 64.4, kind: "speech" },
    { s: 67.3, e: 71.0, kind: "music-bleed" }, // BLEED
    { s: 74.0, e: 79.6, kind: "speech" },
    { s: 82.0, e: 87.8, kind: "speech" },
    { s: 90.5, e: 95.4, kind: "speech" },
    { s: 98.6, e: 104.2, kind: "speech" },
    { s: 107.0, e: 111.4, kind: "music-bleed" }, // BLEED
    { s: 113.5, e: 119.7, kind: "speech" },
    { s: 122.0, e: 127.6, kind: "speech" },
    { s: 129.0, e: 133.0, kind: "speech" },
  ];

  // Instrumental — generally continuous music, with a couple of speech bleeds
  const musicWindows = [
    { s: 0.0,   e: 134.4, kind: "music" },
  ];
  const insBleeds = [
    { s: 12.5, e: 14.2, kind: "speech-bleed" },
    { s: 45.6, e: 49.0, kind: "speech-bleed" },
    { s: 88.4, e: 92.0, kind: "speech-bleed" },
    { s: 119.0, e: 122.4, kind: "speech-bleed" },
  ];

  // Generate vocals
  for (let i = 0; i < N; i++) {
    const t = (i / N) * DURATION_SEC;
    let amp = 0.02 + rngV() * 0.04; // floor ambient hiss
    for (const w of speechWindows) {
      if (t >= w.s && t <= w.e) {
        const u = (t - w.s) / (w.e - w.s);
        const envelope = Math.sin(u * Math.PI) * 0.5 + 0.5; // soft attack/decay
        if (w.kind === "speech") {
          // spiky speech — high variance
          const spike = Math.pow(rngV(), 1.8); // skew toward smaller w/ occasional spikes
          amp = Math.max(amp, 0.25 + spike * 0.65 * envelope);
        } else {
          // music bleed — smoother sustained
          const slow = 0.35 + 0.25 * Math.sin(t * 1.7) + 0.10 * Math.sin(t * 4.3 + 1.1);
          amp = Math.max(amp, slow * envelope);
        }
      }
    }
    voc[i] = Math.min(1, amp);
  }

  // Generate instrumental
  for (let i = 0; i < N; i++) {
    const t = (i / N) * DURATION_SEC;
    let amp = 0;
    for (const w of musicWindows) {
      if (t >= w.s && t <= w.e) {
        // Layered sinusoids → music-like sustained envelope
        const u = (t - w.s) / (w.e - w.s);
        const broad = 0.30 + 0.15 * Math.sin(t * 0.6) + 0.10 * Math.sin(t * 1.3 + 0.7);
        const tex = 0.06 * (rngI() - 0.5);
        const ramp = 0.4 + 0.6 * Math.sin(u * Math.PI);  // fade in/out
        amp = Math.max(amp, (broad + tex) * ramp);
      }
    }
    for (const w of insBleeds) {
      if (t >= w.s && t <= w.e) {
        const u = (t - w.s) / (w.e - w.s);
        const env = Math.sin(u * Math.PI) * 0.5 + 0.5;
        const spike = Math.pow(rngI(), 1.8);
        amp = Math.max(amp, 0.30 + spike * 0.6 * env);
      }
    }
    ins[i] = Math.max(0.01, Math.min(1, amp));
  }

  return {
    voc, ins,
    bleeds: {
      voc: speechWindows.filter(w => w.kind === "music-bleed"),
      ins: insBleeds,
    }
  };
}

const WAVE = buildWaveforms();

// ── Initial state ─────────────────────────────────────────────
// Sample corrections (already-applied) so we can demo the visual treatment.
const INITIAL_CORRECTIONS = [
  // The first music-bleed in vocals → moved to instrumental.
  {
    id: "c1",
    from: "voc", to: "ins",
    start: 31.0, end: 38.8,
    by: "Aman Roy",
    at: "2m ago",
    reason: "Background score leaked into vocal stem during driving scene."
  },
  // A speech bleed in instrumental → moved to vocals.
  {
    id: "c2",
    from: "ins", to: "voc",
    start: 45.6, end: 49.0,
    by: "Aman Roy",
    at: "1m ago",
    reason: "Dialog 'Tum samajh nahi rahe ho' picked up in music stem."
  },
];

window.PD = { FPS, DURATION_SEC, SAMPLES, fmtTC, fmtTCshort, WAVE, INITIAL_CORRECTIONS };
