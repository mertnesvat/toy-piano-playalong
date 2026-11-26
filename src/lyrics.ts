// Lyrics: LRC parsing/formatting, word timing, placing untimed lines, tap-to-sync, and the LRCLIB lookup.
import { vocalSpans, type Note, type Span } from './melody';

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

/** Where the singing is: sung spans, plus times where a sung phrase begins (to snap lines to). */
export interface VoiceMap { spans: Span[]; starts: number[] }

/**
 * Build the voice map from what the app has: Whisper's word times when a transcription exists,
 * else the melody (notes that wobble like a voice, split at rests), else the whole song.
 */
export function voiceMap(notes: Note[], duration: number, whisper: Word[] = []): VoiceMap {
  if (whisper.length) {
    const spans = wordsToLines(whisper).map(({ start, end }) => ({ start, end }));
    return { spans, starts: spans.map((s) => s.start) };
  }
  let spans = vocalSpans(notes);
  if (!spans.length) spans = vocalSpans(notes.map(({ start, end, midi }) => ({ start, end, midi }))); // no wobble info: every note counts
  if (!spans.length) return { spans: [{ start: 0, end: duration }], starts: [] };
  // a phrase starts at a note that follows a rest of 0.25 s or more, inside a sung span
  const starts = spans.map((s) => s.start);
  notes.forEach((n, i) => {
    if (i && n.start - notes[i - 1].end >= 0.25 && spans.some((s) => n.start > s.start && n.start < s.end)) starts.push(n.start);
  });
  return { spans, starts: starts.sort((a, b) => a - b) };
}

/**
 * Start times for untimed lines. Each line's share of the sung time is proportional to its length
 * (instrumental parts get none). A small DP then puts the lines, in order, on the phrase starts
 * closest to those shares; a line with no phrase start within about a second keeps its share's time.
 */
export function placeLines(texts: string[], { spans, starts }: VoiceMap): number[] {
  const total = spans.reduce((a, s) => a + s.end - s.start, 0);
  if (!spans.length || total <= 0) return texts.map(() => spans[0]?.start ?? 0);
  const weight = texts.map((t) => t.length + 4); // +4: even a one-word line takes a moment to sing
  const W = weight.reduce((a, b) => a + b, 0);
  const target = weight.map((_, i) => (total * weight.slice(0, i).reduce((a, b) => a + b, 0)) / W); // sung seconds before line i
  const sungAt = (t: number) => spans.reduce((a, s) => a + Math.min(Math.max(t - s.start, 0), s.end - s.start), 0);
  const timeAt = (sung: number) => {
    for (const s of spans) {
      if (sung < s.end - s.start) return s.start + sung;
      sung -= s.end - s.start;
    }
    return spans[spans.length - 1].end;
  };
  // candidates: phrase starts, plus each line's own proportional time at a small penalty (used when no phrase start is near)
  const phrase = [...new Set([spans[0].start, ...starts])].filter((c) => c >= spans[0].start && c < spans[spans.length - 1].end);
  const C = [...phrase.map((t) => ({ t, at: sungAt(t), pen: 0 })), ...target.map((x) => ({ t: timeAt(x), at: x, pen: 1 }))].sort((a, b) => a.t - b.t || a.pen - b.pen);
  const n = texts.length, m = C.length;
  const step = (i: number, j: number) => Math.abs(C[j].at - target[i]) + C[j].pen;
  // cost[j]: best total for lines 0..i with line i on C[j] (strictly increasing times)
  let cost = C.map((_, j) => step(0, j));
  const back: number[][] = [];
  for (let i = 1; i < n; i++) {
    const next = new Array<number>(m).fill(Infinity), bp = new Array<number>(m).fill(-1);
    let bestK = -1;
    for (let j = 0; j < m; j++) {
      // best earlier candidate at least 0.5 s before this one
      for (let k = bestK + 1; k < j && C[k].t <= C[j].t - 0.5; k++) if (bestK < 0 || cost[k] < cost[bestK]) bestK = k;
      if (bestK >= 0 && C[bestK].t <= C[j].t - 0.5) { next[j] = cost[bestK] + step(i, j); bp[j] = bestK; }
    }
    back.push(bp);
    cost = next;
  }
  let j = cost.indexOf(Math.min(...cost));
  if (!Number.isFinite(cost[j])) return target.map(timeAt); // too many lines for the time: plain proportional
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = C[j].t; if (i) j = back[i - 1][j]; }
  return out;
}

/** Line ends: the next line's start, capped at 8 s so an instrumental break doesn't keep a line lit. */
const withEnd = (start: number, next: number | undefined) => Math.min(next ?? start + 4, start + 8);

/**
 * Parse LRC-style text ("[mm:ss.xx] words" per line). Times are used exactly as given (after a
 * [offset:] tag, if any); a line may carry several times. Lines without a time are placed over the
 * sung parts of the song between their timed neighbours (see placeLines).
 */
export function parseLrc(text: string, voice: VoiceMap, keep: Line[] = []): Line[] {
  const off = +(text.match(/^\[offset:\s*([+-]?\d+)\]/im)?.[1] ?? 0) / 1000; // LRC: positive offset = lyrics earlier
  const rows: { t: number | null; text: string }[] = [];
  for (const l of text.split(/\r?\n/)) {
    let rest = l.trim(), m: RegExpMatchArray | null;
    const ts: number[] = [];
    while ((m = rest.match(TIME))) { ts.push(+m[1] * 60 + +m[2] - off); rest = m[3].trim(); }
    if (/^\[[a-z]+:.*\]$/i.test(rest)) continue; // [ar:], [ti:], [offset:] … metadata
    if (ts.length) ts.forEach((t) => rows.push({ t, text: rest }));
    else if (rest) rows.push({ t: null, text: rest });
  }
  if (rows.some((r) => r.t !== null)) {
    // a line with several times appears several times; keep timed rows in order
    const timed = rows.filter((r) => r.t !== null).sort((a, b) => a.t! - b.t!);
    let k = 0;
    rows.forEach((r, i) => { if (r.t !== null) rows[i] = timed[k++]; });
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].t !== null) continue;
    let j = i;
    while (j < rows.length && rows[j].t === null) j++;
    const a = i > 0 ? rows[i - 1].t! : -Infinity, b = j < rows.length ? rows[j].t! : Infinity;
    const spans = voice.spans.map((s) => ({ start: Math.max(s.start, a), end: Math.min(s.end, b) })).filter((s) => s.end > s.start);
    // the timed line before this run is sung in the same window, so it takes its share first
    const texts = [...(i > 0 ? [rows[i - 1].text] : []), ...rows.slice(i, j).map((r) => r.text)];
    const starts = placeLines(texts, { spans: spans.length ? spans : [{ start: Number.isFinite(a) ? a : 0, end: Number.isFinite(b) ? b : (Number.isFinite(a) ? a : 0) + 3 * texts.length }], starts: voice.starts.filter((t) => t > a && t < b) }).slice(i > 0 ? 1 : 0);
    starts.forEach((t, k) => (rows[i + k].t = t));
    i = j - 1;
  }
  return rows.flatMap((r, i) => {
    if (!r.text) return []; // a timed empty row only ends the line before it
    const start = r.t!, end = withEnd(start, rows[i + 1]?.t ?? undefined);
    const old = keep.find((l) => Math.abs(l.start - start) < 0.01 && l.text === r.text);
    return [{ start, end, text: r.text, words: old ? old.words : spreadWords(r.text, start, end) }];
  });
}

/**
 * Tap-to-sync: line i starts at t. Every later line moves by the same amount, keeping its timing
 * relative to the tapped one (so one tap on line 1 also fixes a whole LRCLIB file that is offset).
 */
export function tapLine(lines: Line[], i: number, t: number): Line[] {
  if (i > 0) t = Math.max(t, lines[i - 1].start + 0.1); // a tap can't jump before the line it follows
  const d = t - lines[i].start;
  const out = lines.map((l, k) => (k < i ? { ...l } : { ...l, start: l.start + d, words: l.words.map((w) => ({ ...w, start: w.start + d, end: w.end + d })) }));
  out.forEach((l, k) => (l.end = withEnd(l.start, out[k + 1]?.start)));
  const p = out[i - 1];
  if (p && p.words.some((w) => w.start >= p.end)) p.words = spreadWords(p.text, p.start, p.end); // its words ran past the new end
  return out;
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

/**
 * Remove common Whisper failure modes on music: a word or short phrase looping 3+ times ("ah ah ah …"), subtitle-credit
 * hallucinations learned from Turkish subtitles, and timestamps past the end of the audio.
 */
export function cleanWhisperWords(words: Word[], duration: number): Word[] {
  const junk = /^(altyazı|abone|izlediğiniz|teşekkürler)/i;
  const kept = words.filter((w) => w.start < duration);
  const norm = (w: Word) => w.text.toLowerCase().replace(/[^\p{L}]/gu, '');
  const out: Word[] = [];
  // a phrase of 1-4 words repeated 3+ times in a row is a decoding loop, not lyrics
  next: for (let i = 0; i < kept.length; ) {
    for (let n = 1; n <= 4; n++) {
      let reps = 1;
      const same = (a: number, b: number) => { for (let k = 0; k < n; k++) if (b + k >= kept.length || norm(kept[a + k]) !== norm(kept[b + k])) return false; return true; };
      while (same(i, i + reps * n)) reps++;
      if (reps >= 3) { i += reps * n; continue next; }
    }
    out.push(kept[i++]);
  }
  // drop a hallucinated credit and the rest of its line (e.g. "Altyazı M.K.")
  const bad = out.findIndex((w) => junk.test(w.text));
  return bad >= 0 ? out.filter((w, k) => k < bad || w.start - out[bad].start > 3) : out;
}
