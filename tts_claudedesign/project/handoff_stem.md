# ProDub — Stage 1 (Stem Separation Review) — Handoff

Paste this into a fresh chat to continue without re-litigating decisions. The full design and all settled choices live in the file tree alongside this doc.

---

## What this is

A web-based editor for the **Hindi → English video-dubbing pipeline** at **Postudio**. Sibling product to the existing ProDub player — same visual language: **dark, dense, DAW-style, keyboard-driven, no oversized buttons, no hand-holding empty states**. Editors stare at this for hours.

The pipeline is six sequential stages:

1. **Stems** — separate vocals from instrumental, review and clean up bleed *(this file)*
2. **Diarization** — assign speech to speakers
3. **Transcription** — generate source-language transcript
4. **Translation** — script + translation editing
5. **TTS** — voice generation + review
6. **Lipsync** — final lip-sync pass

This handoff covers **Stage 1 only**. Stages 2–6 still need design.

---

## Files (in this project)

| File | Purpose |
|---|---|
| `Stage 1 - Stem Separation Review.html` | Entry point. Loads tokens, fonts, React, then the JSX modules below. |
| `app.jsx` | App shell, all top-level state, state-screen routing (upload / loading / active / empty / error), Save & Continue modal, scrollbar, Playhead. |
| `editor.jsx` | TopHeader · SubstageStrip · Ruler · TrackRail (with track-options menu) · Transport · SelectionFab · HistoryPanel (Corrections + Flags tabs) · ShortcutsPopover. |
| `waveform.jsx` | `WaveformCanvas` (bar-style canvas renderer with `clipStart`/`clipEnd` for grafted slices) and `Lane` (selection, regions, flag overlays). |
| `data.jsx` | Synthesised waveform data, timecode helpers (`fmtTC`), initial corrections seed. |
| `styles/editor.css` | All component styling. |
| `styles/postudio-tokens.css` | Postudio design-system tokens (color, type, spacing). |
| `tweaks-panel.jsx` | Tweaks shell + controls (built-in starter). |

Toolchain: vanilla React 18 + Babel standalone (inline JSX, no build step). Postudio tokens pulled from the design system. **Material Symbols Outlined** for icons (substituted for Postudio's custom monoline glyphs).

---

## Global frame (every stage uses this)

**TopHeader (56px)**
- Left: ProDub wordmark + project name + project-id badge (mono, with tooltip "Postudio project code").
- Center: six-stage pill progress. Current = teal accent, future = dimmed and uninteractive.
- Right: **Save & Continue** primary button. Disabled until "Mark as reviewed" is on. On click → custom modal (not browser alert) with ribbon-art hero, stats row, optional unresolved-flags warning, then a saving spinner → "Stage complete" → CTA to open next stage.

**SubstageStrip (52px)**
- Stage index (mono, e.g. `STAGE 1 / 6`) + stage title (**Poppins 300, 22px**, soft) + subtitle.
- Two stat chips: **⚑ N flag(s)** and **↻ N correction(s)**. Each chip opens the corresponding tab in the right panel and briefly flashes the panel.
- **Mark as reviewed** toggle.
- **⋯ Project actions** menu (project-level, not per-stem): **Export both stems**, **Re-run separation** (red, with confirm).

**Body**
- Two columns: workspace + right side panel.
- During `loading` and `error`, the side panel is hidden entirely and the workspace fills the width.

---

## Stage 1 specifics

### Timeline

- **Vocals** (top) and **Instrumental** (bottom) — two horizontal tracks.
- **Vocals = blue `#7dbcff`** · **Instrumental = teal `#5eead4`** (matches the existing ProDub player's bottom track).
- Each lane is ~104px tall. Continuous bar-style waveform on canvas; resolution adapts to zoom (0.5×–8× via native slider in the transport bar, or scroll-wheel + step buttons).
- Frame-accurate timecode ruler at `HH:MM:SS:FF` (24 fps default). Click anywhere on the ruler to seek.
- Vertical playhead spans both lanes + the ruler; auto-scrolls into view while playing.

### Track rail (left column of each lane)

- Square avatar tile (V or I) tinted to the track's accent.
- Label + sublabel (e.g. *Vocals · Speech track*).
- Tiny-toggle row: **⋯ track options**, **mute** (volume icon flips), **solo** ("S").
- **⋯ Track options menu** (per-track only — no destructive actions here):
  - Rename track
  - Export stem as WAV
  - Solo only this stem
  
  Header shows the stem source filename in mono.

### Bleed correction (the core interaction)

1. Drag-select on either waveform → a **floating action bar** appears anchored between the two lanes.
2. FAB contents (left to right): source-track arrow chip · selection duration (`x.xxs`) · **Flag (F)** secondary · primary **Move to <other-track> (V/I)** · dismiss ×.
3. **Move** silences the source range and grafts the actual waveform onto the destination:
   - **Silenced region** in source: diagonal hatch + center strikethrough + small `block` icon.
   - **Grafted region** in destination: dashed colored outline (in the source track's tint) with the source waveform shape drawn inside via canvas clip + a "from vocals/instrumental" badge.
4. **Flag** marks a range without moving the audio. Flags are **user-only** — there is no model-driven auto-flag. The separation model just outputs two stems; nothing for it to "auto-flag".
5. **Click any flag on the timeline** → its range becomes the current selection → the FAB's secondary button flips to **× Unflag (F)** with an orange tint, so the user can remove it.

### Mute / Solo propagation

- Muting Vocals dims **both** the native Vocals waveform **and** any grafted-from-Instrumental region inside it. Same for soloing Instrumental: anything sitting on the Vocals lane goes silent visually.
- The grafted-region waveform inside re-renders in white-alpha when its lane is muted; the dashed border + badge get the muted treatment (`.muted` class, 70% opacity, dim border, white-30 text).

### Transport (bottom)

- Left: timecode display (current in teal, total in white-50, mono) + global **Undo** (↶) and **Redo** (↷). Undo greys out when nothing to undo; Redo is invalidated when a new Move is performed.
- Center: borderless **first_page · skip_previous · play · skip_next · last_page**. Play button has a subtle highlight; flips red on playback.
- Right: native zoom slider with ± buttons + keyboard help icon.
- Mousewheel on the timeline scrolls horizontally (DAW convention).
- Custom horizontal scrollbar at the bottom of the lane area (10px thumb, click-track to page-jump, drag to scrub).

### Right side panel — Corrections + Flags (tabbed)

- Two tabs at the top: **Corrections** and **Flags** (each with a count pill).
- Active tab is highlighted with a subtle background.
- Each row is **purely operational**: track direction (arrow + "Vocals → Instrumental"), timecode range, duration. **No author names. No comments. No timestamps.** Those belong to later stages.
- Click a row to jump the playhead to that point. For flags, clicking also re-selects the range so the FAB exposes Unflag.
- Per-row action: **undo** (corrections) / **remove** (flags).
- Panel is collapsible to a vertical rail showing `N ITEMS` and an expand chevron.

---

## States (toggle via Tweaks panel → "Screen")

| State | What it shows |
|---|---|
| `upload` | Full-screen page **before Stage 1**. Dropzone (drag-and-drop or browse), source-language select, target-language select, frame-rate select, "Paste S3 / Drive URL" secondary, **Start separation** primary. Replaces the entire editor. |
| `loading` | Centered panel: 2-step checklist — **Decoding source audio** → **Separating vocals & instrumental** — with progress bar and ETA. **Right panel hidden.** No model name shown (it's an internal detail). |
| `empty` | Editor visible, corrections panel shows instructional empty-state copy. |
| `active` (default) | Seeded with 2 corrections (a music bleed moved out of vocals, a speech bleed moved out of instrumental) and 1 manual flag, so the visual treatments are all visible without interaction. |
| `error` | Centered overlay: "Source audio failed to load" + error code, Retry / Upload a new file / Back to project. **Right panel hidden.** |

The **Save & Continue modal** has its own sub-states: `review` → `saving` (1.2s spinner) → `done` (✓ + CTA to next stage).

---

## Keyboard shortcuts

| Action | Key |
|---|---|
| Play / pause | `Space` |
| Step ±1 frame | `← / →` |
| Move selection to Vocals | `V` |
| Move selection to Instrumental | `I` |
| Flag / unflag selection | `F` |
| Undo | `Z` |
| Redo | `⇧Z` or `Y` |
| Clear selection / close popover | `Esc` |
| Mute / solo focused track | `M / S` |
| Show shortcuts | `?` |

Shortcuts are listed in a floating help popover (`?` key or keyboard icon in transport).

---

## Visual decisions — settled, don't redo

- **Stage h1 font: Poppins 300, 22px, letter-spacing −0.02em.** Soft. Not Inter.
- **Vocals = `#7dbcff` (blue) · Instrumental = `#5eead4` (teal).** Teal matches the existing ProDub player's bottom track. Mint (`#2af598`) was tried and rejected.
- All transport buttons are **borderless** except Play.
- Stats chips use proper singular/plural ("1 flag" not "1 flagged").
- Project ID `PSPDZBZA2687` shown as a small mono badge with tooltip.
- **Manual flags are orange dashed** (`#fb923c`) with a small orange dot at top. No yellow auto-flags exist anymore.
- **Grafted regions** show the actual source waveform inside, clipped from the other track's data. Dashed border in the source's accent color. Faint source-track tint as background.
- **Silenced regions** use diagonal hatch + center strikethrough + small `block` icon.
- **Re-run separation is project-level** (substage strip ⋯ menu) — never per-stem.
- Corrections list has **no author / no reason / no timestamp**. Just direction, range, duration, undo.

---

## What's wired vs. mocked

**Live state (full functionality):**
- Drag-select, Move, Flag/Unflag, click-flag-to-select, click-correction/flag-to-jump, mute/solo toggles (with proper propagation to grafted regions), global Undo/Redo with redo stack invalidation, history-panel tabs, panel collapse, project-id badge, project-actions menu, Mark as reviewed → Save & Continue modal with review → saving → done flow, keyboard shortcuts, zoom slider, mousewheel scrolling, custom scrollbar drag and page-jump.
- Tweaks panel switches Screen state (upload / loading / active / empty / error) live.

**UI stubs (no real I/O — engineering wires these):**
- Track ⋯ menu items (Rename / Export stem as WAV / Solo only this stem).
- Project ⋯ menu items (Export both stems; Re-run separation goes to the loading state).
- Upload screen "Start separation" button.
- Save & Continue's "Open Diarization" CTA (would navigate to Stage 2 once it exists).
- Audio playback is simulated — the playhead animates against time, no real audio decode.

---

## What's next

- **Stage 2 (Diarization correction)** is the next design.
- It will reuse the global frame (TopHeader + SubstageStrip + Save & Continue + state model).
- Carry forward the **same visual language**: dark, dense, mono timecodes, borderless chrome, teal accent for the current stage.

---

## How to continue this work

Open a new chat in this same project (the files persist), and paste a one-liner like:

> *Continuing the ProDub stem editor (Postudio). Stage 1 is done — see `handoff_stem.md` for the full spec. Now designing Stage 2 (Diarization correction).*

I'll pick up from the design system, the global frame, and Stage 1's settled patterns, and we'll start asking Stage-2 questions.
