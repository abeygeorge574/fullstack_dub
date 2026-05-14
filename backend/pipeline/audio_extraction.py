import json
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import soundfile as sf

from pipeline.storage import StorageBackend

logger = logging.getLogger(__name__)

AUDIO_FILENAME = "source_audio.wav"


def extract_audio(job_id: str, source_path: str, storage: StorageBackend) -> dict[str, Any]:
    """Extract audio from a video/audio file at native sample rate.

    No -ar flag — ffmpeg preserves whatever sample rate the source stream
    reports. Only downstream models that require a specific rate (e.g. ASR
    at 16 kHz) should resample, and only in memory.

    Returns metadata dict for the caller to commit to the database.
    """
    t0 = time.time()
    logger.info("[extract_audio] starting for job %s source=%s", job_id, source_path)

    # ── 1. Probe native sample rate and duration ─────────────────
    probe = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", "-show_streams",
            source_path,
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise RuntimeError(
            f"[extract_audio] ffprobe failed for job {job_id}: {probe.stderr[-500:]}"
        )

    info = json.loads(probe.stdout)
    duration_s = float(info["format"]["duration"])

    sample_rate = None
    for stream in info["streams"]:
        if stream.get("codec_type") == "audio" and stream.get("sample_rate"):
            sample_rate = int(stream["sample_rate"])
            break

    if sample_rate is None:
        raise RuntimeError(
            f"[extract_audio] no audio stream found in {source_path} for job {job_id}"
        )

    logger.info(
        "[extract_audio] job %s probed: duration=%.2fs sample_rate=%d Hz",
        job_id, duration_s, sample_rate,
    )

    # ── 2. Extract at native SR ───────────────────────────────────
    with tempfile.NamedTemporaryFile(
        suffix=".wav",
        dir=os.environ.get("TMPDIR", "/tmp"),
        delete=False,
    ) as tf:
        tmp_path = tf.name

    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", source_path,
            "-vn",                  # discard video stream
            "-acodec", "pcm_s16le", # 16-bit signed PCM lossless
            "-ac", "2",             # stereo
            # NO -ar flag: preserve native sample rate
            tmp_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(
                f"[extract_audio] ffmpeg failed for job {job_id}: {res.stderr[-500:]}"
            )

        # ── 3. Verify SR matches probe ────────────────────────────
        _, verified_sr = sf.read(tmp_path, frames=1)
        if verified_sr != sample_rate:
            logger.warning(
                "[extract_audio] job %s: extracted SR %d differs from probed %d",
                job_id, verified_sr, sample_rate,
            )
            sample_rate = verified_sr

        # ── 4. Move into storage ──────────────────────────────────
        storage.move_from_path(job_id, AUDIO_FILENAME, tmp_path)
        elapsed = time.time() - t0
        logger.info(
            "[extract_audio] complete for job %s in %.1fs SR=%d duration=%.2fs",
            job_id, elapsed, sample_rate, duration_s,
        )

        return {
            "audio_filename": AUDIO_FILENAME,
            "duration_s": duration_s,
            "sample_rate": sample_rate,
            "channels": 2,
        }

    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
