"""Stage 4 — Gemini translation of transcribed segments (Hindi → English).

Prompt file: backend/prompts/translation.txt  (edit to customise)

Required env vars: same as transcription (GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT)
Optional: GOOGLE_CLOUD_LOCATION, GEMINI_MODEL
"""

import logging
import os

logger = logging.getLogger(__name__)

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "translation.txt")
_DEFAULT_PROMPT = (
    "You are a professional Hindi-to-English translator for film dubbing. "
    "Translate the following Hindi text into natural, spoken English. "
    "The translation must fit within the same duration as the original — keep it concise. "
    "Preserve the speaker's tone and intent. "
    "Output only the English translation — no explanations, no alternatives."
)


def _load_prompt() -> str:
    try:
        with open(_PROMPT_PATH, encoding="utf-8") as f:
            text = f.read().strip()
        return text if text else _DEFAULT_PROMPT
    except FileNotFoundError:
        return _DEFAULT_PROMPT


def translate_segments(job_id: str, segments: list[dict]) -> list[dict]:
    """Translate every segment. Returns updated segments with .tx filled."""
    from .gemini_client import get_model

    # Translation is text-only — flash is faster and cheaper than pro
    model_name = os.getenv("TRANSLATION_MODEL", os.getenv("GEMINI_MODEL", "gemini-1.5-flash-002"))
    model = get_model(model_name)
    prompt_prefix = _load_prompt()

    updated = []
    for seg in segments:
        source_text = seg.get("text", "").strip()
        if not source_text:
            updated.append({**seg, "tx": "", "status": "translated"})
            continue

        try:
            full_prompt = f"{prompt_prefix}\n\nHindi: {source_text}"
            response = model.generate_content(full_prompt)
            tx = (response.text or "").strip()
            updated.append({**seg, "tx": tx, "status": "translated"})
            logger.info(
                "[translation] job=%s seg=%s: %d chars → %d chars",
                job_id, seg["id"], len(source_text), len(tx),
            )
        except Exception as exc:
            logger.error("[translation] job=%s seg=%s failed: %s", job_id, seg["id"], exc)
            updated.append({**seg, "tx": "", "status": "error"})

    return updated
