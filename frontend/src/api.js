function log(method, url, status, ms) {
  console.log(`[api] ${method} ${url} → ${status} (${ms}ms)`);
}

export async function uploadJob(file, { sourceLang, targetLang, fps }) {
  const t0 = Date.now();
  const form = new FormData();
  form.append('file', file);
  form.append('source_lang', sourceLang);
  form.append('target_lang', targetLang);
  form.append('fps', fps);
  const r = await fetch('/upload', { method: 'POST', body: form });
  log('POST', '/upload', r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getJob(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getWaveform(jobId, stem, samples = 4000) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/stems/waveform/${stem}?samples=${samples}`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function saveCorrections(jobId, corrections) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/corrections`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function saveFlags(jobId, flags) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/flags`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flags }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function renameTrack(jobId, stem, label) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/track/${stem}/rename`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function confirmStems(jobId, vocalWinner = 'voc') {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-stems`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vocal_winner: vocalWinner }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export function audioUrl(jobId, stem) {
  return `/jobs/${jobId}/stems/audio/${stem}`;
}

export function exportUrl(jobId, stem) {
  return `/jobs/${jobId}/stems/export/${stem}`;
}

export async function listJobs(limit = 10) {
  const t0 = Date.now();
  const url = `/jobs?limit=${limit}`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function reSeparate(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/re-separate`;
  const r = await fetch(url, { method: 'POST' });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Stage 2: Diarization ──────────────────────────────────────────────────────

export async function runDiarization(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/run-diarization`;
  const r = await fetch(url, { method: 'POST' });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getDiarization(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/diarization`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function confirmDiarization(jobId, speakers, segments) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-diarization`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speakers, segments }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Stage 3: Transcription ────────────────────────────────────────────────────

export async function runTranscription(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/run-transcription`;
  const r = await fetch(url, { method: 'POST' });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getTranscription(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/transcription`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function confirmTranscription(jobId, segments, speakers = []) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-transcription`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, speakers }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Stage 4: Translation ──────────────────────────────────────────────────────

export async function runTranslation(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/run-translation`;
  const r = await fetch(url, { method: 'POST' });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getTranslation(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/translation`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function confirmTranslation(jobId, segments, speakers = []) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-translation`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, speakers }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Stage 5: TTS ──────────────────────────────────────────────────────────────

export async function runTTS(jobId, speakerVoiceMap = {}) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/run-tts`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speaker_voice_map: speakerVoiceMap }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getTTS(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/tts`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export function ttsAudioUrl(jobId, segmentId) {
  return `/jobs/${jobId}/tts/audio/${segmentId}`;
}

export async function confirmTTS(jobId, segments, speakers = []) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-tts`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, speakers }),
  });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

// ── Stage 6: Lipsync ──────────────────────────────────────────────────────────

export async function runLipsync(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/run-lipsync`;
  const r = await fetch(url, { method: 'POST' });
  log('POST', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}

export async function getLipsync(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/lipsync`;
  const r = await fetch(url);
  log('GET', url, r.status, Date.now() - t0);
  if (!r.ok) throw new Error((await r.json()).detail ?? r.statusText);
  return r.json();
}
