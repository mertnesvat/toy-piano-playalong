// Note-to-key mapping for a one-octave toy piano laid out C..C (13 keys, 8 white).

export interface ToyKey {
  semi: number; // semitones above the toy's low C
  black: boolean;
  shape?: 'circle' | 'heart' | 'triangle' | 'square' | 'star' | 'hexagon' | 'moon' | 'diamond';
  color?: string;
  name: string;
}

export const KEYS: ToyKey[] = [
  { semi: 0, black: false, shape: 'circle', color: '#e94fb0', name: 'pink circle' },
  { semi: 1, black: true, name: 'black key 1' },
  { semi: 2, black: false, shape: 'heart', color: '#e0262b', name: 'red heart' },
  { semi: 3, black: true, name: 'black key 2' },
  { semi: 4, black: false, shape: 'triangle', color: '#f08a12', name: 'orange triangle' },
  { semi: 5, black: false, shape: 'square', color: '#1f8a3a', name: 'green square' },
  { semi: 6, black: true, name: 'black key 3' },
  { semi: 7, black: false, shape: 'star', color: '#f5d000', name: 'yellow star' },
  { semi: 8, black: true, name: 'black key 4' },
  { semi: 9, black: false, shape: 'hexagon', color: '#1d5fd1', name: 'blue hexagon' },
  { semi: 10, black: true, name: 'black key 5' },
  { semi: 11, black: false, shape: 'moon', color: '#a44fd6', name: 'purple moon' },
  { semi: 12, black: false, shape: 'diamond', color: '#111111', name: 'black diamond' },
];

export const isBlack = (k: number) => KEYS[k].black;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/**
 * Global tuning offset of a recording in semitones, in [-0.5, 0.5).
 * Old 78rpm transfers are often a fraction of a semitone off concert pitch; rounding each
 * note on its own would then split one sung pitch across two keys. Circular mean of the
 * fractional parts, so offsets near +-0.5 don't cancel out.
 */
export function estimateTuning(midiFloats: number[]): number {
  if (!midiFloats.length) return 0;
  let s = 0, c = 0;
  for (const m of midiFloats) {
    const a = 2 * Math.PI * (m - Math.round(m));
    s += Math.sin(a);
    c += Math.cos(a);
  }
  const off = Math.atan2(s, c) / (2 * Math.PI);
  return off >= 0.5 ? off - 1 : off;
}

/** Snap a (possibly microtonal) pitch to the nearest semitone, after removing the tuning offset. */
export const roundToSemitone = (midi: number, tuning = 0) => Math.round(midi - tuning);

export interface MapOptions {
  whiteOnly?: boolean;
  /** Semitones added before mapping. 0 keeps every note's pitch class (in tune with the recording). */
  transpose?: number;
}

export interface MapResult {
  keys: number[]; // index into KEYS per note
  transpose: number;
  cost: number;
  wraps: number; // consecutive notes that moved > 6 keys on the toy but <= 6 semitones in the song (or vice versa direction flipped)
  snapped: number; // black-key notes moved to a white key
}

/** Candidate keys for one note: its pitch class (C can be low or high), or white neighbours in baby mode. */
function candidates(midi: number, whiteOnly: boolean): number[] {
  const pc = mod12(midi);
  const base = pc === 0 ? [0, 12] : [pc];
  if (!whiteOnly) return base;
  return base.flatMap((k) => (KEYS[k].black ? [k - 1, k + 1] : [k]));
}

/**
 * Map integer MIDI notes to toy keys. Pitch class is fixed (after `transpose`); the only free
 * choices are which C to use and, in white-only mode, which neighbour a black-key note snaps to.
 * A Viterbi pass picks the choices whose key-to-key moves best match the song's real intervals,
 * which places the octave fold where it causes the fewest big jumps.
 */
export function mapToToy(midis: number[], opts: MapOptions = {}): MapResult {
  const whiteOnly = !!opts.whiteOnly;
  const t = opts.transpose ?? 0;
  const n = midis.length;
  if (!n) return { keys: [], transpose: t, cost: 0, wraps: 0, snapped: 0 };
  const cands = midis.map((m) => candidates(m + t, whiteOnly));
  // snapping error vs the true pitch class counts too, so ties prefer the smoother path
  const own = (i: number, k: number) => Math.min(Math.abs(mod12(midis[i] + t) - k), Math.abs(mod12(midis[i] + t) + 12 - k));
  let cost = cands[0].map((k) => own(0, k));
  const back: number[][] = [cands[0].map(() => -1)];
  for (let i = 1; i < n; i++) {
    const d = midis[i] - midis[i - 1];
    const next: number[] = [];
    const bp: number[] = [];
    for (const k of cands[i]) {
      let best = Infinity, arg = 0;
      cands[i - 1].forEach((p, j) => {
        // small extra cost for repeating a key where the song moved, so snapping keeps the contour
        const c = cost[j] + Math.abs(k - p - d) + (k === p && d !== 0 ? 0.5 : 0);
        if (c < best) { best = c; arg = j; }
      });
      next.push(best + own(i, k));
      bp.push(arg);
    }
    cost = next;
    back.push(bp);
  }
  let j = cost.indexOf(Math.min(...cost));
  const total = cost[j];
  const keys = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    keys[i] = cands[i][j];
    j = back[i][j];
  }
  let wraps = 0, snapped = 0;
  for (let i = 0; i < n; i++) {
    if (whiteOnly && KEYS[mod12(midis[i] + t)].black) snapped++;
    if (i && Math.abs(keys[i] - keys[i - 1] - (midis[i] - midis[i - 1])) >= 7) wraps++;
  }
  return { keys, transpose: t, cost: total, wraps, snapped };
}

/** Try all 12 transpositions and keep the one that fits the toy best (ties prefer the smallest shift). */
export function bestFit(midis: number[], whiteOnly = false): MapResult {
  let best: MapResult | null = null;
  for (const t of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const r = mapToToy(midis, { whiteOnly, transpose: t });
    if (!best || r.cost < best.cost) best = r;
  }
  return best!;
}

/** Plain-words summary of what the mapping did. */
export function describe(midis: number[], r: MapResult, tuning: number): string[] {
  if (!midis.length) return ['No notes found.'];
  const out: string[] = [];
  const cents = Math.round(tuning * 100);
  if (Math.abs(cents) >= 5) {
    out.push(`The recording is ${Math.abs(cents)} cents ${cents > 0 ? 'sharp' : 'flat'} of concert pitch, so notes were rounded relative to its own tuning.`);
  }
  out.push('Every note was rounded to the nearest semitone (makam microtones are dropped).');
  if (r.transpose === 0) {
    out.push('Notes keep their real note names, so the keys sound in tune with the song if the toy is at concert pitch.');
  } else {
    const s = Math.abs(r.transpose);
    out.push(`Everything is shifted ${r.transpose > 0 ? 'up' : 'down'} ${s} semitone${s > 1 ? 's' : ''} to fit the toy better, so it will not match the recording's key.`);
  }
  const lo = Math.min(...midis), hi = Math.max(...midis);
  const span = hi - lo;
  out.push(`The tune spans ${noteName(lo)} to ${noteName(hi)} (${span} semitones); the toy has one octave (12).`);
  out.push(
    r.wraps
      ? `It was folded into the toy's octave: ${r.wraps} step${r.wraps > 1 ? 's' : ''} jump${r.wraps > 1 ? '' : 's'} across the keyboard where the song moves a short way.`
      : 'It fits without any jumps across the keyboard.',
  );
  if (r.snapped) out.push(`White keys only: ${r.snapped} black-key note${r.snapped > 1 ? 's were' : ' was'} moved to the nearest white key.`);
  return out;
}
