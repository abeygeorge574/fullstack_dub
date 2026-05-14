import io
import logging

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def apply_corrections(
    vocals_path: str,
    instrumental_path: str,
    corrections: list[dict],
) -> tuple[bytes, bytes]:
    """
    Bake editor corrections into both stems and return (vocals_wav_bytes, instrumental_wav_bytes).

    Each correction: {from: 'voc'|'ins', to: 'voc'|'ins', start: float, end: float}
      - Silence the region on the 'from' stem.
      - Mix the original 'from' audio into the 'to' stem for the same region.
    """
    voc_data, voc_sr = sf.read(vocals_path, dtype="float32", always_2d=True)
    ins_data, ins_sr = sf.read(instrumental_path, dtype="float32", always_2d=True)

    if voc_sr != ins_sr:
        raise ValueError(f"Sample rate mismatch: vocals={voc_sr}, instrumental={ins_sr}")
    sr = voc_sr

    voc_out = voc_data.copy()
    ins_out = ins_data.copy()

    for c in corrections:
        s = max(0, int(float(c["start"]) * sr))
        e = int(float(c["end"]) * sr)

        if c["from"] == "voc":
            ev = min(len(voc_out), e)
            ei = min(len(ins_out), e)
            voc_out[s:ev] = 0.0
            n = min(ev - s, ei - s)
            if n > 0:
                ins_out[s : s + n] += voc_data[s : s + n]
        else:  # from == 'ins'
            ei = min(len(ins_out), e)
            ev = min(len(voc_out), e)
            ins_out[s:ei] = 0.0
            n = min(ei - s, ev - s)
            if n > 0:
                voc_out[s : s + n] += ins_data[s : s + n]

    # Hard-clip to [-1, 1] to avoid WAV overflow when mixing adds energy
    voc_out = np.clip(voc_out, -1.0, 1.0)
    ins_out = np.clip(ins_out, -1.0, 1.0)

    def _to_wav(audio: np.ndarray) -> bytes:
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf.read()

    logger.info(
        "[apply_corrections] %d corrections applied — voc=%s ins=%s sr=%d",
        len(corrections), vocals_path, instrumental_path, sr,
    )
    return _to_wav(voc_out), _to_wav(ins_out)
