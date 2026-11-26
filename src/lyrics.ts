// Lyrics: LRC parsing/formatting, word timing, and the LRCLIB lookup.

export interface Word { start: number; end: number; text: string }
export interface Line { start: number; end: number; text: string; words: Word[] }

const TIME = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/;

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** Spread a line's words over its time, proportional to their length (LRC only gives line times). */
export function spreadWords(text: string, start: number, end: number): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  let t = start;
  return parts.map((p) => {
    const d = ((end - start) * (p.length + 1)) / total;
    const w = { start: t, end: t + d, text: p };
    t += d;
    return w;
  });
}

/**
 * Parse LRC-style text ("[mm:ss.xx] words" per line). Lines without a time are spread evenly
 * between their timed neighbours (or across [songStart, songEnd]). Each line ends where the
 * next begins (capped at 8 s so instrumental breaks don't keep the last line lit).
 */
export function parseLrc(text: string, songStart = 0, songEnd = 0, keep: Line[] = []): Line[] {
  const raw = text.split(/\r?\n/).map((l) => {
    const m = l.match(TIME);
    return m ? { t: +m[1] * 60 + +m[2], text: m[3].trim() } : { t: null as number | null, text: l.trim() };
  }).filter((l) => l.text || l.t !== null);
  const meta = /^\[(ar|ti|al|by|offset|length|re|ve):/i;
  const rows = raw.filter((r) => !meta.test(r.text));
  // fill untimed rows by interpolating between known times
  const times = rows.map((r) => r.t);
  for (let i = 0; i < rows.length; i++) {
    if (times[i] !== null) continue;
    let j = i;
    while (j < rows.length && times[j] === null) j++;
    const a = i > 0 ? times[i - 1]! : songStart;
    const b = j < rows.length ? times[j]! : Math.max(songEnd, a + (j - i) * 3);
    for (let k = i; k < j; k++) times[k] = a + ((b - a) * (k - i + (i > 0 ? 1 : 0))) / (j - i + (i > 0 ? 1 : 0));
    i = j - 1;
  }
  const lines: Line[] = rows.map((r, i) => {
    const start = times[i]!;
    const next = i + 1 < rows.length ? times[i + 1]! : Math.max(songEnd, start + 4);
    const end = Math.min(next, start + 8);
    const old = keep.find((l) => Math.abs(l.start - start) < 0.01 && l.text === r.text);
    return { start, end, text: r.text, words: old ? old.words : spreadWords(r.text, start, end) };
  }).filter((l) => l.text);
  return lines.sort((a, b) => a.start - b.start);
}

export const toLrc = (lines: Line[]) => lines.map((l) => `[${fmtTime(l.start)}] ${l.text}`).join('\n');

/** Group timed words (e.g. from Whisper) into display lines at pauses or every ~8 words. */
export function wordsToLines(words: Word[]): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end > 0.8 || cur.length >= 8)) flush();
    cur.push({ ...w, text: w.text.trim() });
  }
  flush();
  return lines;
}

interface LrclibHit { trackName: string; artistName: string; syncedLyrics: string | null; plainLyrics: string | null; duration: number }

/** Look up synced lyrics on LRCLIB (free, no key). Only title/artist leave the machine, never audio. */
export async function fetchLrclib(title: string, artist: string, duration?: number): Promise<{ lrc: string; synced: boolean; source: string } | null> {
  const q = new URLSearchParams({ track_name: title });
  if (artist) q.set('artist_name', artist);
  const res = await fetch(`https://lrclib.net/api/search?${q}`);
  if (!res.ok) throw new Error(`LRCLIB ${res.status}: ${await res.text()}`);
  const hits = (await res.json()) as LrclibHit[];
  if (!Array.isArray(hits)) throw new Error(`LRCLIB returned unexpected data: ${JSON.stringify(hits).slice(0, 200)}`);
  const score = (h: LrclibHit) => (h.syncedLyrics ? 0 : 1000) + (duration ? Math.abs(h.duration - duration) : 0);
  const best = hits.filter((h) => h.syncedLyrics || h.plainLyrics).sort((a, b) => score(a) - score(b))[0];
  if (!best) return null;
  return { lrc: best.syncedLyrics ?? best.plainLyrics!, synced: !!best.syncedLyrics, source: `${best.artistName} – ${best.trackName} (LRCLIB)` };
}

/** Title from an open.spotify.com track link via oEmbed (no key, CORS-enabled). oEmbed gives no artist. */
export async function spotifyTitle(url: string): Promise<string> {
  const u = new URL(url.trim());
  if (u.hostname !== 'open.spotify.com' || !/\/track\//.test(u.pathname)) throw new Error('Paste an open.spotify.com/track/… link');
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(u.origin + u.pathname)}`);
  if (!res.ok) throw new Error(`Spotify oEmbed ${res.status}`);
  const j = await res.json();
  if (typeof j.title !== 'string') throw new Error(`Spotify oEmbed returned no title: ${JSON.stringify(j).slice(0, 200)}`);
  return j.title;
}
