import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, Text

from database import Base


def _uuid() -> str:
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    short = str(uuid.uuid4())[:8]
    return f"{ts}_{short}"


class Job(Base):
    """One dubbing job = one source video moving through all six pipeline stages."""

    __tablename__ = "jobs"

    # ── Identity ──────────────────────────────────────────────────────────────
    id         = Column(String, primary_key=True, default=_uuid)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        onupdate=datetime.utcnow)

    # Future auth — unused until auth layer is wired
    user_id = Column(String, nullable=True)
    team_id = Column(String, nullable=True)

    # ── Source video ──────────────────────────────────────────────────────────
    source_filename = Column(String, nullable=False)
    source_path     = Column(String, nullable=False)   # /data/jobs/{id}/source.*
    source_lang     = Column(String, nullable=False, default="hi")
    target_lang     = Column(String, nullable=False, default="en")
    fps             = Column(Float,  nullable=False, default=24.0)

    # ── Pipeline status ───────────────────────────────────────────────────────
    # Valid values: pending | extracting | separating | ready | error
    status        = Column(String,  nullable=False, default="pending")
    progress      = Column(Integer, nullable=False, default=0)   # 0–100
    error_message = Column(Text,    nullable=True)
    current_stage = Column(Integer, nullable=False, default=0)

    # ── Stage 1: audio extraction ─────────────────────────────────────────────
    audio_path  = Column(String,  nullable=True)   # /data/jobs/{id}/source_audio.wav
    duration_s  = Column(Float,   nullable=True)
    sample_rate = Column(Integer, nullable=True)

    # ── Stage 1: stem separation ──────────────────────────────────────────────
    vocals_path                = Column(String, nullable=True)
    instrumental_path          = Column(String, nullable=True)
    vocals_waveform_path       = Column(String, nullable=True)   # precomputed .json
    instrumental_waveform_path = Column(String, nullable=True)
    htdemucs_vocals_path          = Column(String, nullable=True)  # HTDemucs vocal stem (reference)
    htdemucs_vocals_waveform_path = Column(String, nullable=True)
    stem_model                 = Column(String, nullable=True)

    # ── Stage 1: track labels (user-renameable) ───────────────────────────────
    vocals_label       = Column(String, nullable=False, default="Vocals")
    instrumental_label = Column(String, nullable=False, default="Instrumental")

    # ── Stage 1: editor state (saved incrementally after every change) ────────
    corrections_json = Column(Text, nullable=False, default="[]")
    flags_json       = Column(Text, nullable=False, default="[]")
    committed_at     = Column(DateTime, nullable=True)   # set by confirm-stems

    # ── Stage 2: Diarization ─────────────────────────────────────────────────
    # status: pending | running | ready | error
    diarization_status = Column(String, nullable=False, default="pending")
    diarization_error  = Column(Text, nullable=True)
    # speakers_json: [{id, name, color, colorDim, colorBg, gender, age, photo}]
    # segments_json: [{id, speakerId, start, end, text, tx, status, flagged}]
    speakers_json  = Column(Text, nullable=False, default="[]")
    segments_json  = Column(Text, nullable=False, default="[]")

    # ── Stage 3: Transcription ───────────────────────────────────────────────
    transcription_status = Column(String, nullable=False, default="pending")
    transcription_error  = Column(Text, nullable=True)

    # ── Stage 4: Translation ─────────────────────────────────────────────────
    translation_status = Column(String, nullable=False, default="pending")
    translation_error  = Column(Text, nullable=True)

    # ── Stage 5: TTS ─────────────────────────────────────────────────────────
    tts_status = Column(String, nullable=False, default="pending")
    tts_error  = Column(Text, nullable=True)

    # ── Stage 6: Lipsync ─────────────────────────────────────────────────────
    lipsync_status     = Column(String, nullable=False, default="pending")
    lipsync_error      = Column(Text, nullable=True)
    lipsync_video_path = Column(String, nullable=True)
