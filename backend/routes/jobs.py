import io
import json
import logging
import os
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import SessionLocal, get_db
from pipeline.audio_extraction import extract_audio
from pipeline.stem_separation import separate_stems
from pipeline.storage import StorageBackend, get_storage
from pipeline.waveform import compute_waveform

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _job_or_404(job_id: str, db: Session) -> models.Job:
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


def _job_response(job: models.Job, storage: StorageBackend) -> dict[str, Any]:
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "current_stage": job.current_stage,
        "source_filename": job.source_filename,
        "source_lang": job.source_lang,
        "target_lang": job.target_lang,
        "fps": job.fps,
        "duration_s": job.duration_s,
        "sample_rate": job.sample_rate,
        "vocals_label": job.vocals_label,
        "instrumental_label": job.instrumental_label,
        "corrections": json.loads(job.corrections_json or "[]"),
        "flags": json.loads(job.flags_json or "[]"),
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() + "Z" if job.created_at else None,
        "committed_at": job.committed_at.isoformat() + "Z" if job.committed_at else None,
        "vocals_url": storage.get_url(job.id, "vocals.wav") if job.vocals_path else None,
        "instrumental_url": storage.get_url(job.id, "instrumental.wav") if job.instrumental_path else None,
        "htdemucs_vocals_url": storage.get_url(job.id, "htdemucs_vocals.wav") if job.htdemucs_vocals_path else None,
        "diarization_status": job.diarization_status,
        "transcription_status": job.transcription_status,
        "translation_status": job.translation_status,
        "tts_status": job.tts_status,
        "lipsync_status": job.lipsync_status,
    }


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse HTTP Range header. Returns (start, end) inclusive."""
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid Range header")
    spec = range_header[6:]
    parts = spec.split("-", 1)
    try:
        if parts[0] == "":
            start = file_size - int(parts[1])
            end = file_size - 1
        elif parts[1] == "":
            start = int(parts[0])
            end = file_size - 1
        else:
            start = int(parts[0])
            end = int(parts[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=416, detail="Malformed Range header")

    start = max(0, start)
    end = min(file_size - 1, end)
    if start > end:
        raise HTTPException(status_code=416, detail="Range not satisfiable")
    return start, end


# ── Background pipeline ────────────────────────────────────────────────────────

def run_pipeline(job_id: str) -> None:
    """Sync function — Starlette BackgroundTasks runs this in a thread via anyio."""
    db = SessionLocal()
    storage = get_storage()
    t0 = time.time()
    logger.info("[pipeline] job %s: starting", job_id)

    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            logger.error("[pipeline] job %s not found in DB", job_id)
            return

        # ── Stage A: Extract audio ────────────────────────────────
        job.status = "extracting"
        job.progress = 5
        db.commit()
        logger.info("[pipeline] job %s: extracting audio", job_id)

        audio_meta = extract_audio(job_id, job.source_path, storage)
        job.audio_path = storage.get_local_path(job_id, audio_meta["audio_filename"])
        job.duration_s = audio_meta["duration_s"]
        job.sample_rate = audio_meta["sample_rate"]
        job.progress = 30
        db.commit()

        # ── Stage B: Separate stems ───────────────────────────────
        job.status = "separating"
        job.progress = 35
        db.commit()
        logger.info("[pipeline] job %s: separating stems", job_id)

        stem_meta = separate_stems(job_id, storage)
        job.vocals_path = storage.get_local_path(job_id, stem_meta["vocals_filename"])
        job.instrumental_path = storage.get_local_path(job_id, stem_meta["instrumental_filename"])
        job.htdemucs_vocals_path = storage.get_local_path(job_id, stem_meta["htdemucs_vocals_filename"])
        job.stem_model = stem_meta["model"]
        job.progress = 85
        db.commit()

        # ── Stage C: Compute waveforms ────────────────────────────
        logger.info("[pipeline] job %s: computing waveforms", job_id)

        voc_wave = compute_waveform(storage.get_local_path(job_id, "vocals.wav"), num_samples=4000)
        storage.write_json(job_id, "vocals_waveform.json", {"samples": voc_wave})
        job.vocals_waveform_path = storage.get_local_path(job_id, "vocals_waveform.json")

        ins_wave = compute_waveform(storage.get_local_path(job_id, "instrumental.wav"), num_samples=4000)
        storage.write_json(job_id, "instrumental_waveform.json", {"samples": ins_wave})
        job.instrumental_waveform_path = storage.get_local_path(job_id, "instrumental_waveform.json")

        htd_wave = compute_waveform(storage.get_local_path(job_id, "htdemucs_vocals.wav"), num_samples=4000)
        storage.write_json(job_id, "htdemucs_vocals_waveform.json", {"samples": htd_wave})
        job.htdemucs_vocals_waveform_path = storage.get_local_path(job_id, "htdemucs_vocals_waveform.json")

        job.status = "ready"
        job.progress = 100
        db.commit()

        elapsed = time.time() - t0
        logger.info("[pipeline] job %s: complete in %.1fs status=ready", job_id, elapsed)

    except Exception as exc:
        elapsed = time.time() - t0
        logger.exception("[pipeline] job %s failed after %.1fs: %s", job_id, elapsed, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.status = "error"
                job.error_message = str(exc)[:2000]
                db.commit()
        except Exception as inner:
            logger.error("[pipeline] job %s: failed to record error: %s", job_id, inner)
    finally:
        db.close()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_lang: str = Form(default="hi"),
    target_lang: str = Form(default="en"),
    fps: float = Form(default=24.0),
    user_id: Optional[str] = Form(default=None),
    team_id: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, str]:
    t0 = time.time()
    max_bytes = int(os.getenv("MAX_UPLOAD_SIZE_GB", "2")) * 1024 ** 3

    job = models.Job(
        source_filename=file.filename or "upload",
        source_path="",  # filled after streaming save below
        source_lang=source_lang,
        target_lang=target_lang,
        fps=fps,
        user_id=user_id,
        team_id=team_id,
        status="pending",
    )
    db.add(job)
    db.flush()  # assign job.id without committing
    logger.info("[upload] starting for job %s file=%s", job.id, file.filename)

    ext = Path(file.filename or "upload").suffix.lower() or ".bin"
    # Sanitize: keep only the extension, use canonical source filename
    storage_filename = f"source{ext}" if ext.isalpha() or ext in (".mp4", ".mkv", ".mov", ".mxf", ".avi", ".wav", ".mp3") else "source.bin"

    suffix = Path(storage_filename).suffix
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix,
        dir=os.environ.get("TMPDIR", "/tmp"),
    ) as tf:
        tmp_path = tf.name

    try:
        total_bytes = 0
        async with aiofiles.open(tmp_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks — never load whole file
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds {os.getenv('MAX_UPLOAD_SIZE_GB', 2)} GB limit",
                    )
                await out.write(chunk)

        storage.move_from_path(job.id, storage_filename, tmp_path)
        job.source_path = storage.get_local_path(job.id, storage_filename)
        db.commit()

        elapsed = time.time() - t0
        logger.info(
            "[upload] complete in %.1fs job=%s bytes=%d status=pending",
            elapsed, job.id, total_bytes,
        )

    except HTTPException:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        db.rollback()
        raise
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        db.rollback()
        logger.exception("[upload] failed for job %s: %s", job.id, exc)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    background_tasks.add_task(run_pipeline, job.id)
    return {"job_id": job.id}


@router.get("/jobs")
def list_jobs(
    limit: int = 10,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    jobs = (
        db.query(models.Job)
        .order_by(models.Job.updated_at.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return [
        {
            "id": j.id,
            "source_filename": j.source_filename,
            "status": j.status,
            "progress": j.progress,
            "duration_s": j.duration_s,
            "created_at": j.created_at.isoformat() + "Z" if j.created_at else None,
        }
        for j in jobs
    ]


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, Any]:
    logger.info("[get_job] job=%s", job_id)
    job = _job_or_404(job_id, db)
    return _job_response(job, storage)


@router.get("/jobs/{job_id}/stems/audio/{stem}")
async def stream_audio(
    request: Request,
    job_id: str,
    stem: str,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
):
    VALID_STEMS = ("vocals", "instrumental", "htdemucs_vocals")
    if stem not in VALID_STEMS:
        raise HTTPException(status_code=400, detail=f"stem must be one of {VALID_STEMS}")

    job = _job_or_404(job_id, db)
    if job.status != "ready":
        raise HTTPException(status_code=404, detail=f"Stems not ready (status: {job.status})")

    filename = f"{stem}.wav"
    if not storage.exists(job_id, filename):
        raise HTTPException(status_code=404, detail=f"{filename} not found for job {job_id}")

    file_size = storage.file_size(job_id, filename)
    range_header = request.headers.get("range")

    if range_header:
        start, end = _parse_range(range_header, file_size)
        length = end - start + 1

        async def _iter_range():
            with storage.open_stream(job_id, filename, start_byte=start) as f:
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        logger.info("[stream_audio] job=%s stem=%s range=%d-%d/%d", job_id, stem, start, end, file_size)
        return StreamingResponse(
            _iter_range(),
            status_code=206,
            media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(length),
                "Accept-Ranges": "bytes",
            },
        )

    logger.info("[stream_audio] job=%s stem=%s full size=%d", job_id, stem, file_size)
    return FileResponse(
        storage.get_local_path(job_id, filename),
        media_type="audio/wav",
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


@router.get("/jobs/{job_id}/stems/export/{stem}")
def export_stem(
    job_id: str,
    stem: str,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
):
    """Return a stem WAV with corrections baked in (used by browser export download)."""
    if stem not in ("vocals", "instrumental", "htdemucs_vocals"):
        raise HTTPException(status_code=400, detail="stem must be 'vocals', 'instrumental', or 'htdemucs_vocals'")

    job = _job_or_404(job_id, db)
    if job.status != "ready":
        raise HTTPException(status_code=404, detail=f"Stems not ready (status: {job.status})")

    corrections = json.loads(job.corrections_json or "[]")
    raw_filename = f"{stem}.wav"

    if not corrections:
        # No corrections — serve raw file as a download
        if not storage.exists(job_id, raw_filename):
            raise HTTPException(status_code=404, detail=f"{raw_filename} not found for job {job_id}")
        logger.info("[export_stem] job=%s stem=%s (raw, no corrections)", job_id, stem)
        return FileResponse(
            storage.get_local_path(job_id, raw_filename),
            media_type="audio/wav",
            headers={"Content-Disposition": f'attachment; filename="{raw_filename}"'},
        )

    # Apply corrections and stream the corrected WAV
    from pipeline.apply_corrections import apply_corrections as _apply
    voc_path = storage.get_local_path(job_id, "vocals.wav")
    ins_path = storage.get_local_path(job_id, "instrumental.wav")
    htd_path = storage.get_local_path(job_id, "htdemucs_vocals.wav") if job.htdemucs_vocals_path else None
    logger.info("[export_stem] job=%s stem=%s applying %d corrections", job_id, stem, len(corrections))
    voc_bytes, ins_bytes, htd_bytes = _apply(voc_path, ins_path, corrections, htd_path)

    if stem == "vocals":
        data = voc_bytes
    elif stem == "instrumental":
        data = ins_bytes
    else:
        if htd_bytes is None:
            raise HTTPException(status_code=404, detail="HTDemucs vocals not available for this job")
        data = htd_bytes

    return StreamingResponse(
        io.BytesIO(data),
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}_corrected.wav"',
            "Content-Length": str(len(data)),
        },
    )


@router.get("/jobs/{job_id}/stems/waveform/{stem}")
def get_waveform(
    job_id: str,
    stem: str,
    samples: int = 1600,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, Any]:
    VALID_STEMS = ("vocals", "instrumental", "htdemucs_vocals")
    if stem not in VALID_STEMS:
        raise HTTPException(status_code=400, detail=f"stem must be one of {VALID_STEMS}")

    job = _job_or_404(job_id, db)
    if job.status != "ready":
        raise HTTPException(status_code=404, detail=f"Stems not ready (status: {job.status})")

    waveform_file = f"{stem}_waveform.json"
    if storage.exists(job_id, waveform_file):
        logger.info("[get_waveform] job=%s stem=%s (cached)", job_id, stem)
        return storage.read_json(job_id, waveform_file)

    # Fallback: compute on-the-fly if cache missing
    logger.info("[get_waveform] job=%s stem=%s (computing)", job_id, stem)
    audio_file = f"{stem}.wav"
    if not storage.exists(job_id, audio_file):
        raise HTTPException(status_code=404, detail=f"{audio_file} not found for job {job_id}")

    wave_samples = compute_waveform(storage.get_local_path(job_id, audio_file), num_samples=samples)
    data = {"samples": wave_samples}
    storage.write_json(job_id, waveform_file, data)
    return data


class _CorrectionsBody(BaseModel):
    corrections: list[dict[str, Any]]


class _FlagsBody(BaseModel):
    flags: list[dict[str, Any]]


class _RenameBody(BaseModel):
    label: str


class _ConfirmStemsBody(BaseModel):
    vocal_winner: str = "voc"  # "voc" = ElevenLabs vocals, "htd" = HTDemucs vocals


@router.post("/jobs/{job_id}/corrections")
def save_corrections(
    job_id: str,
    body: _CorrectionsBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    logger.info("[save_corrections] job=%s count=%d", job_id, len(body.corrections))
    job = _job_or_404(job_id, db)
    job.corrections_json = json.dumps(body.corrections)
    db.commit()
    return {"ok": True, "count": len(body.corrections)}


@router.post("/jobs/{job_id}/flags")
def save_flags(
    job_id: str,
    body: _FlagsBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    logger.info("[save_flags] job=%s count=%d", job_id, len(body.flags))
    job = _job_or_404(job_id, db)
    job.flags_json = json.dumps(body.flags)
    db.commit()
    return {"ok": True, "count": len(body.flags)}


@router.post("/jobs/{job_id}/track/{stem}/rename")
def rename_track(
    job_id: str,
    stem: str,
    body: _RenameBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if stem not in ("vocals", "instrumental"):
        raise HTTPException(status_code=400, detail="stem must be 'vocals' or 'instrumental'")
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="label cannot be empty")

    job = _job_or_404(job_id, db)
    if stem == "vocals":
        job.vocals_label = label
    else:
        job.instrumental_label = label
    db.commit()

    logger.info("[rename_track] job=%s stem=%s label=%r", job_id, stem, label)
    return {"ok": True, "stem": stem, "label": label}


@router.post("/jobs/{job_id}/re-separate")
async def re_separate(
    background_tasks: BackgroundTasks,
    job_id: str,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, Any]:
    """Reset a job back to pending and re-run the full separation pipeline."""
    job = _job_or_404(job_id, db)
    if not job.source_path:
        raise HTTPException(status_code=400, detail="No source file on record — cannot re-separate")

    job.status = "pending"
    job.progress = 0
    job.error_message = None
    job.current_stage = 0
    job.corrections_json = "[]"
    job.flags_json = "[]"
    job.committed_at = None
    job.audio_path = None
    job.duration_s = None
    job.sample_rate = None
    job.vocals_path = None
    job.instrumental_path = None
    job.htdemucs_vocals_path = None
    job.vocals_waveform_path = None
    job.instrumental_waveform_path = None
    job.htdemucs_vocals_waveform_path = None
    job.stem_model = None
    db.commit()

    background_tasks.add_task(run_pipeline, job_id)
    logger.info("[re_separate] job=%s re-queued", job_id)
    return {"ok": True, "job_id": job_id}


@router.post("/jobs/{job_id}/confirm-stems")
def confirm_stems(
    job_id: str,
    body: _ConfirmStemsBody = _ConfirmStemsBody(),
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.status != "ready":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot confirm stems — job status is '{job.status}', expected 'ready'",
        )

    from pipeline.apply_corrections import apply_corrections as _apply
    corrections = json.loads(job.corrections_json or "[]")
    voc_path = storage.get_local_path(job_id, "vocals.wav")
    ins_path = storage.get_local_path(job_id, "instrumental.wav")
    htd_path = storage.get_local_path(job_id, "htdemucs_vocals.wav") if job.htdemucs_vocals_path else None

    logger.info(
        "[confirm_stems] job=%s baking %d corrections, vocal_winner=%s",
        job_id, len(corrections), body.vocal_winner,
    )
    voc_bytes, ins_bytes, htd_bytes = _apply(voc_path, ins_path, corrections, htd_path)

    winner_bytes = (htd_bytes if htd_bytes is not None else voc_bytes) if body.vocal_winner == "htd" else voc_bytes

    storage.write_bytes(job_id, "vocals_final.wav", winner_bytes)
    storage.write_bytes(job_id, "instrumental_final.wav", ins_bytes)
    job.vocals_path = storage.get_local_path(job_id, "vocals_final.wav")
    job.instrumental_path = storage.get_local_path(job_id, "instrumental_final.wav")

    job.committed_at = datetime.utcnow()
    job.current_stage = 2
    db.commit()

    logger.info("[confirm_stems] job=%s committed at %s", job_id, job.committed_at)
    return _job_response(job, storage)


# ── Stage 2: Diarization ───────────────────────────────────────────────────────

def _run_diarization_bg(job_id: str) -> None:
    from pipeline.diarization import run_diarization
    db = SessionLocal()
    storage = get_storage()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return
        job.diarization_status = "running"
        db.commit()
        result = run_diarization(job_id, storage)
        job.speakers_json = json.dumps(result["speakers"])
        job.segments_json = json.dumps(result["segments"])
        job.diarization_status = "ready"
        db.commit()
        logger.info("[diarization] job=%s done: %d speakers %d segments",
                    job_id, len(result["speakers"]), len(result["segments"]))
    except Exception as exc:
        logger.exception("[diarization] job=%s failed: %s", job_id, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.diarization_status = "error"
                job.diarization_error = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/jobs/{job_id}/run-diarization")
def run_diarization_route(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.current_stage < 2:
        raise HTTPException(status_code=400, detail="Confirm stems first")
    job.diarization_status = "running"
    job.diarization_error = None
    db.commit()
    background_tasks.add_task(_run_diarization_bg, job_id)
    return {"ok": True, "status": "running"}


@router.get("/jobs/{job_id}/diarization")
def get_diarization(
    job_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    return {
        "status": job.diarization_status,
        "error": job.diarization_error,
        "speakers": json.loads(job.speakers_json or "[]"),
        "segments": json.loads(job.segments_json or "[]"),
    }


class _DiarizationConfirmBody(BaseModel):
    speakers: list[dict[str, Any]]
    segments: list[dict[str, Any]]


@router.post("/jobs/{job_id}/confirm-diarization")
def confirm_diarization(
    job_id: str,
    body: _DiarizationConfirmBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    job.speakers_json = json.dumps(body.speakers)
    job.segments_json = json.dumps(body.segments)
    job.diarization_status = "ready"
    job.current_stage = 3
    db.commit()
    logger.info("[confirm_diarization] job=%s → stage 3", job_id)
    return {"ok": True, "current_stage": job.current_stage}


# ── Stage 3: Transcription ─────────────────────────────────────────────────────

def _run_transcription_bg(job_id: str) -> None:
    from pipeline.transcription import transcribe_segments
    db = SessionLocal()
    storage = get_storage()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return
        job.transcription_status = "running"
        db.commit()
        segments = json.loads(job.segments_json or "[]")
        updated = transcribe_segments(job_id, storage, segments)
        job.segments_json = json.dumps(updated)
        job.transcription_status = "ready"
        db.commit()
        logger.info("[transcription] job=%s done: %d segments", job_id, len(updated))
    except Exception as exc:
        logger.exception("[transcription] job=%s failed: %s", job_id, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.transcription_status = "error"
                job.transcription_error = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/jobs/{job_id}/run-transcription")
def run_transcription_route(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.current_stage < 3:
        raise HTTPException(status_code=400, detail="Confirm diarization first")
    job.transcription_status = "running"
    job.transcription_error = None
    db.commit()
    background_tasks.add_task(_run_transcription_bg, job_id)
    return {"ok": True, "status": "running"}


@router.get("/jobs/{job_id}/transcription")
def get_transcription(
    job_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    return {
        "status": job.transcription_status,
        "error": job.transcription_error,
        "speakers": json.loads(job.speakers_json or "[]"),
        "segments": json.loads(job.segments_json or "[]"),
    }


class _SegmentsBody(BaseModel):
    segments: list[dict[str, Any]]
    speakers: list[dict[str, Any]] = []


@router.post("/jobs/{job_id}/confirm-transcription")
def confirm_transcription(
    job_id: str,
    body: _SegmentsBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    job.segments_json = json.dumps(body.segments)
    if body.speakers:
        job.speakers_json = json.dumps(body.speakers)
    job.transcription_status = "ready"
    job.current_stage = 4
    db.commit()
    logger.info("[confirm_transcription] job=%s → stage 4", job_id)
    return {"ok": True, "current_stage": job.current_stage}


# ── Stage 4: Translation ───────────────────────────────────────────────────────

def _run_translation_bg(job_id: str) -> None:
    from pipeline.translation import translate_segments
    db = SessionLocal()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return
        job.translation_status = "running"
        db.commit()
        segments = json.loads(job.segments_json or "[]")
        updated = translate_segments(job_id, segments,
                                     source_lang=job.source_lang or "hi",
                                     target_lang=job.target_lang or "en")
        job.segments_json = json.dumps(updated)
        job.translation_status = "ready"
        db.commit()
        logger.info("[translation] job=%s done: %d segments", job_id, len(updated))
    except Exception as exc:
        logger.exception("[translation] job=%s failed: %s", job_id, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.translation_status = "error"
                job.translation_error = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/jobs/{job_id}/run-translation")
def run_translation_route(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.current_stage < 4:
        raise HTTPException(status_code=400, detail="Confirm transcription first")
    job.translation_status = "running"
    job.translation_error = None
    db.commit()
    background_tasks.add_task(_run_translation_bg, job_id)
    return {"ok": True, "status": "running"}


@router.get("/jobs/{job_id}/translation")
def get_translation(
    job_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    return {
        "status": job.translation_status,
        "error": job.translation_error,
        "speakers": json.loads(job.speakers_json or "[]"),
        "segments": json.loads(job.segments_json or "[]"),
    }


@router.post("/jobs/{job_id}/confirm-translation")
def confirm_translation(
    job_id: str,
    body: _SegmentsBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    job.segments_json = json.dumps(body.segments)
    if body.speakers:
        job.speakers_json = json.dumps(body.speakers)
    job.translation_status = "ready"
    job.current_stage = 5
    db.commit()
    logger.info("[confirm_translation] job=%s → stage 5", job_id)
    return {"ok": True, "current_stage": job.current_stage}


# ── Stage 5: TTS ───────────────────────────────────────────────────────────────

def _run_tts_bg(job_id: str, speaker_voice_map: dict) -> None:
    """speaker_voice_map: {speaker_id: voice_id_or_null}"""
    from pipeline.tts import clone_speaker_voice, generate_segment_audio
    db = SessionLocal()
    storage = get_storage()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return
        job.tts_status = "running"
        db.commit()

        speakers = json.loads(job.speakers_json or "[]")
        segments = json.loads(job.segments_json or "[]")

        # Build segments-by-speaker map
        segs_by_spk: dict[str, list] = {sp["id"]: [] for sp in speakers}
        for seg in segments:
            if seg["speakerId"] in segs_by_spk:
                segs_by_spk[seg["speakerId"]].append(seg)

        # Clone voices for speakers that requested it
        voice_map = dict(speaker_voice_map)
        for sp in speakers:
            if voice_map.get(sp["id"]) == "clone":
                try:
                    vid = clone_speaker_voice(job_id, sp, storage, segs_by_spk[sp["id"]])
                    voice_map[sp["id"]] = vid
                except Exception as e:
                    logger.error("[tts] clone failed for %s: %s", sp["id"], e)
                    voice_map[sp["id"]] = None

        # Generate audio per segment
        updated_segs = []
        for seg in segments:
            voice_id = voice_map.get(seg["speakerId"])
            if not voice_id or not (seg.get("tx") or seg.get("text")):
                updated_segs.append({**seg, "status": "skipped"})
                continue
            try:
                filename = generate_segment_audio(job_id, seg, voice_id, storage)
                updated_segs.append({**seg, "status": "audio-ready", "audioFile": filename})
            except Exception as e:
                logger.error("[tts] generate failed for seg %s: %s", seg["id"], e)
                updated_segs.append({**seg, "status": "error"})

        # Persist voice_id back into speakers
        updated_spks = []
        for sp in speakers:
            vid = voice_map.get(sp["id"])
            updated_spks.append({**sp, "voiceId": vid} if vid else sp)

        job.speakers_json = json.dumps(updated_spks)
        job.segments_json = json.dumps(updated_segs)
        job.tts_status = "ready"
        db.commit()
        logger.info("[tts] job=%s done", job_id)
    except Exception as exc:
        logger.exception("[tts] job=%s failed: %s", job_id, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.tts_status = "error"
                job.tts_error = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


class _TTSRunBody(BaseModel):
    speaker_voice_map: dict[str, str] = {}


@router.post("/jobs/{job_id}/run-tts")
def run_tts_route(
    job_id: str,
    body: _TTSRunBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.current_stage < 5:
        raise HTTPException(status_code=400, detail="Confirm translation first")
    job.tts_status = "running"
    job.tts_error = None
    db.commit()
    background_tasks.add_task(_run_tts_bg, job_id, body.speaker_voice_map)
    return {"ok": True, "status": "running"}


@router.get("/jobs/{job_id}/tts")
def get_tts(
    job_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    return {
        "status": job.tts_status,
        "error": job.tts_error,
        "speakers": json.loads(job.speakers_json or "[]"),
        "segments": json.loads(job.segments_json or "[]"),
    }


@router.get("/jobs/{job_id}/tts/audio/{segment_id}")
def stream_tts_audio(
    job_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
):
    job = _job_or_404(job_id, db)
    filename = f"tts_{segment_id}.wav"
    if not storage.exists(job_id, filename):
        raise HTTPException(status_code=404, detail=f"TTS audio not found for segment {segment_id}")
    return FileResponse(
        storage.get_local_path(job_id, filename),
        media_type="audio/wav",
        headers={"Accept-Ranges": "bytes"},
    )


@router.post("/jobs/{job_id}/confirm-tts")
def confirm_tts(
    job_id: str,
    body: _SegmentsBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    job.segments_json = json.dumps(body.segments)
    if body.speakers:
        job.speakers_json = json.dumps(body.speakers)
    job.tts_status = "ready"
    job.current_stage = 6
    db.commit()
    logger.info("[confirm_tts] job=%s → stage 6", job_id)
    return {"ok": True, "current_stage": job.current_stage}


# ── Stage 6: Lipsync ───────────────────────────────────────────────────────────

def _run_lipsync_bg(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return
        job.lipsync_status = "running"
        db.commit()
        # TODO: integrate lipsync model
        job.lipsync_status = "ready"
        db.commit()
        logger.info("[lipsync] job=%s done (placeholder)", job_id)
    except Exception as exc:
        logger.exception("[lipsync] job=%s failed: %s", job_id, exc)
        try:
            db.rollback()
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.lipsync_status = "error"
                job.lipsync_error = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/jobs/{job_id}/run-lipsync")
def run_lipsync_route(
    job_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    if job.current_stage < 6:
        raise HTTPException(status_code=400, detail="Confirm TTS first")
    job.lipsync_status = "running"
    job.lipsync_error = None
    db.commit()
    background_tasks.add_task(_run_lipsync_bg, job_id)
    return {"ok": True, "status": "running"}


@router.get("/jobs/{job_id}/lipsync")
def get_lipsync(
    job_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = _job_or_404(job_id, db)
    return {
        "status": job.lipsync_status,
        "error": job.lipsync_error,
        "video_path": job.lipsync_video_path,
    }
