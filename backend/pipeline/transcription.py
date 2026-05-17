"""Stage 3 — VAD-chunked Gemini Hindi transcription.

Pipeline:
  1. Run relaxed FFmpeg silencedetect on vocals_final.wav to find speech regions.
     Params: -50 dB threshold, 0.5 s minimum silence (much more relaxed than
     diarization which uses -30 dB / 0.1 s).
  2. Merge adjacent speech chunks separated by < 1 s of silence.
  3. Group diarization segments by which speech chunk they fall in.
     Segments not covered by any VAD chunk are marked silent (empty text).
  4. For each chunk extract audio and send to Gemini with the segment timestamps.
     Single-segment chunks get a plain transcription request.
     Multi-segment chunks include turn timestamps so Gemini returns one line per turn.
  5. Parse the numbered response lines and assign text back to each segment.

Prompt file: backend/prompts/transcription.txt  (edit to customise)

Required env vars:
  GOOGLE_APPLICATION_CREDENTIALS  — path to service-account JSON
  GOOGLE_CLOUD_PROJECT             — GCP project ID

Optional env vars:
  GOOGLE_CLOUD_LOCATION            — defaults to us-central1
  GEMINI_MODEL                     — defaults to gemini-1.5-pro-002
  TRANSCRIPTION_VAD_DB             — VAD threshold dB (default -50)
  TRANSCRIPTION_VAD_SILENCE        — min silence seconds (default 0.5)
"""

import logging
import os
import subprocess
import tempfile

logger = logging.getLogger(__name__)

_VAD_DB = float(os.getenv("TRANSCRIPTION_VAD_DB", "-50"))
_VAD_SILENCE = float(os.getenv("TRANSCRIPTION_VAD_SILENCE", "0.5"))
_MAX_CHUNK_S = 60.0   # never send more than 60 s to Gemini at once
_MERGE_GAP_S = 1.0    # merge speech regions with < 1 s gap between them
_PAD_S = 0.1          # context padding around each extracted chunk

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "transcription.txt")
_DEFAULT_PROMPT = (
    "You are a professional Hindi transcriptionist. "
    "Transcribe the following audio verbatim in Hindi (Devanagari script). "
    "Do not skip any words, sounds, or filler. Do not translate. "
    "Output only the Hindi transcription."
)


def _load_prompt() -> str:
    try:
        with open(_PROMPT_PATH, encoding="utf-8") as f:
            text = f.read().strip()
        return text if text else _DEFAULT_PROMPT
    except FileNotFoundError:
        return _DEFAULT_PROMPT


def _get_duration(audio_path: str) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
        capture_output=True, text=True,
    )
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def _run_vad(audio_path: str) -> list[tuple[float, float]]:
    """Relaxed silencedetect → list of (start, end) speech intervals."""
    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-af", f"silencedetect=n={_VAD_DB}dB:d={_VAD_SILENCE}",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    stderr = proc.stderr

    silences: list[tuple[float, float]] = []
    silence_start = None
    for line in stderr.splitlines():
        if "silence_start" in line:
            try:
                silence_start = float(line.split("silence_start:")[1].strip())
            except (IndexError, ValueError):
                pass
        elif "silence_end" in line and silence_start is not None:
            try:
                parts = line.split("silence_end:")[1].strip().split()
                silence_end = float(parts[0])
                silences.append((silence_start, silence_end))
                silence_start = None
            except (IndexError, ValueError):
                pass

    duration = _get_duration(audio_path)
    speech: list[tuple[float, float]] = []
    prev_end = 0.0
    for sil_start, sil_end in sorted(silences):
        if sil_start - prev_end >= 0.05:
            speech.append((round(prev_end, 3), round(sil_start, 3)))
        prev_end = sil_end
    if duration - prev_end >= 0.05:
        speech.append((round(prev_end, 3), round(duration, 3)))

    return speech


def _merge_gaps(intervals: list[tuple[float, float]], max_gap: float = _MERGE_GAP_S) -> list[tuple[float, float]]:
    """Merge adjacent speech intervals with a gap <= max_gap seconds."""
    if not intervals:
        return []
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        if start - merged[-1][1] <= max_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def _split_long(intervals: list[tuple[float, float]], max_s: float = _MAX_CHUNK_S) -> list[tuple[float, float]]:
    """Split any interval longer than max_s into equal sub-intervals."""
    result = []
    for start, end in intervals:
        dur = end - start
        if dur <= max_s:
            result.append((start, end))
        else:
            import math
            n = math.ceil(dur / max_s)
            step = dur / n
            for i in range(n):
                result.append((round(start + i * step, 3), round(start + (i + 1) * step, 3)))
    return result


def _group_segments(
    segments: list[dict],
    vad_chunks: list[tuple[float, float]],
) -> tuple[list[tuple[tuple, list[dict]]], list[dict]]:
    """Assign each diarization segment to the VAD chunk it overlaps most with.

    Returns:
        chunks_with_segs  — list of (vad_interval, [segments_in_that_chunk])
        silent_segs       — segments with no VAD overlap (will get empty text)
    """
    chunk_map: dict[tuple, list[dict]] = {c: [] for c in vad_chunks}
    silent: list[dict] = []

    for seg in segments:
        seg_start, seg_end = seg["start"], seg["end"]
        best_chunk = None
        best_overlap = 0.0
        for c_start, c_end in vad_chunks:
            overlap = max(0.0, min(seg_end, c_end) - max(seg_start, c_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_chunk = (c_start, c_end)
        if best_chunk is not None and best_overlap > 0.0:
            chunk_map[best_chunk].append(seg)
        else:
            silent.append(seg)

    return [(c, chunk_map[c]) for c in vad_chunks if chunk_map[c]], silent


def _extract_audio(audio_path: str, start: float, end: float, out_path: str) -> None:
    start_padded = max(0.0, start - _PAD_S)
    duration = (end + _PAD_S) - start_padded
    proc = subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(start_padded), "-t", str(duration),
            "-i", audio_path,
            "-ar", "16000", "-ac", "1",
            out_path,
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg extraction failed: {proc.stderr.decode()[:300]}")


def _transcribe_chunk(model, base_prompt: str, audio_path: str, chunk: tuple, segs: list[dict]) -> list[str]:
    """Send one audio chunk to Gemini and return a list of transcription strings (one per segment).

    For a single-segment chunk: returns [full_text].
    For a multi-segment chunk: includes turn timestamps in the prompt and
    parses one line per turn from the response.
    """
    from vertexai.generative_models import Part

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    audio_part = Part.from_data(audio_bytes, mime_type="audio/wav")

    chunk_start, chunk_end = chunk

    if len(segs) == 1:
        prompt = base_prompt
    else:
        n = len(segs)
        turns_desc = "\n".join(
            f"  Turn {i + 1}: {s['start']:.2f}s – {s['end']:.2f}s"
            for i, s in enumerate(segs)
        )
        prompt = (
            f"{base_prompt}\n\n"
            f"This audio clip runs from {chunk_start:.2f}s to {chunk_end:.2f}s "
            f"and contains {n} speaker turns:\n"
            f"{turns_desc}\n\n"
            f"Transcribe each turn verbatim in Hindi (Devanagari script). "
            f"Reply with exactly {n} lines — one line per turn in order. "
            f"Do not number lines, do not add any other text."
        )

    try:
        response = model.generate_content([prompt, audio_part])
        raw = (response.text or "").strip()
    except Exception as exc:
        logger.error("[transcription] Gemini error for chunk %.2f–%.2f: %s", chunk_start, chunk_end, exc)
        return [""] * len(segs)

    if len(segs) == 1:
        return [raw]

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if len(lines) >= len(segs):
        return lines[: len(segs)]
    # Fewer lines than expected — pad with empty strings
    return lines + [""] * (len(segs) - len(lines))


def transcribe_segments(job_id: str, storage, segments: list[dict]) -> list[dict]:
    """Transcribe all segments via VAD-chunked Gemini calls.

    Steps:
      1. Relaxed VAD on vocals_final.wav
      2. Merge close chunks, split oversized chunks
      3. Group diarization segments by VAD chunk
      4. For each chunk: extract audio → Gemini → parse N lines
      5. Return updated segments with .text filled
    """
    from .gemini_client import get_model

    vocals_path = storage.get_local_path(job_id, "vocals_final.wav")
    if not os.path.exists(vocals_path):
        raise FileNotFoundError(f"vocals_final.wav not found for job {job_id}")

    logger.info("[transcription] job=%s: running relaxed VAD (%.0fdB / %.1fs)",
                job_id, _VAD_DB, _VAD_SILENCE)
    vad_raw = _run_vad(vocals_path)
    vad_merged = _merge_gaps(vad_raw)
    vad_chunks = _split_long(vad_merged)
    logger.info("[transcription] job=%s: %d VAD chunks after merge/split", job_id, len(vad_chunks))

    if not vad_chunks:
        logger.warning("[transcription] job=%s: no speech detected", job_id)
        return [{**s, "text": "", "status": "transcribed"} for s in segments]

    chunks_with_segs, silent_segs = _group_segments(segments, vad_chunks)
    logger.info("[transcription] job=%s: %d active chunks, %d silent segments",
                job_id, len(chunks_with_segs), len(silent_segs))

    model = get_model()
    base_prompt = _load_prompt()

    seg_text: dict[str, str] = {}
    for chunk, segs in chunks_with_segs:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            chunk_path = tf.name
        try:
            _extract_audio(vocals_path, chunk[0], chunk[1], chunk_path)
            texts = _transcribe_chunk(model, base_prompt, chunk_path, chunk, segs)
            for seg, text in zip(segs, texts):
                seg_text[seg["id"]] = text
                logger.info(
                    "[transcription] job=%s chunk=%.1f–%.1f seg=%s: %d chars",
                    job_id, chunk[0], chunk[1], seg["id"], len(text),
                )
        except Exception as exc:
            logger.error("[transcription] job=%s chunk=%.1f–%.1f failed: %s",
                         job_id, chunk[0], chunk[1], exc)
            for seg in segs:
                seg_text[seg["id"]] = ""
        finally:
            if os.path.exists(chunk_path):
                os.unlink(chunk_path)

    for seg in silent_segs:
        seg_text[seg["id"]] = ""
        logger.info("[transcription] job=%s seg=%s: no VAD coverage → empty", job_id, seg["id"])

    return [{**s, "text": seg_text.get(s["id"], ""), "status": "transcribed"} for s in segments]
