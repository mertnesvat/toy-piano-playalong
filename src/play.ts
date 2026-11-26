// Play-along screen: notes scroll down toward the toy's keys while the song plays.
import { KEYS } from './mapping';
import type { Note } from './melody';
import type { Line } from './lyrics';
import { drawShape } from './shapes';

const WHITE = KEYS.filter((k) => !k.black).map((k) => k.semi);

/** Horizontal geometry of key `semi` on a toy drawn `w` px wide. */
function keyRect(semi: number, w: number) {
  const ww = w / WHITE.length;
  const wi = WHITE.indexOf(semi);
  if (wi >= 0) return { x: wi * ww, w: ww };
  const left = WHITE.indexOf(semi - 1);
  return { x: (left + 1) * ww - ww * 0.32, w: ww * 0.64 };
}

export interface PlayView {
  draw: (now: number) => void;
}

export function playView(canvas: HTMLCanvasElement, notes: Note[], keys: number[], lyricsEl: HTMLElement, lines: Line[]): PlayView {
  const g = canvas.getContext('2d')!;
  const secondsAhead = 3;
  let lastLine = -2, lastWord = -2;

  const renderLyrics = (now: number) => {
    let li = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].start <= now) li = i;
    const cur = li >= 0 && now < lines[li].end + 0.5 ? lines[li] : null;
    const wi = cur ? cur.words.findLastIndex((w) => w.start <= now) : -1;
    if (li === lastLine && wi === lastWord) return;
    lastLine = li; lastWord = wi;
    const next = lines[li + 1];
    lyricsEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'lyric-now';
    if (cur) cur.words.forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = w.text + ' ';
      if (i < wi) s.className = 'sung';
      if (i === wi) s.className = 'word-now';
      p.append(s);
    });
    else p.textContent = ' ';
    const q = document.createElement('p');
    q.className = 'lyric-next';
    q.textContent = next ? next.text : ' ';
    lyricsEl.append(p, q);
  };

  const draw = (now: number) => {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const keyH = Math.min(H * 0.32, 170), hitY = H - keyH;
    const pps = hitY / secondsAhead;
    // lane guides
    for (const k of KEYS) if (!k.black) {
      const r = keyRect(k.semi, W);
      g.fillStyle = WHITE.indexOf(k.semi) % 2 ? 'rgba(0,0,0,0.025)' : 'rgba(0,0,0,0)';
      g.fillRect(r.x, 0, r.w, hitY);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, hitY - 2, W, 2);
    const active = new Set<number>();
    notes.forEach((n, i) => {
      if (n.end < now - 0.3 || n.start > now + secondsAhead) return;
      const k = KEYS[keys[i]];
      const r = keyRect(k.semi, W);
      const y1 = hitY - (n.start - now) * pps, y0 = hitY - (n.end - now) * pps;
      const on = n.start <= now && now < n.end;
      if (on) active.add(k.semi);
      const pad = r.w * 0.12;
      g.globalAlpha = n.end < now ? 0.3 : 1;
      g.fillStyle = k.black ? '#3b3b44' : k.color!;
      g.beginPath();
      g.roundRect(r.x + pad, y0, r.w - 2 * pad, Math.max(y1 - y0, 6), 8);
      g.fill();
      if (!k.black) {
        const cy = Math.min(y1 - r.w * 0.3, hitY - 4);
        if (y1 - y0 > r.w * 0.5) drawShape(g, k.shape, r.x + r.w / 2, cy, r.w * 0.18, '#fff');
      }
      g.globalAlpha = 1;
    });
    // the toy
    for (const pass of [false, true]) for (const k of KEYS) {
      if (k.black !== pass) continue;
      const r = keyRect(k.semi, W);
      const on = active.has(k.semi);
      const h = k.black ? keyH * 0.58 : keyH;
      g.fillStyle = k.black ? (on ? '#6b6bff' : '#2a2a2e') : on ? '#fff6c7' : '#fbfbf8';
      g.strokeStyle = '#b9b9b0';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(r.x + 1.5, hitY, r.w - 3, h, [0, 0, 8, 8]);
      g.fill();
      g.stroke();
      if (!k.black) drawShape(g, k.shape, r.x + r.w / 2, hitY + keyH * 0.75, Math.min(r.w * 0.2, 22) * (on ? 1.25 : 1), k.color!);
    }
    renderLyrics(now);
  };
  return { draw };
}
