# ProDub — Stage 1 (Stem Separation Review) — Engineering Update Handoff

Paste this into Claude Design alongside the original `handoff_stem.md`. This document records every change made during engineering implementation. Anything not listed here is unchanged from the original handoff spec.

---

## How to use this

Open a new chat in the Claude Design project, paste both `handoff_stem.md` (original) and this file. Say:

> *Continuing ProDub (Postudio). Stage 1 engineering is complete. `handoff_stem.md` has the original design spec; `handoff_stem_v2.md` has all the changes made during implementation. Both together are the current truth. Now designing Stage 2 (Diarization correction).*

---

## Summary of changes

| Area | Original | As built |
|---|---|---|
| Transport bar position | Bottom of workspace | Between SubstageStrip and timeline |
| Upload screen — recents | Not present | New "Recent Projects" section below actions |
| Upload screen — default FPS | 24 | **25** |
| Project actions menu | Export both stems · Re-run separation | + **New upload** item added |
| Audio playback | Simulated (animated playhead, no audio) | **Fully live** — Web Audio API, corrections applied in real-time |
| Export stems | Stub | Downloads corrected WAV (corrections baked in) |
| Session persistence | None | Job ID saved to localStorage; reload resumes last session |
| Wired vs mocked | Most interactions mocked | All Stage 1 interactions fully wired to backend |
| Empty state | Separate `empty` screen state | Removed — goes straight to `active` once stems are ready |
| Tweaks panel | Present in prototype | Not in production build |

---

## Change 1 — Transport bar moved up

**Original spec (handoff_stem.md line 97):** "Transport (bottom)" — the play bar sat as the last row inside the workspace, below the two waveform lanes.

**As built:** Transport is now a full-width bar immediately below the SubstageStrip and immediately above the track/timeline area. It is a direct child of the top-level `.app` grid, occupying its own 64px row.

```
┌─────────────────────────────────────────────────────────┐
│  TopHeader                                    56px       │
├─────────────────────────────────────────────────────────┤
│  SubstageStrip                                52px       │
├─────────────────────────────────────────────────────────┤
│  Transport  [◀◀ ◀ ▶ ▶ ▶▶]  [zoom]  [?]       64px  ←NEW│
├────────────────────────────────────────┬────────────────┤
│  Timeline (ruler + 2 tracks)           │  History panel │
│                                        │  (corrections  │
│                                        │   + flags)     │
└────────────────────────────────────────┴────────────────┘
```

The transport `border-top` became `border-bottom` (it now separates the transport from the tracks below, not from something above).

**Why:** editors found it awkward to scroll down to reach play/pause while their eyes were on the waveforms.

---

## Change 2 — Upload screen: Recent Projects panel

**Original spec:** Upload screen had dropzone, language selects, FPS select, "Paste S3 / Drive URL" secondary, "Start separation" primary. No recents.

**As built:** A "RECENT PROJECTS" section appears below the action buttons if any previous jobs exist. Each row shows:

```
● source_filename.mp4          2:14    14 May · 15:34   ›
```

- Status icon (green check = ready, yellow spinner = processing, red = error)
- Source filename (truncated with ellipsis)
- Duration in `M:SS`
- Date + local time
- Chevron

Clicking any row immediately resumes that session — app fetches the job, restores corrections and flags, and opens the editor exactly where it was left off. No confirmation needed.

**New API used:** `GET /jobs?limit=8` returns a lightweight list (no corrections/flags payloads, just summary fields).

---

## Change 3 — Default FPS changed to 25

**Original spec:** FPS select defaulted to 24.

**As built:** Defaults to **25**. Options remain 23.976 · 24 · **25** · 29.97 · 30.

---

## Change 4 — Project actions menu: New upload added

**Original spec:** Project ⋯ menu had two items: "Export both stems" and "Re-run separation" (red).

**As built:** Three items:

```
┌──────────────────────────────┐
│  Project actions             │
│  stage 1 — stems             │
├──────────────────────────────┤
│  ⬇  Export both stems        │
├──────────────────────────────┤
│  ↑  New upload               │   ← added
│  ↺  Re-run separation    red │
└──────────────────────────────┘
```

**New upload** clears the saved session and takes the user back to the upload screen.

**Re-run separation** now actually re-runs the pipeline on the already-uploaded source file (resets stems, corrections, flags, and re-queues the separation job). Still shows a confirm dialog first. Then goes to the loading screen while it re-processes.

---

## Change 5 — Audio playback is now real (Web Audio API)

**Original spec (handoff_stem.md, "What's wired vs. mocked"):** "Audio playback is simulated — the playhead animates against time, no real audio decode."

**As built:** Fully live. Both stems load into an AudioContext buffer on editor open. The `AudioEngine` class applies corrections in real-time:
- Regions moved *out* of a track are silenced via `GainNode` automation.
- Regions moved *in* from the other track are grafted using a second `AudioBufferSourceNode` playing the correct slice from the source stem.

**UX implications for design:**
- The play button shows a **loading spinner** until both audio buffers have decoded. The button is disabled and shows `progress_activity` icon during this brief load (typically < 1s for a 30s clip).
- On correction: playback graph rebuilds immediately if currently playing.
- Mute/solo toggles take effect immediately (no rebuild delay).

---

## Change 6 — Export stems downloads corrected audio

**Original spec:** "Export stem as WAV" was a stub.

**As built:** Clicking "Export stem as WAV" (per-track ⋯ menu) or "Export both stems" (project ⋯ menu) triggers a browser download of a WAV file with all corrections baked in:
- Silenced regions are zeroed out.
- Grafted regions have the source audio mixed in.

If there are no corrections, the raw separated stem is downloaded.

"Export both stems" triggers two sequential downloads (600ms apart to avoid browser popup blocking) — `vocals_corrected.wav` then `instrumental_corrected.wav`.

---

## Change 7 — Session persistence across reload

**Original spec:** No persistence. Reload = back to upload screen.

**As built:**
- Job ID is saved to `localStorage` on upload.
- On any page load, the app checks localStorage, fetches the job from the API, and resumes the correct screen state (upload / loading / active / error).
- Corrections and flags are auto-saved to the database 800ms after every change (debounced) and are fully restored on resume.
- "New upload" in the project menu clears the saved session.

**UX note:** There is no "open project" screen. The app always resumes the last job. To switch jobs, use "New upload" or pick from the Recents list on the upload screen.

---

## Change 8 — Pinch-to-zoom on trackpad

**Original spec:** "Mousewheel on the timeline scrolls horizontally (DAW convention)."

**As built:** Two-finger scroll still scrolls horizontally. **Two-finger pinch** (macOS trackpad) zooms in/out. Browser zoom is suppressed over the timeline. The zoom range and slider remain the same (0.5× – 8×).

---

## What is now fully wired (was stubbed in original)

Everything in the original "UI stubs" list is now live:

| Item | Status |
|---|---|
| Track ⋯ → Rename track | ✅ Live (updates label, persists to DB) |
| Track ⋯ → Export stem as WAV | ✅ Live (downloads corrected WAV) |
| Track ⋯ → Solo only this stem | Removed — solo is handled by the S toggle button on the rail directly, no menu item needed |
| Project ⋯ → Export both stems | ✅ Live (two downloads) |
| Project ⋯ → Re-run separation | ✅ Live (resets + re-queues pipeline) |
| Upload → Start separation | ✅ Live (real file upload + pipeline) |
| Save & Continue → Open Diarization | Still stub (Stage 2 not built yet) |
| Audio playback | ✅ Fully live (Web Audio API) |

---

## What was removed from the original design

| Item | Why removed |
|---|---|
| `empty` screen state | Unnecessary — once waveforms are ready the editor opens in `active` state with real data, not a placeholder |
| Tweaks panel | Development-only tool, not in the production build |
| "Solo only this stem" in track menu | Redundant with the S toggle already on the rail; removed to keep the menu tight |
| Project ID badge (`PSPDZBZA2687`) | Not implemented — job IDs are now timestamped slugs like `20260514_143022_a3b4c5d6`; badge not surfaced in UI |

---

## Visual/token decisions that remain unchanged

All settled decisions from `handoff_stem.md` ("Visual decisions — settled, don't redo") are unchanged:

- Stage h1: Poppins 300, 22px, letter-spacing −0.02em
- Vocals = `#7dbcff` (blue) · Instrumental = `#5eead4` (teal)
- All transport buttons borderless except Play
- Stats chips: singular/plural correct
- Manual flags: orange dashed (`#fb923c`)
- Grafted regions: dashed border in source accent, source waveform drawn inside via canvas clip
- Silenced regions: diagonal hatch + strikethrough + `block` icon
- Corrections list: no author / no reason / no timestamp
- Re-run separation is project-level only, never per-stem

---

## Stage 2 starting point

Stage 2 (Diarization) will receive:
- `job.vocals_path` pointing to the **corrected** vocals stem (corrections already baked in)
- Corrections and flags arrays from Stage 1 (stored in DB, passed forward for context)

The global frame (TopHeader with stage 2 highlighted, SubstageStrip with "Diarization Correction" title, Transport, History panel) reuses the same layout established here.
