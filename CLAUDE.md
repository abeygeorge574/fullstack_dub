# Postudio Dubbing Pipeline — Prototype

## What this is
A web-based editor for the Postudio Hindi-to-English video dubbing pipeline.
Editor walks users through six sequential stages, each with editing
affordances. This is a prototype that will eventually be productionized by
the Postudio team and integrated into their existing dashboard alongside
their ProDub product.

## The six stages
1. Stem separation review — fix audio bleed between vocals and instrumental tracks
2. Diarization correction — assign segments to named characters
3. Transcription — Gemini ASR of vocals
4. Script & translation editing — duration-aware translation per segment
5. TTS generation — ElevenLabs voice clone per character, generate dubbed audio per segment
6. Lipsync — ElevenLabs lipsync on final video

## Architecture
- Backend: FastAPI on Python 3.11, running on a GCP Vertex AI Workbench VM (Linux, x86, T4 GPU)
- Frontend: React + Vite, eventually hosted on Vercel
- Database: SQLite for prototype (single file, jobs.db). Will migrate to Postgres in production.
- File storage: Local disk under /data/jobs/{job_id}/ for prototype. Will migrate to S3 in production.
- Storage abstraction: All file reads/writes go through backend/pipeline/storage.py so the backend (local disk vs S3) can be swapped via config.
- Async jobs: For prototype, synchronous FastAPI handlers are fine. No queue yet.

## Production-readiness rules (bake these in from day one)
- Use SQLAlchemy ORM, not raw sqlite3, so DB engine is swappable.
- Use environment variables (via python-dotenv) for all config: model paths, API keys, storage backend, DB URL.
- Every API endpoint is idempotent — safe to call twice with the same inputs.
- Every endpoint accepts an optional user_id and team_id parameter (currently unused, will be wired to auth later).
- Pipeline logic lives in backend/pipeline/ as plain modules that don't import FastAPI. The FastAPI layer (backend/main.py and backend/routes/) is a thin wrapper around them. This means the same pipeline modules can later be called from Celery workers without refactoring.
- requirements.txt and Dockerfile required.
- Max upload size: 2 GB. Enforced in main.py via middleware (MAX_UPLOAD_SIZE_GB env var). File uploads must use chunked streaming reads — never load the full file into memory (use FastAPI UploadFile with 1 MB read chunks).
- Stage confirm endpoints follow the pattern POST /jobs/{job_id}/confirm-{stage-name} (e.g. confirm-stems, confirm-diarization, …) so all six stages are consistent.

## External services
- Gemini (Vertex AI) — transcription and translation. Existing code provided in project files.
- ElevenLabs — instant voice cloning, TTS, lipsync. API key in env var ELEVENLABS_API_KEY.
- Demucs — stem separation (open source, runs on GPU).
- Diarization model — TBD, research is ongoing. For prototype, use a placeholder that returns segments at fixed intervals; will swap in real model later.

## Current implementation status
- Claude Design: Stage 1 (stem separation) UI complete. Handoff bundle in tts_claudedesign/.
- Backend: Step 1 done (requirements.txt, Dockerfile, env.example).
- Frontend: not started.

## Reference files in project
- I'll give them to you as and when we proceed.