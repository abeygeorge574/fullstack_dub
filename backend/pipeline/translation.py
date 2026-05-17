"""Stage 4 — Gemini translation of transcribed segments.

Requires:
  GEMINI_API_KEY — place in .env
  GEMINI_MODEL   — optional, defaults to gemini-1.5-pro

Prompt is loaded from backend/prompts/translation.txt.
To customise the translation prompt, edit that file directly.
"""

import logging
import os

logger = logging.getLogger(__name__)

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "translation.txt")
_DEFAULT_PROMPT = (
    "Translate the following Hindi text into natural spoken English for film dubbing. "
    "Keep the translation concise — it must fit within the same duration as the original. "
    "Output only the English translation."
)


def _load_prompt() -> str:
    try:
        with open(_PROMPT_PATH, encoding="utf-8") as f:
            text = f.read().strip()
        return text if text else _DEFAULT_PROMPT
    except FileNotFoundError:
        return _DEFAULT_PROMPT


def translate_segments(job_id: str, segments: list[dict]) -> list[dict]:
    """Translate every segment and return updated segments with .tx filled."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GEMINI_API_KEY is not set. Add it to your .env file as GEMINI_API_KEY=your_key_here"
        )

    import google.generativeai as genai
    genai.configure(api_key=api_key)

    model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-pro")
    model = genai.GenerativeModel(model_name)
    prompt_prefix = _load_prompt()

    updated = []
    for seg in segments:
        source_text = seg.get("text", "").strip()
        if not source_text:
            updated.append({**seg, "tx": "", "status": "translated"})
            continue

        try:
            full_prompt = f"{prompt_prefix}\n\nHindi text: {source_text}"
            response = model.generate_content(full_prompt)
            tx = response.text.strip() if response.text else ""
            updated.append({**seg, "tx": tx, "status": "translated"})
            logger.info(
                "[translation] job=%s seg=%s translated: %d chars",
                job_id, seg["id"], len(tx),
            )
        except Exception as e:
            logger.error("[translation] job=%s seg=%s failed: %s", job_id, seg["id"], e)
            updated.append({**seg, "tx": "", "status": "error"})

    return updated
