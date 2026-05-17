"""Stage 3 — Gemini transcription of each diarized segment.

Requires:
  GEMINI_API_KEY — place in .env
  GEMINI_MODEL   — optional, defaults to gemini-1.5-pro

Prompt is loaded from backend/prompts/transcription.txt.
To customise the transcription prompt, edit that file directly.
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "transcription.txt")
_DEFAULT_PROMPT = (
    "Transcribe the following Hindi audio clip exactly as spoken. "
    "Output only the transcription — no timestamps, no speaker labels, no explanations."
)


def _load_prompt() -> str:
    try:
        with open(_PROMPT_PATH, encoding="utf-8") as f:
            text = f.read().strip()
        return text if text else _DEFAULT_PROMPT
    except FileNotFoundError:
        return _DEFAULT_PROMPT


def _extract_segment_audio(audio_path: str, start: float, end: float, out_path: str) -> None:
    """Extract a segment from a WAV file using ffmpeg."""
    duration = end - start
    proc = subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-t", str(duration),
            "-i", audio_path,
            "-ar", "16000", "-ac", "1",
            out_path,
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg segment extraction failed: {proc.stderr.decode()[:500]}")


def transcribe_segments(job_id: str, storage, segments: list[dict]) -> list[dict]:
    """Transcribe every segment and return updated segments with .text filled."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GEMINI_API_KEY is not set. Add it to your .env file as GEMINI_API_KEY=your_key_here"
        )

    import google.generativeai as genai
    genai.configure(api_key=api_key)

    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-pro")
    model = genai.GenerativeModel(model_name)
    prompt = _load_prompt()

    vocals_path = storage.get_local_path(job_id, "vocals_final.wav")
    updated = []

    with tempfile.TemporaryDirectory() as tmp_dir:
        for i, seg in enumerate(segments):
            seg_path = os.path.join(tmp_dir, f"seg_{i:04d}.wav")
            try:
                _extract_segment_audio(vocals_path, seg["start"], seg["end"], seg_path)

                audio_file = genai.upload_file(seg_path, mime_type="audio/wav")
                response = model.generate_content([prompt, audio_file])
                text = response.text.strip() if response.text else ""

                updated.append({**seg, "text": text, "status": "transcribed"})
                logger.info(
                    "[transcription] job=%s seg=%s transcribed: %d chars",
                    job_id, seg["id"], len(text),
                )
            except Exception as e:
                logger.error("[transcription] job=%s seg=%s failed: %s", job_id, seg["id"], e)
                updated.append({**seg, "text": "", "status": "error"})

    return updated
