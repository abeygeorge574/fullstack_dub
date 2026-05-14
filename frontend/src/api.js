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

export async function getWaveform(jobId, stem, samples = 1600) {
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

export async function confirmStems(jobId) {
  const t0 = Date.now();
  const url = `/jobs/${jobId}/confirm-stems`;
  const r = await fetch(url, { method: 'POST' });
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
