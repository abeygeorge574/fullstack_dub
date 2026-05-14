# ── Build stage ───────────────────────────────────────────────────────────────
# python:3.11-slim keeps the image small. PyTorch with CUDA (installed via the
# audio-separator[gpu] override below) bundles its own CUDA runtime, so we
# don't need an nvidia/cuda base image — we only need the NVIDIA Container
# Runtime at docker-run time:
#
#   docker run --gpus all --runtime=nvidia ...
#
# For GPU access on the Vertex AI Workbench VM, ensure the NVIDIA Container
# Runtime is installed and add --gpus all to your docker run command.
FROM python:3.11-slim

# ── System dependencies ───────────────────────────────────────────────────────
# ffmpeg: audio extraction (notebook 01 logic)
# libsndfile1: required by soundfile / librosa
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python dependencies ───────────────────────────────────────────────────────
# Copy requirements first so pip layer is cached when only app code changes.
# requirements.txt pins audio-separator[cpu] for local Mac dev.
# We override it here with [gpu] for the T4 production VM.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir "audio-separator[gpu]>=0.17.0"

# ── Application code ──────────────────────────────────────────────────────────
COPY . .

# ── Runtime directories ───────────────────────────────────────────────────────
# /data/jobs   — one subdirectory per job_id (audio, stems, waveforms)
# /data/models — audio-separator model checkpoints (mount as a volume to persist)
RUN mkdir -p /data/jobs /data/models

# ── Environment ───────────────────────────────────────────────────────────────
# These are defaults; override with --env-file or -e at runtime.
ENV DATA_DIR=/data/jobs \
    SEPARATOR_MODEL_DIR=/data/models \
    DATABASE_URL=sqlite:////data/jobs.db \
    MAX_UPLOAD_SIZE_GB=2 \
    STORAGE_BACKEND=local

EXPOSE 8000

# ── Dev vs production ─────────────────────────────────────────────────────────
# Development  (hot-reload):  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# Production   (multi-worker): uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
#
# Default CMD is production mode. For local dev, override via docker-compose or
# by passing the --reload flag explicitly.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
