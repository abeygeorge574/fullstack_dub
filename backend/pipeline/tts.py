"""Stage 5 — ElevenLabs voice cloning + TTS generation.

Requires:
  ELEVENLABS_API_KEY — place in .env

Voice cloning: creates an instant voice clone per speaker from the
vocal stem slices of that speaker's segments.

TTS generation: generates audio for each segment's translated text
using the speaker's assigned voice (cloned or preset).
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def _concat_speaker_audio(vocals_path: str, segments: list[dict], out_path: str) -> None:
    """Concatenate all segments for a speaker into one file for cloning."""
    if not segments:
        raise ValueError("No segments to concat")

    with tempfile.TemporaryDirectory() as tmp:
        clip_paths = []
        for i, seg in enumerate(segments):
            clip = os.path.join(tmp, f"clip_{i:04d}.wav")
            duration = seg["end"] - seg["start"]
            proc = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", str(seg["start"]),
                    "-t", str(duration),
                    "-i", vocals_path,
                    "-ar", "22050", "-ac", "1",
                    clip,
                ],
                capture_output=True,
            )
            if proc.returncode == 0:
                clip_paths.append(clip)

        if not clip_paths:
            raise RuntimeError("All segment extractions failed during voice clone prep")

        list_file = os.path.join(tmp, "list.txt")
        with open(list_file, "w") as f:
            for p in clip_paths:
                f.write(f"file '{p}'\n")

        proc = subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
             "-ar", "22050", "-ac", "1", out_path],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed: {proc.stderr.decode()[:300]}")


def clone_speaker_voice(job_id: str, speaker: dict, storage, segments_for_speaker: list[dict]) -> str:
    """Create an ElevenLabs instant voice clone. Returns voice_id."""
    from elevenlabs.client import ElevenLabs

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise EnvironmentError("ELEVENLABS_API_KEY not set")

    client = ElevenLabs(api_key=api_key)
    vocals_path = storage.get_local_path(job_id, "vocals_final.wav")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        concat_path = tf.name

    try:
        _concat_speaker_audio(vocals_path, segments_for_speaker, concat_path)
        with open(concat_path, "rb") as f:
            voice = client.voices.ivc.create(
                name=f"produb_{job_id[:8]}_{speaker['id']}_{speaker['name'].replace(' ', '_')}",
                files=[("file", (Path(concat_path).name, f, "audio/wav"))],
            )
        voice_id = voice.voice_id
        logger.info("[tts] job=%s speaker=%s cloned voice_id=%s", job_id, speaker["id"], voice_id)
        return voice_id
    finally:
        if os.path.exists(concat_path):
            os.unlink(concat_path)


def generate_segment_audio(job_id: str, seg: dict, voice_id: str, storage) -> str:
    """Generate TTS for one segment. Returns the output filename."""
    from elevenlabs.client import ElevenLabs
    from elevenlabs import VoiceSettings

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise EnvironmentError("ELEVENLABS_API_KEY not set")

    client = ElevenLabs(api_key=api_key)
    text = seg.get("tx") or seg.get("text") or ""
    if not text.strip():
        raise ValueError(f"Segment {seg['id']} has no text for TTS")

    audio_iter = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_multilingual_v2",
        voice_settings=VoiceSettings(stability=0.5, similarity_boost=0.75),
    )
    mp3_bytes = b"".join(audio_iter)

    filename = f"tts_{seg['id']}.wav"
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3f:
        mp3f.write(mp3_bytes)
        mp3_path = mp3f.name

    try:
        out_path = storage.get_local_path(job_id, filename)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", mp3_path, "-ar", "44100", "-ac", "1", out_path],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg WAV conversion failed: {proc.stderr.decode()[:300]}")
    finally:
        if os.path.exists(mp3_path):
            os.unlink(mp3_path)

    logger.info("[tts] job=%s seg=%s → %s", job_id, seg["id"], filename)
    return filename
