import json
import os
import re
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, BinaryIO, Optional

# Rejects: path separators, ".." traversal, hidden files (leading ".")
_UNSAFE_RE = re.compile(r'[/\\]|\.\.|^\.')


def _validate(name: str, label: str = "name") -> None:
    if not name or _UNSAFE_RE.search(name):
        raise ValueError(f"Unsafe {label}: {name!r}")


class StorageBackend(ABC):
    """Interface contract — both LocalStorage and S3Storage must implement every method."""

    # ── Write ─────────────────────────────────────────────────────────────────

    @abstractmethod
    def write_bytes(self, job_id: str, filename: str, data: bytes) -> None: ...

    @abstractmethod
    def write_json(self, job_id: str, filename: str, obj: Any) -> None: ...

    @abstractmethod
    def move_from_path(self, job_id: str, filename: str, src_path: str) -> None:
        """Move a local file into storage (atomic rename on same FS; copy+delete otherwise)."""
        ...

    # ── Read ──────────────────────────────────────────────────────────────────

    @abstractmethod
    def read_json(self, job_id: str, filename: str) -> Any: ...

    @abstractmethod
    def read_bytes(self, job_id: str, filename: str) -> bytes: ...

    @abstractmethod
    def open_stream(
        self,
        job_id: str,
        filename: str,
        start_byte: Optional[int] = None,
        end_byte: Optional[int] = None,
    ) -> BinaryIO:
        """Return a readable binary stream, seeked to start_byte if provided.

        The caller is responsible for reading exactly (end_byte - start_byte + 1)
        bytes when end_byte is set — the stream is not capped internally.
        For S3 this maps to a ranged GetObject; the same contract holds.
        """
        ...

    @abstractmethod
    def get_url(self, job_id: str, filename: str) -> str:
        """Return a URL the browser can fetch directly.

        LocalStorage  → /files/{job_id}/{filename}  (served by a FastAPI route)
        S3Storage     → pre-signed S3 URL            (browser fetches S3 directly,
                                                       bypassing the backend entirely)
        """
        ...

    # ── Metadata ──────────────────────────────────────────────────────────────

    @abstractmethod
    def get_local_path(self, job_id: str, filename: str) -> str:
        """Return a real filesystem path that external tools (ffmpeg, audio-separator) can use.

        LocalStorage  → the actual file path on disk
        S3Storage     → raises NotImplementedError (caller must download to a temp file first)
        """
        ...

    @abstractmethod
    def file_size(self, job_id: str, filename: str) -> int: ...

    @abstractmethod
    def exists(self, job_id: str, filename: str) -> bool: ...

    @abstractmethod
    def delete(self, job_id: str, filename: str) -> None: ...

    @abstractmethod
    def list_files(self, job_id: str) -> list[str]: ...


class LocalStorage(StorageBackend):
    """Local-disk storage. Job files live under {data_dir}/{job_id}/."""

    def __init__(self, data_dir: str) -> None:
        self._root = Path(data_dir)

    def _path(self, job_id: str, filename: str) -> Path:
        _validate(job_id, "job_id")
        _validate(filename, "filename")
        return self._root / job_id / filename

    def _ensure_dir(self, job_id: str) -> None:
        _validate(job_id, "job_id")
        (self._root / job_id).mkdir(parents=True, exist_ok=True)

    # ── Write ─────────────────────────────────────────────────────────────────

    def write_bytes(self, job_id: str, filename: str, data: bytes) -> None:
        self._ensure_dir(job_id)
        self._path(job_id, filename).write_bytes(data)

    def write_json(self, job_id: str, filename: str, obj: Any) -> None:
        self.write_bytes(job_id, filename, json.dumps(obj).encode())

    def move_from_path(self, job_id: str, filename: str, src_path: str) -> None:
        self._ensure_dir(job_id)
        shutil.move(src_path, self._path(job_id, filename))

    # ── Read ──────────────────────────────────────────────────────────────────

    def read_json(self, job_id: str, filename: str) -> Any:
        return json.loads(self._path(job_id, filename).read_bytes())

    def read_bytes(self, job_id: str, filename: str) -> bytes:
        return self._path(job_id, filename).read_bytes()

    def open_stream(
        self,
        job_id: str,
        filename: str,
        start_byte: Optional[int] = None,
        end_byte: Optional[int] = None,
    ) -> BinaryIO:
        f = open(self._path(job_id, filename), "rb")
        if start_byte is not None and start_byte > 0:
            f.seek(start_byte)
        return f

    def get_url(self, job_id: str, filename: str) -> str:
        _validate(job_id, "job_id")
        _validate(filename, "filename")
        return f"/files/{job_id}/{filename}"

    # ── Metadata ──────────────────────────────────────────────────────────────

    def get_local_path(self, job_id: str, filename: str) -> str:
        return str(self._path(job_id, filename))

    def file_size(self, job_id: str, filename: str) -> int:
        return self._path(job_id, filename).stat().st_size

    def exists(self, job_id: str, filename: str) -> bool:
        return self._path(job_id, filename).exists()

    def delete(self, job_id: str, filename: str) -> None:
        self._path(job_id, filename).unlink(missing_ok=True)

    def list_files(self, job_id: str) -> list[str]:
        _validate(job_id, "job_id")
        folder = self._root / job_id
        if not folder.exists():
            return []
        return [p.name for p in folder.iterdir() if p.is_file()]


class S3Storage(StorageBackend):
    """S3 storage stub — interface fully defined, boto3 calls not implemented yet.

    Reads S3_BUCKET from env at construction. AWS credentials come from the
    standard boto3 chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / instance role).
    boto3 is not in requirements.txt yet — add it when this stub is activated.
    """

    def __init__(self, bucket: str) -> None:
        self._bucket = bucket

    def _key(self, job_id: str, filename: str) -> str:
        _validate(job_id, "job_id")
        _validate(filename, "filename")
        return f"{job_id}/{filename}"

    def write_bytes(self, job_id: str, filename: str, data: bytes) -> None:
        raise NotImplementedError("S3Storage not yet implemented")

    def write_json(self, job_id: str, filename: str, obj: Any) -> None:
        raise NotImplementedError("S3Storage not yet implemented")

    def move_from_path(self, job_id: str, filename: str, src_path: str) -> None:
        raise NotImplementedError("S3Storage not yet implemented")

    def read_json(self, job_id: str, filename: str) -> Any:
        raise NotImplementedError("S3Storage not yet implemented")

    def read_bytes(self, job_id: str, filename: str) -> bytes:
        raise NotImplementedError("S3Storage not yet implemented")

    def open_stream(
        self,
        job_id: str,
        filename: str,
        start_byte: Optional[int] = None,
        end_byte: Optional[int] = None,
    ) -> BinaryIO:
        # Will become: s3.get_object(Bucket=..., Key=..., Range=f"bytes={start}-{end}")["Body"]
        raise NotImplementedError("S3Storage not yet implemented")

    def get_url(self, job_id: str, filename: str) -> str:
        # Will become: s3.generate_presigned_url("get_object", ..., ExpiresIn=3600)
        raise NotImplementedError("S3Storage not yet implemented")

    def get_local_path(self, job_id: str, filename: str) -> str:
        raise NotImplementedError("S3Storage: download to a temp file first, then use that path")

    def file_size(self, job_id: str, filename: str) -> int:
        # Will become: s3.head_object(Bucket=..., Key=...)["ContentLength"]
        raise NotImplementedError("S3Storage not yet implemented")

    def exists(self, job_id: str, filename: str) -> bool:
        raise NotImplementedError("S3Storage not yet implemented")

    def delete(self, job_id: str, filename: str) -> None:
        raise NotImplementedError("S3Storage not yet implemented")

    def list_files(self, job_id: str) -> list[str]:
        raise NotImplementedError("S3Storage not yet implemented")


# ── Factory ───────────────────────────────────────────────────────────────────

_instance: Optional[StorageBackend] = None


def get_storage() -> StorageBackend:
    """Lazy singleton — reads env vars once on first call, then returns the same instance.

    FastAPI dependency injection usage:

        from pipeline.storage import StorageBackend, get_storage
        from fastapi import Depends

        @router.get("/jobs/{job_id}/stems/audio/{stem}")
        async def stream_audio(
            job_id: str,
            stem: str,
            storage: StorageBackend = Depends(get_storage),
        ):
            size  = storage.file_size(job_id, f"{stem}.wav")
            stream = storage.open_stream(job_id, f"{stem}.wav", start_byte=0)
            ...

    The singleton means get_storage() is effectively free after the first call —
    no object allocation on every request.
    """
    global _instance
    if _instance is None:
        backend = os.getenv("STORAGE_BACKEND", "local")
        if backend == "s3":
            bucket = os.getenv("S3_BUCKET", "")
            if not bucket:
                raise RuntimeError("S3_BUCKET env var is required when STORAGE_BACKEND=s3")
            _instance = S3Storage(bucket)
        else:
            data_dir = os.getenv("DATA_DIR", "./data")
            _instance = LocalStorage(data_dir)
    return _instance
