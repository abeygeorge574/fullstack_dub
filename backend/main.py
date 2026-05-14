import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from database import init_db
from pipeline.storage import get_storage
from routes.jobs import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("[startup] database initialized")
    yield
    logger.info("[shutdown] goodbye")


app = FastAPI(title="Postudio Dubbing API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "postudio-dub"}


@app.get("/files/{job_id}/{filename}")
async def serve_file(job_id: str, filename: str, request: Request):
    """Serve job files directly (used by LocalStorage.get_url)."""
    storage = get_storage()
    if not storage.exists(job_id, filename):
        return JSONResponse(status_code=404, content={"detail": f"{filename} not found"})
    path = storage.get_local_path(job_id, filename)
    media_type = "audio/wav" if filename.endswith(".wav") else "application/octet-stream"
    return FileResponse(path, media_type=media_type, headers={"Accept-Ranges": "bytes"})
