"""Stage 2 — Speaker diarization.

VAD:     FFmpeg silencedetect at -30 dB, 0.1 s minimum silence
Embed:   pyannote/embedding model (needs HF_TOKEN env var)
Cluster: sklearn AgglomerativeClustering on cosine distances

Falls back to single-speaker output if HF_TOKEN is missing or pyannote fails.
"""

import logging
import os
import subprocess

import numpy as np

logger = logging.getLogger(__name__)

SPEAKER_PALETTE = [
    {"color": "#a78bfa", "colorDim": "rgba(167,139,250,0.18)", "colorBg": "rgba(167,139,250,0.06)"},
    {"color": "#e879f9", "colorDim": "rgba(232,121,249,0.18)", "colorBg": "rgba(232,121,249,0.06)"},
    {"color": "#86efac", "colorDim": "rgba(134,239,172,0.18)", "colorBg": "rgba(134,239,172,0.06)"},
    {"color": "#f472b6", "colorDim": "rgba(244,114,182,0.18)", "colorBg": "rgba(244,114,182,0.06)"},
    {"color": "#67e8f9", "colorDim": "rgba(103,232,249,0.18)", "colorBg": "rgba(103,232,249,0.06)"},
    {"color": "#fcd34d", "colorDim": "rgba(252,211,77,0.18)",  "colorBg": "rgba(252,211,77,0.06)"},
    {"color": "#fda4af", "colorDim": "rgba(253,164,175,0.18)", "colorBg": "rgba(253,164,175,0.06)"},
]


def _get_duration(audio_path: str) -> float:
    """Return audio duration in seconds via ffprobe."""
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path,
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def _run_silencedetect(audio_path: str, threshold_db: float = -30.0, min_silence_s: float = 0.1) -> list[dict]:
    """FFmpeg silencedetect → list of speech intervals [{start, end}]."""
    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-af", f"silencedetect=n={threshold_db}dB:d={min_silence_s}",
        "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    stderr = proc.stderr

    silences: list[tuple[float, float]] = []
    silence_start = None
    for line in stderr.splitlines():
        if "silence_start" in line:
            try:
                silence_start = float(line.split("silence_start:")[1].strip())
            except (IndexError, ValueError):
                pass
        elif "silence_end" in line and silence_start is not None:
            try:
                parts = line.split("silence_end:")[1].strip().split()
                silence_end = float(parts[0])
                silences.append((silence_start, silence_end))
                silence_start = None
            except (IndexError, ValueError):
                pass

    duration = _get_duration(audio_path)

    # Convert silence intervals to speech intervals
    speech: list[dict] = []
    prev_end = 0.0
    for sil_start, sil_end in sorted(silences):
        if sil_start - prev_end >= 0.1:
            speech.append({"start": round(prev_end, 3), "end": round(sil_start, 3)})
        prev_end = sil_end
    if duration - prev_end >= 0.1:
        speech.append({"start": round(prev_end, 3), "end": round(duration, 3)})

    # Filter sub-100ms segments
    return [s for s in speech if s["end"] - s["start"] >= 0.1]


def _compute_embeddings(audio_path: str, segments: list[dict], hf_token: str) -> np.ndarray:
    """Compute per-segment speaker embeddings using pyannote/embedding."""
    from pyannote.audio import Inference
    from pyannote.core import Segment

    inference = Inference(
        "pyannote/embedding",
        window="whole",
        use_auth_token=hf_token,
    )

    embeddings = []
    for seg in segments:
        duration = seg["end"] - seg["start"]
        if duration < 0.5:
            embeddings.append(np.zeros(512))
            continue
        try:
            emb = inference.crop(audio_path, Segment(seg["start"], seg["end"]))
            embeddings.append(np.array(emb).flatten())
        except Exception as e:
            logger.warning("Embedding failed for segment %s: %s", seg, e)
            embeddings.append(np.zeros(512))

    return np.array(embeddings, dtype=float)


def _cluster(embeddings: np.ndarray, distance_threshold: float = 0.7) -> np.ndarray:
    """Agglomerative clustering on cosine distances. Returns label array."""
    from sklearn.cluster import AgglomerativeClustering

    if len(embeddings) == 0:
        return np.array([], dtype=int)
    if len(embeddings) == 1:
        return np.array([0], dtype=int)

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1
    normed = embeddings / norms

    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=distance_threshold,
        metric="cosine",
        linkage="average",
    )
    return clustering.fit_predict(normed)


def run_diarization(job_id: str, storage) -> dict:
    """Main entry point. Returns {"speakers": [...], "segments": [...]}."""
    vocals_path = storage.get_local_path(job_id, "vocals_final.wav")
    if not os.path.exists(vocals_path):
        raise FileNotFoundError(f"vocals_final.wav not found for job {job_id}")

    logger.info("[diarization] job=%s: running silencedetect VAD", job_id)
    speech_segs = _run_silencedetect(vocals_path, threshold_db=-30.0, min_silence_s=0.1)
    logger.info("[diarization] job=%s: %d speech segments detected", job_id, len(speech_segs))

    if not speech_segs:
        return {"speakers": [], "segments": []}

    hf_token = os.getenv("HF_TOKEN")
    labels: np.ndarray

    if hf_token:
        try:
            logger.info("[diarization] job=%s: computing pyannote embeddings", job_id)
            embeddings = _compute_embeddings(vocals_path, speech_segs, hf_token)
            labels = _cluster(embeddings)
            logger.info(
                "[diarization] job=%s: clustered into %d speakers",
                job_id, len(set(labels.tolist())),
            )
        except Exception as e:
            logger.warning(
                "[diarization] job=%s: pyannote failed (%s), using single-speaker fallback",
                job_id, e,
            )
            labels = np.zeros(len(speech_segs), dtype=int)
    else:
        logger.warning(
            "[diarization] job=%s: HF_TOKEN not set, assigning all segments to Speaker 1",
            job_id,
        )
        labels = np.zeros(len(speech_segs), dtype=int)

    unique_labels = sorted(set(int(l) for l in labels))
    speakers = []
    label_to_id: dict[int, str] = {}
    for i, lbl in enumerate(unique_labels):
        palette = SPEAKER_PALETTE[i % len(SPEAKER_PALETTE)]
        spk_id = f"s{i + 1}"
        label_to_id[lbl] = spk_id
        speakers.append({
            "id": spk_id,
            "name": f"Speaker {i + 1}",
            "gender": "N",
            "age": "adult",
            "photo": None,
            **palette,
        })

    segments = []
    for idx, (seg, lbl) in enumerate(zip(speech_segs, labels)):
        segments.append({
            "id": f"g{idx + 1:04d}",
            "speakerId": label_to_id[int(lbl)],
            "start": seg["start"],
            "end": seg["end"],
            "text": "",
            "tx": "",
            "status": "draft",
            "flagged": False,
        })

    return {"speakers": speakers, "segments": segments}
