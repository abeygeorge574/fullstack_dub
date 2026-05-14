# Postudio Dubbing Pipeline — Stage 1 (Stem Separation Review)

Web-based editor for the Hindi-to-English video dubbing pipeline. Stage 1 separates vocals from instrumental audio, then lets editors review and correct bleed between the two stems.

## Stack

- **Backend**: FastAPI + Python 3.11, SQLite (SQLAlchemy), BS-RoFormer via `audio-separator`
- **Frontend**: React 18 + Vite
- **File storage**: Local disk at `./data/` (swappable to S3 via env)

## Setup

### Backend

```bash
cd backend
python -m venv ../venv
source ../venv/bin/activate
pip install -r requirements.txt         # CPU dev install
# On the Vertex AI workbench, override: pip install "audio-separator[gpu]>=0.17.0"
```

Create `backend/.env` (see `env.example`):
```
DATA_DIR=./data
DATABASE_URL=sqlite:///./jobs.db
SEPARATOR_MODEL_DIR=/data/models
```

Start the backend:
```bash
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

## End-to-end test (30s WAV on CPU)

1. Open `http://localhost:5173`
2. Drop a 30s WAV or MP4 onto the upload zone
3. Click **Start separation** — pipeline begins in background
4. Loading screen polls job status every 2s
5. After ~60s (on Mac CPU), editor opens with vocals + instrumental waveforms
6. Drag-select on either waveform → FAB appears → click **Move to** to reassign bleed
7. Press **F** or click **Flag** to mark a range for follow-up
8. Click **Mark as reviewed** → **Save & Continue** → **Continue to Diarization**

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload source file, start pipeline |
| `GET`  | `/jobs/{id}` | Poll job status and metadata |
| `GET`  | `/jobs/{id}/stems/audio/{stem}` | Range-aware WAV streaming |
| `GET`  | `/jobs/{id}/stems/waveform/{stem}` | 1600-sample amplitude data |
| `POST` | `/jobs/{id}/corrections` | Save corrections array |
| `POST` | `/jobs/{id}/flags` | Save flags array |
| `POST` | `/jobs/{id}/track/{stem}/rename` | Rename a track label |
| `POST` | `/jobs/{id}/confirm-stems` | Commit stage 1 |

## Known issues / dev notes

- Stem separation takes ~60s per 30s clip on Mac CPU (M-series). On the T4 GPU workbench RTF is ~0.5×.
- The BS-RoFormer checkpoint (~200 MB) downloads on first run to `SEPARATOR_MODEL_DIR`.
- S3 storage backend is stubbed — only `LocalStorage` is implemented.
- Stages 2–6 (Diarization → Lipsync) are not yet built.
