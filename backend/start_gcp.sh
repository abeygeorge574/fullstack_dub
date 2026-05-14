#!/usr/bin/env bash
# GCP Vertex AI Workbench startup. Reads config from .env (copy from env.example).
# Run from backend/: bash start_gcp.sh

set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: backend/.env not found. Copy env.example and fill in the values."
  exit 1
fi

mkdir -p data models

exec uvicorn main:app --host 0.0.0.0 --port 8000
