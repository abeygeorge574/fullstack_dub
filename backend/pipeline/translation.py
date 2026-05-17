"""Stage 4 — Gemini translation (Hindi → English, batched, structured JSON output).

The translation prompt (backend/prompts/translation.txt) uses template variables:
  {source_language}, {target_language}, {show_summary}, {setting},
  {genres}, {linguistic_profile}, {style_template}

Show-context variables are read from env vars (see env.example).
source_language / target_language come from the job record.

Gemini returns a JSON array:
  [{"index": N, "translated_text": "...", "roman_script": "..."}, ...]

Segments are sent in batches of 30. The roman_script is stored on each
segment as tx_roman (useful for dubbing artists).
"""

import json
import logging
import os
import re

logger = logging.getLogger(__name__)

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "translation.txt")
_DEFAULT_PROMPT = (
    "You are a professional Hindi-to-English translator for film dubbing. "
    "Translate the following Hindi text into natural, spoken English. "
    "The translation must fit within the same duration as the original. "
    "Output only the English translation."
)

_LANG_NAMES: dict[str, str] = {
    "hi": "Hindi", "en": "English", "ta": "Tamil", "te": "Telugu",
    "kn": "Kannada", "mr": "Marathi", "bn": "Bengali", "es": "Spanish",
    "fr": "French", "de": "German", "zh": "Mandarin Chinese", "ar": "Arabic",
    "ja": "Japanese", "ko": "Korean", "pt": "Portuguese", "ru": "Russian",
    "ur": "Urdu", "pa": "Punjabi", "gu": "Gujarati", "ml": "Malayalam",
}

_BATCH_SIZE = 30


def _load_prompt() -> str:
    try:
        with open(_PROMPT_PATH, encoding="utf-8") as f:
            text = f.read().strip()
        return text if text else _DEFAULT_PROMPT
    except FileNotFoundError:
        return _DEFAULT_PROMPT


def _fill_template(template: str, source_lang: str, target_lang: str) -> str:
    """Fill template variables in the prompt. {{ }} are preserved as literal braces."""
    src = _LANG_NAMES.get(source_lang, source_lang)
    tgt = _LANG_NAMES.get(target_lang, target_lang)
    try:
        return template.format(
            show_summary=os.getenv("SHOW_SUMMARY", "A film or television series requiring professional dubbing."),
            setting=os.getenv("SHOW_SETTING", "Contemporary setting"),
            genres=os.getenv("SHOW_GENRES", "Drama"),
            linguistic_profile=os.getenv("SHOW_LINGUISTIC_PROFILE",
                                          f"Contemporary spoken {src} with natural dialogue."),
            source_language=src,
            target_language=tgt,
            style_template=os.getenv("STYLE_TEMPLATE", ""),
        )
    except KeyError:
        # If template has unknown vars, return as-is rather than crash
        logger.warning("[translation] template fill failed — using raw prompt")
        return template


def _parse_json_response(raw: str) -> list[dict]:
    """Extract and parse the JSON array from a Gemini response."""
    text = raw.strip()
    # Strip markdown code fences if present
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    # Find the outermost JSON array
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        text = m.group(0)
    return json.loads(text)


def translate_segments(
    job_id: str,
    segments: list[dict],
    source_lang: str = "hi",
    target_lang: str = "en",
) -> list[dict]:
    """Translate every segment. Returns updated segments with .tx and .tx_roman filled."""
    from .gemini_client import get_model

    model_name = os.getenv("TRANSLATION_MODEL", os.getenv("GEMINI_MODEL", "gemini-1.5-flash-002"))
    model = get_model(model_name)

    template = _load_prompt()
    prompt = _fill_template(template, source_lang, target_lang)

    # Index of segments that have text to translate
    active: list[tuple[int, dict]] = [
        (i, s) for i, s in enumerate(segments) if s.get("text", "").strip()
    ]

    result_map: dict[int, dict] = {}

    for batch_start in range(0, len(active), _BATCH_SIZE):
        batch = active[batch_start: batch_start + _BATCH_SIZE]
        input_data = [
            {
                "ID": b_idx + 1,
                "duration": round(s["end"] - s["start"], 2),
                "dialogue": s.get("text", "").strip(),
            }
            for b_idx, (_, s) in enumerate(batch)
        ]

        full_prompt = f"{prompt}\n\n{json.dumps(input_data, ensure_ascii=False, indent=2)}"

        try:
            response = model.generate_content(full_prompt)
            raw = (response.text or "").strip()
            parsed = _parse_json_response(raw)

            for item in parsed:
                b_idx = int(item.get("index", 0)) - 1  # 1-indexed → 0-indexed within batch
                if 0 <= b_idx < len(batch):
                    orig_idx = batch[b_idx][0]
                    result_map[orig_idx] = {
                        "tx": item.get("translated_text", ""),
                        "tx_roman": item.get("roman_script", ""),
                    }
                    logger.info(
                        "[translation] job=%s seg=%s: %d chars → %d chars",
                        job_id, batch[b_idx][1]["id"],
                        len(batch[b_idx][1].get("text", "")),
                        len(item.get("translated_text", "")),
                    )
        except Exception as exc:
            logger.error("[translation] job=%s batch %d failed: %s", job_id, batch_start, exc)
            for orig_idx, _ in batch:
                result_map[orig_idx] = {"tx": "", "tx_roman": ""}

    updated = []
    for i, seg in enumerate(segments):
        r = result_map.get(i, {"tx": "", "tx_roman": ""})
        updated.append({**seg, "tx": r["tx"], "tx_roman": r.get("tx_roman", ""), "status": "translated"})

    return updated
