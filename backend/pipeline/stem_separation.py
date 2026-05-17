import logging
import os
import shutil
import tempfile
import time
from typing import Any

from pipeline.storage import StorageBackend

logger = logging.getLogger(__name__)

HTDEMUCS_MODEL       = "htdemucs_ft.yaml"
VOCALS_FILENAME      = "vocals.wav"          # ElevenLabs isolated vocals (main)
INSTRUMENTAL_FILENAME = "instrumental.wav"   # HTDemucs instrumental (main)
HTD_VOCALS_FILENAME  = "htdemucs_vocals.wav" # HTDemucs vocals (reference track)


def _run_htdemucs(source_path: str, out_dir: str, model_dir: str) -> dict[str, str]:
    """Run HTDemucs-FT and return local paths to vocals and instrumental."""
    import numpy as np
    import soundfile as sf
    from audio_separator.separator import Separator

    sep = Separator(
        output_dir=out_dir,
        output_format="WAV",
        normalization_threshold=0.9,
        model_file_dir=model_dir,
    )
    sep.load_model(model_filename=HTDEMUCS_MODEL)
    sep.separate(source_path)

    files = os.listdir(out_dir)
    found_vocals = None
    found_instrumental = None   # direct 2-stem output
    found_non_vocal = []        # 4-stem: bass + drums + other

    for fn in files:
        fl = fn.lower()
        if any(k in fl for k in ("instrumental", "no_vocal", "no-vocal", "accompaniment")):
            found_instrumental = fn
        elif any(k in fl for k in ("bass", "drums", "other")):
            found_non_vocal.append(fn)
        elif "vocal" in fl and "no" not in fl:
            found_vocals = fn

    if not found_vocals:
        raise RuntimeError(f"HTDemucs: no vocals file in output. Files: {files}")

    vocals_path = os.path.join(out_dir, found_vocals)

    if found_instrumental:
        instrumental_path = os.path.join(out_dir, found_instrumental)
    elif found_non_vocal:
        # Sum bass + drums + other into a single instrumental
        arrays, sr_ref = [], None
        for fn in found_non_vocal:
            y, sr = sf.read(os.path.join(out_dir, fn), always_2d=True)
            arrays.append(y)
            sr_ref = sr
        max_len = max(a.shape[0] for a in arrays)
        padded = [
            (np.pad(a, ((0, max_len - a.shape[0]), (0, 0))) if a.ndim == 2
             else np.pad(a, (0, max_len - len(a))))
            for a in arrays
        ]
        mixed = np.clip(sum(padded), -1.0, 1.0)
        instrumental_path = os.path.join(out_dir, "_instrumental_combined.wav")
        sf.write(instrumental_path, mixed, sr_ref)
    else:
        raise RuntimeError(f"HTDemucs: no instrumental stems found. Files: {files}")

    logger.info("[htdemucs] vocals=%s instrumental=%s", found_vocals, os.path.basename(instrumental_path))
    return {"vocals": vocals_path, "instrumental": instrumental_path}


def _run_elevenlabs_isolation(source_path: str, out_dir: str) -> str:
    """Run ElevenLabs audio isolation and return local path to isolated vocals WAV."""
    import subprocess
    from elevenlabs import ElevenLabs

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set. Add it to your .env file.")

    client = ElevenLabs(api_key=api_key)
    logger.info("[elevenlabs_isolation] calling ElevenLabs audio isolation API")

    with open(source_path, "rb") as f:
        result = client.audio_isolation.convert(audio=f)
        raw_bytes = b"".join(result)

    logger.info("[elevenlabs_isolation] received %d bytes from API", len(raw_bytes))

    # ElevenLabs returns MP3 — write raw bytes, then convert to WAV via ffmpeg
    raw_path = os.path.join(out_dir, "_el_raw.mp3")
    out_path = os.path.join(out_dir, "_el_vocals.wav")
    with open(raw_path, "wb") as f:
        f.write(raw_bytes)

    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", raw_path, "-ar", "44100", "-ac", "1", out_path],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg WAV conversion failed (exit {proc.returncode}): "
            f"{proc.stderr.decode(errors='replace')[:500]}"
        )

    logger.info("[elevenlabs_isolation] WAV written: %s", out_path)
    return out_path


def separate_stems(
    job_id: str,
    storage: StorageBackend,
) -> dict[str, Any]:
    """Run HTDemucs first, then ElevenLabs isolation only if HTDemucs succeeds.

    Outputs stored in job storage:
      vocals.wav          — ElevenLabs isolated speech (main vocals track)
      instrumental.wav    — HTDemucs bass+drums+other (main instrumental track)
      htdemucs_vocals.wav — HTDemucs vocal stem (hidden reference track)

    Returns metadata dict for run_pipeline to commit to the database.
    """
    t0 = time.time()
    logger.info("[separate_stems] job %s starting HTDemucs → ElevenLabs sequential", job_id)

    source_path = storage.get_local_path(job_id, "source_audio.wav")
    _default_model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
    model_dir = os.getenv("SEPARATOR_MODEL_DIR", _default_model_dir)

    htd_dir = tempfile.mkdtemp(prefix=f"htd_{job_id}_")
    el_dir  = tempfile.mkdtemp(prefix=f"el_{job_id}_")

    try:
        # Run HTDemucs first — only call ElevenLabs if it succeeds (avoids wasting credits)
        htd_result = _run_htdemucs(source_path, htd_dir, model_dir)
        el_vocals_path = _run_elevenlabs_isolation(source_path, el_dir)

        storage.move_from_path(job_id, VOCALS_FILENAME,       el_vocals_path)
        storage.move_from_path(job_id, INSTRUMENTAL_FILENAME, htd_result["instrumental"])
        storage.move_from_path(job_id, HTD_VOCALS_FILENAME,   htd_result["vocals"])

        elapsed = time.time() - t0
        logger.info("[separate_stems] job %s complete in %.1fs", job_id, elapsed)

        return {
            "vocals_filename":         VOCALS_FILENAME,
            "instrumental_filename":   INSTRUMENTAL_FILENAME,
            "htdemucs_vocals_filename": HTD_VOCALS_FILENAME,
            "model":                   f"htdemucs_ft+elevenlabs",
            "rtf":                     0.0,
        }

    finally:
        shutil.rmtree(htd_dir, ignore_errors=True)
        shutil.rmtree(el_dir,  ignore_errors=True)
