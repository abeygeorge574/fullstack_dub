import logging
from typing import Any

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def compute_waveform(audio_path: str, num_samples: int = 1600) -> list[float]:
    """Compute peak-normalized amplitude samples for a WAV file.

    Each bucket is the peak absolute amplitude across all frames in that
    bucket and all channels. Returns a list of `num_samples` values in [0, 1].

    The WaveformCanvas in the frontend resamples these into visual bars using
    its own avg/max blend — we just need to supply raw normalized amplitudes.
    """
    logger.debug("[compute_waveform] path=%s samples=%d", audio_path, num_samples)

    y, _ = sf.read(audio_path, always_2d=True)
    y_peak = np.abs(y).max(axis=1)   # peak amplitude per frame across channels
    n = len(y_peak)

    bucket_size = max(1, n // num_samples)
    samples: list[float] = []
    for i in range(num_samples):
        start = i * bucket_size
        end = min(n, start + bucket_size)
        if start >= n:
            samples.append(0.0)
        else:
            samples.append(float(np.max(y_peak[start:end])))

    # Normalize so the loudest bucket is 1.0
    max_val = max(samples) if samples else 1.0
    if max_val > 0:
        samples = [min(1.0, v / max_val) for v in samples]

    return samples
