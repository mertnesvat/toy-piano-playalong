// Melody post-processing: turn pitch frames or polyphonic notes into one singable line of notes.
import { estimateTuning, roundToSemitone } from './mapping';
import type { Frame } from './pitch';

export interface Note {
  start: number; // seconds
  end: number;
  midi: number; // integer MIDI pitch, after tuning correction and rounding
  wobble?: number; // pitch spread in semitones (vibrato/glides); high for a voice, ~0 for keyboard-like instruments
}

export interface PolyNote {
  start: number;
  end: number;
  midi: number;
  amp: number; // 0..1 salience
  wobble?: number;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

/**
 * Frames (fractional pitch per hop) -> notes. Estimates the recording's tuning offset, rounds each
 * frame to a semitone, smooths vibrato/ornament flicker with a median filter, then groups runs.
 */
export function framesToNotes(
  frames: Frame[],
  { minDur = 0.09, maxGap = 0.06, smooth = 5, minConf = 0.5, tuning }: { minDur?: number; maxGap?: number; smooth?: number; minConf?: number; tuning?: number } = {},
): { notes: Note[]; tuning: number } {
  const voiced = frames.map((f) => (f.midi !== null && f.conf >= minConf ? f.midi : null));
  const tune = tuning ?? estimateTuning(voiced.filter((m): m is number => m !== null));
  let rounded = voiced.map((m) => (m === null ? null : roundToSemitone(m, tune)));
  // median filter over voiced neighbours removes 1-2 frame blips (ornaments, octave errors)
  const h = smooth >> 1;
  rounded = rounded.map((m, i) => {
    if (m === null) return null;
    const win: number[] = [];
    for (let j = Math.max(0, i - h); j <= Math.min(rounded.length - 1, i + h); j++) if (rounded[j] !== null) win.push(rounded[j]!);
    return median(win);
  });
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.01;
  const notes: (Note & { onset?: boolean })[] = [];
  const raw = new Map<Note, number[]>(); // unrounded pitches per note, for wobble when frames don't carry it (YIN)
  rounded.forEach((m, i) => {
    const t = frames[i].t;
    const last = notes[notes.length - 1];
    if (m === null) return;
    const w = frames[i].wobble;
    if (last && last.midi === m && !frames[i].onset && t - hop / 2 - last.end < 1e-9) {
      last.end = t + hop / 2;
      if (w !== undefined) last.wobble = Math.max(last.wobble ?? 0, w);
      else raw.get(last)?.push(voiced[i]!);
    } else {
      notes.push({ start: t - hop / 2, end: t + hop / 2, midi: m, onset: frames[i].onset, wobble: w });
      if (w === undefined) raw.set(notes[notes.length - 1], [voiced[i]!]);
    }
  });
  raw.forEach((ms, n) => {
    if (ms.length < 5) return;
    ms.sort((a, b) => a - b);
    n.wobble = ms[Math.floor(ms.length * 0.9)] - ms[Math.floor(ms.length * 0.1)];
  });
  return {
    notes: cleanNotes(notes, { minDur, maxGap }).map(({ start, end, midi, wobble }) => (wobble === undefined ? { start, end, midi } : { start, end, midi, wobble })),
    tuning: tune,
  };
}

/**
 * Merge same-pitch pieces split by tiny gaps, drop blips shorter than minDur, then re-join a note
 * that a dropped blip interrupted. A piece flagged as an onset is a re-struck note and never merges.
 */
export function cleanNotes(notes: (Note & { onset?: boolean })[], { minDur = 0.09, maxGap = 0.06 } = {}): (Note & { onset?: boolean })[] {
  const joins = (p: Note | undefined, n: Note & { onset?: boolean }, gap: number) => p && p.midi === n.midi && !n.onset && n.start - p.end <= gap;
  const merged: (Note & { onset?: boolean })[] = [];
  for (const n of notes) {
    const p = merged[merged.length - 1];
    if (joins(p, n, maxGap)) { p.end = Math.max(p.end, n.end); if (n.wobble !== undefined) p.wobble = Math.max(p.wobble ?? 0, n.wobble); }
    else merged.push({ ...n });
  }
  const out: typeof merged = [];
  let dropped = false;
  for (const n of merged) {
    if (n.end - n.start < minDur) { dropped = true; continue; }
    const p = out[out.length - 1];
    if (dropped && joins(p, n, maxGap + 2 * minDur)) { p.end = n.end; if (n.wobble !== undefined) p.wobble = Math.max(p.wobble ?? 0, n.wobble); }
    else out.push(n);
    dropped = false;
  }
  return out;
}

/**
 * The singer's register: the loudness-weighted median pitch of the notes that wobble like a voice
 * (same relative threshold as vocalSpans), or of all notes when nothing does (e.g. synth tones).
 */
export function voiceRegister(poly: PolyNote[], { factor = 0.8, minWobble = 0.12 } = {}) {
  const ws = poly.map((n) => n.wobble).filter((w): w is number => w !== undefined).sort((a, b) => a - b);
  const thr = ws.length ? Math.max(minWobble, factor * ws[Math.floor(ws.length * 0.75)]) : Infinity;
  const sung = (n: PolyNote) => (n.wobble ?? 0) >= thr;
  const pool = poly.some(sung) ? poly.filter(sung) : poly;
  const byPitch = pool.map((n) => ({ m: n.midi, w: n.amp * (n.end - n.start) })).sort((a, b) => a.m - b.m);
  let half = byPitch.reduce((a, x) => a + x.w, 0) / 2, center = byPitch[0]?.m ?? 60;
  for (const x of byPitch) { if ((half -= x.w) <= 0) { center = x.m; break; } }
  return { center, sung };
}

/**
 * Polyphonic notes (e.g. Basic Pitch) -> the most salient single line.
 * Per 10 ms frame, a Viterbi pass picks one active note (or silence), scoring loudness, closeness
 * to the singer's register and whether the note wobbles like a voice, and penalising leaps. This
 * keeps the voice over bass lines, chords and oud/kanun/violin ornaments, rather than the top note.
 */
export function pickMelodyLine(
  poly: PolyNote[],
  { hop = 0.01, leapCost = 0.035, silence = 0.05, width = 8, voiceBonus = 0.5 } = {},
): Frame[] {
  if (!poly.length) return [];
  const T = Math.ceil(Math.max(...poly.map((n) => n.end)) / hop);
  const order = poly.map((_, i) => i).sort((a, b) => poly[a].start - poly[b].start);
  const { center, sung } = voiceRegister(poly);
  // full weight within `width` semitones of the singer's register, fading fast beyond (bass lines, high fills)
  const emit = (n: PolyNote) => {
    const d = Math.max(0, Math.abs(n.midi - center) - width);
    return n.amp * Math.exp(-(d * d) / 8) * (sung(n) ? 1 + voiceBonus : 1);
  };
  // state -1 = silence, otherwise index into poly
  type S = { id: number; score: number; node: number };
  const nodes: { id: number; prev: number }[] = [];
  let prev: S[] = [];
  let active: number[] = [];
  let si = 0;
  for (let f = 0; f < T; f++) {
    const t = (f + 0.5) * hop;
    while (si < order.length && poly[order[si]].start <= t) active.push(order[si++]);
    active = active.filter((i) => poly[i].end >= t);
    const cur: S[] = [];
    for (const id of [-1, ...active]) {
      let best = 0, bestNode = -1;
      if (prev.length) {
        best = -Infinity;
        for (const p of prev) {
          const leap = id >= 0 && p.id >= 0 ? leapCost * Math.abs(poly[id].midi - poly[p.id].midi) : 0;
          if (p.score - leap > best) { best = p.score - leap; bestNode = p.node; }
        }
      }
      nodes.push({ id, prev: bestNode });
      cur.push({ id, score: best + (id < 0 ? silence : emit(poly[id])), node: nodes.length - 1 });
    }
    prev = cur;
  }
  const ids = new Array<number>(T);
  let node = prev.reduce((a, b) => (b.score > a.score ? b : a)).node;
  for (let f = T - 1; f >= 0; f--) {
    ids[f] = nodes[node].id;
    node = nodes[node].prev;
  }
  return ids.map((id, f) => {
    const t = (f + 0.5) * hop;
    // onset: switching to a note that has just started (a re-struck note), not returning to a held one
    const onset = id >= 0 && ids[f - 1] !== id && t - poly[id].start < 2 * hop;
    return { t, midi: id < 0 ? null : poly[id].midi, conf: id < 0 ? 0 : 1, onset, wobble: id < 0 ? undefined : poly[id].wobble };
  });
}

export interface Span { start: number; end: number }

/**
 * Where the voice is singing, from note wobble alone: sung notes bend (vibrato, glides) while most
 * accompaniment holds pitch. The threshold is relative to the song, because old recordings carry
 * violin/clarinet vibrato too. Notes without wobble data (YIN) count as sung.
 * shortcut: a heuristic, weak when the accompaniment wobbles as much as the singer; tap-to-sync is the fix.
 */
export function vocalSpans(notes: Note[], { factor = 0.8, minWobble = 0.12, join = 1.2, minVoiced = 1.0 } = {}): Span[] {
  const ws = notes.map((n) => n.wobble).filter((w): w is number => w !== undefined).sort((a, b) => a - b);
  const thr = ws.length ? Math.max(minWobble, factor * ws[Math.floor(ws.length * 0.75)]) : -1;
  const spans: (Span & { voiced: number })[] = [];
  for (const n of notes) {
    if ((n.wobble ?? Infinity) < thr) continue;
    const last = spans[spans.length - 1];
    if (last && n.start - last.end <= join) { last.end = Math.max(last.end, n.end); last.voiced += n.end - n.start; }
    else spans.push({ start: n.start, end: n.end, voiced: n.end - n.start });
  }
  return spans.filter((s) => s.voiced >= minVoiced).map(({ start, end }) => ({ start, end }));
}

/**
 * Clean up a picked line. Each note is first moved by whole octaves into ±`band` semitones of the
 * singer's register `center` (octave errors and bass/treble doublings keep their note name, so the
 * toy key is unchanged except for C); then a note still more than `keep` semitones from the line's
 * local median (within ±`window` s) is moved an octave toward it, or dropped if that doesn't fit;
 * finally a note is moved an octave when that brings it closer to both its neighbours.
 */
export function tidyLine(notes: Note[], center: number, { band = 9, window = 4, keep = 7 } = {}): Note[] {
  const folded = notes.map((n) => {
    let midi = n.midi;
    while (midi < center - band) midi += 12;
    while (midi >= center + band) midi -= 12;
    return midi < center - band ? n : { ...n, midi }; // a band narrower than an octave can't hold it: leave as is
  });
  const med = (t: number, self: Note) => {
    const near = folded.filter((n) => n !== self && n.end > t - window && n.start < t + window).flatMap((n) => Array(Math.max(1, Math.round((n.end - n.start) * 20))).fill(n.midi));
    return near.length ? median(near) : self.midi;
  };
  const out: Note[] = [];
  for (const n of folded) {
    const m = med((n.start + n.end) / 2, n);
    if (Math.abs(n.midi - m) <= keep) { out.push(n); continue; }
    const midi = n.midi + 12 * Math.round((m - n.midi) / 12);
    if (Math.abs(midi - m) <= keep) out.push({ ...n, midi });
  }
  // a note an octave away from both neighbours (a flipped octave, e.g. Db4 Db5 Ab4) moves to the octave between them
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1].midi, b = out[i + 1].midi, cost = (x: number) => Math.abs(x - a) + Math.abs(x - b);
    for (const x of [out[i].midi - 12, out[i].midi + 12]) if (cost(x) < cost(out[i].midi) && Math.abs(x - center) < band) out[i] = { ...out[i], midi: x };
  }
  return out; // no re-merge: repeated notes ("C C G G") must stay separate
}
