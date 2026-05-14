import logging
import os
import shutil
import tempfile
import time
from typing import Any

from pipeline.storage import StorageBackend

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
VOCALS_FILENAME = "vocals.wav"
INSTRUMENTAL_FILENAME = "instrumental.wav"


def separate_stems(
    job_id: str,
    storage: StorageBackend,
    model_name: str = DEFAULT_MODEL,
    normalization_threshold: float = 0.9,
) -> dict[str, Any]:
    """Run BS-RoFormer stem separation on the extracted source audio.

    Downloads the model checkpoint on first run (~200 MB) to SEPARATOR_MODEL_DIR.
    On Mac CPU a 30s clip takes ~60s. On a T4 GPU RTF is ~0.5 (faster than real-time).

    Returns metadata dict for the caller to commit to the database.
    """
    from audio_separator.separator import Separator
    import soundfile as sf

    t0 = time.time()
    logger.info("[separate_stems] starting for job %s model=%s", job_id, model_name)

    source_path = storage.get_local_path(job_id, "source_audio.wav")
    source_duration_s = sf.info(source_path).duration

    out_dir = tempfile.mkdtemp(
        prefix=f"stems_{job_id}_",
        dir=os.environ.get("TMPDIR", "/tmp"),
    )

    try:
        model_dir = os.getenv("SEPARATOR_MODEL_DIR", "/data/models")

        sep = Separator(
            output_dir=out_dir,
            output_format="WAV",
            normalization_threshold=normalization_threshold,
            model_file_dir=model_dir,
        )
        sep.load_model(model_filename=model_name)
        sep.separate(source_path)

        elapsed = time.time() - t0
        rtf = elapsed / source_duration_s if source_duration_s > 0 else 0.0
        logger.info(
            "[separate_stems] job %s: separation done in %.1fs RTF=%.2f",
            job_id, elapsed, rtf,
        )

        # ── Detect output files ───────────────────────────────────
        # IMPORTANT: check instrumental/no_vocal keywords FIRST.
        # 'vocal' in filename.lower() would also match 'no_vocal' — that's a bug.
        # The notebook documents this exact fix.
        found_vocals = None
        found_instrumental = None
        for fn in os.listdir(out_dir):
            fl = fn.lower()
            if any(k in fl for k in ("instrumental", "no_vocal", "no-vocal", "music", "accompaniment")):
                found_instrumental = fn
            elif "vocal" in fl:
                found_vocals = fn

        if not found_vocals:
            raise RuntimeError(
                f"[separate_stems] job {job_id}: no vocals file produced. "
                f"Directory contents: {os.listdir(out_dir)}"
            )
        if not found_instrumental:
            raise RuntimeError(
                f"[separate_stems] job {job_id}: no instrumental file produced. "
                f"Directory contents: {os.listdir(out_dir)}"
            )

        storage.move_from_path(job_id, VOCALS_FILENAME, os.path.join(out_dir, found_vocals))
        storage.move_from_path(job_id, INSTRUMENTAL_FILENAME, os.path.join(out_dir, found_instrumental))

        elapsed_total = time.time() - t0
        logger.info(
            "[separate_stems] complete for job %s in %.1fs RTF=%.2f",
            job_id, elapsed_total, rtf,
        )

        return {
            "vocals_filename": VOCALS_FILENAME,
            "instrumental_filename": INSTRUMENTAL_FILENAME,
            "model": model_name,
            "rtf": round(rtf, 3),
        }

    finally:
        shutil.rmtree(out_dir, ignore_errors=True)
