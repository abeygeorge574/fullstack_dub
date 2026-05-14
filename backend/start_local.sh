#!/usr/bin/env bash
# Local Mac dev startup. No .env file needed.
# Run from backend/: bash start_local.sh

set -e
cd "$(dirname "$0")"

mkdir -p data models

export STORAGE_BACKEND=local
export DATA_DIR=./data
export SEPARATOR_MODEL_DIR=./models
export DATABASE_URL=sqlite:///./jobs.db
export MAX_UPLOAD_SIZE_GB=2

exec uvicorn main:app --reload --port 8000
