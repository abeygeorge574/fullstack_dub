function pad(n, w = 2) {
  return String(Math.max(0, Math.floor(n))).padStart(w, '0');
}

export function fmtTC(sec, fps = 24) {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total - Math.floor(total)) * fps);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function fmtTCshort(sec) {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${pad(m)}:${pad(s)}`;
}
