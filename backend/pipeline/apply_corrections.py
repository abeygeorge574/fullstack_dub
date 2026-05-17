"""Bake stem corrections into final WAV files.

Correction schema:
  { "from": "voc"|"htd"|"ins", "to": "voc"|"htd"|"ins"|null, "start": float, "end": float }

  All three tracks (voc = ElevenLabs vocals, htd = HTDemucs vocals, ins = instrumental) are
  fully mutable. Any region can be moved to any other track or deleted (to=null).
"""
import io
import logging

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def apply_corrections(
    vocals_path: str,
    instrumental_path: str,
    corrections: list[dict],
    htd_vocals_path: str | None = None,
) -> tuple[bytes, bytes, bytes | None]:
    """Apply corrections and return (voc_wav, ins_wav, htd_wav|None)."""

    voc_data, voc_sr = sf.read(vocals_path, dtype="float32", always_2d=True)
    ins_data, ins_sr = sf.read(instrumental_path, dtype="float32", always_2d=True)
    sr = voc_sr

    htd_data = None
    if htd_vocals_path:
        try:
            htd_data, _ = sf.read(htd_vocals_path, dtype="float32", always_2d=True)
        except Exception as exc:
            logger.warning("[apply_corrections] could not load htd vocals: %s", exc)

    # Normalize all tracks to the same channel count (mono EL vocals ↔ stereo HTDemucs)
    all_arrays = [a for a in [voc_data, ins_data, htd_data] if a is not None]
    n_ch = max(a.shape[1] for a in all_arrays)

    def _match_ch(arr: np.ndarray) -> np.ndarray:
        if arr.shape[1] == n_ch:
            return arr
        if arr.shape[1] == 1:
            return np.repeat(arr, n_ch, axis=1)  # mono → stereo
        return arr[:, :n_ch]  # trim extra channels

    voc_data = _match_ch(voc_data)
    ins_data = _match_ch(ins_data)
    if htd_data is not None:
        htd_data = _match_ch(htd_data)

    voc_out = voc_data.copy()
    ins_out = ins_data.copy()
    htd_out = htd_data.copy() if htd_data is not None else None

    # Generic src/dst mapping — all three tracks are mutable
    source_data = {"voc": voc_data, "ins": ins_data, "htd": htd_data}
    out_arrays  = {"voc": voc_out,  "ins": ins_out,  "htd": htd_out}

    for c in corrections:
        s   = max(0, int(float(c["start"]) * sr))
        e   = int(float(c["end"]) * sr)
        frm = c.get("from", "voc")
        to  = c.get("to")  # None = delete (silence only)

        src_data = source_data.get(frm)
        src_out  = out_arrays.get(frm)

        if src_data is None or src_out is None:
            continue

        # Silence source region
        ec = min(len(src_out), e)
        src_out[s:ec] = 0.0

        # Graft into destination (skip if delete)
        if to is not None:
            dst_out = out_arrays.get(to)
            if dst_out is not None:
                ed = min(len(dst_out), e)
                n  = min(ec - s, ed - s)
                if n > 0:
                    dst_out[s:s + n] += src_data[s:s + n]

    def _to_wav(audio: np.ndarray) -> bytes:
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return buf.read()

    voc_out = np.clip(voc_out, -1.0, 1.0)
    ins_out = np.clip(ins_out, -1.0, 1.0)

    htd_bytes = None
    if htd_out is not None:
        htd_out = np.clip(htd_out, -1.0, 1.0)
        htd_bytes = _to_wav(htd_out)

    logger.info(
        "[apply_corrections] %d corrections applied — voc=%s ins=%s sr=%d",
        len(corrections), vocals_path, instrumental_path, sr,
    )
    return _to_wav(voc_out), _to_wav(ins_out), htd_bytes
