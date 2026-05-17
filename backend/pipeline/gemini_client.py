"""Shared Vertex AI / Gemini client.

Auth: set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account
JSON in .env. google-auth picks it up automatically.

Required env vars:
  GOOGLE_APPLICATION_CREDENTIALS  — path to service-account JSON
  GOOGLE_CLOUD_PROJECT             — GCP project ID (e.g. psio-dev-ai-27)

Optional env vars:
  GOOGLE_CLOUD_LOCATION  — Vertex AI region (default: us-central1)
  GEMINI_MODEL           — model name (default: gemini-1.5-pro-002)
"""

import logging
import os

logger = logging.getLogger(__name__)

_INITIALIZED = False


def _init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return

    import vertexai

    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    if not project:
        raise EnvironmentError(
            "GOOGLE_CLOUD_PROJECT is not set. Add it to your .env file.\n"
            "Example: GOOGLE_CLOUD_PROJECT=psio-dev-ai-27"
        )

    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path and not os.path.exists(creds_path):
        raise FileNotFoundError(
            f"GOOGLE_APPLICATION_CREDENTIALS points to a missing file: {creds_path}"
        )

    vertexai.init(project=project, location=location)
    logger.info("[gemini] Vertex AI ready — project=%s location=%s", project, location)
    _INITIALIZED = True


def get_model(model_name: str | None = None):
    """Return a configured GenerativeModel, initialising Vertex AI if needed."""
    _init()
    from vertexai.generative_models import GenerativeModel

    name = model_name or os.getenv("GEMINI_MODEL", "gemini-1.5-pro-002")
    logger.debug("[gemini] loading model %s", name)
    return GenerativeModel(name)
