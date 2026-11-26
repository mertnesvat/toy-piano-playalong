// Monophonic pitch tracker (YIN, de Cheveigné & Kawahara 2002). Pure, runs in a worker.

export interface Frame {
  t: number; // seconds
  midi: number | null; // fractional MIDI pitch, null when unvoiced
  conf: number; // 0..1
  onset?: boolean; // a new note starts here (known for Basic Pitch notes, not for YIN)
  wobble?: number; // pitch spread of the note this frame belongs to (Basic Pitch only)
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function yin(
  x: Float32Array,
  sr: number,
  { hop = 0.01, win = 0.046, fmin = 80, fmax = 1000, threshold = 0.15, minRms = 0.01 } = {},
): Frame[] {
  const W = Math.round(win * sr);
  const H = Math.round(hop * sr);
  const tauMin = Math.floor(sr / fmax);
  const tauMax = Math.min(Math.ceil(sr / fmin), W - 1);
  const d = new Float32Array(tauMax + 1);
  const frames: Frame[] = [];
  for (let start = 0; start + W + tauMax < x.length; start += H) {
    const t = (start + W / 2) / sr;
    let e = 0;
    for (let i = 0; i < W; i++) e += x[start + i] * x[start + i];
    if (Math.sqrt(e / W) < minRms) { frames.push({ t, midi: null, conf: 0 }); continue; }
    // difference function + cumulative mean normalisation
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const v = x[start + i] - x[start + i + tau];
        s += v * v;
      }
      run += s;
      d[tau] = run ? (s * tau) / run : 1;
    }
    let tau = -1;
    for (let k = tauMin; k <= tauMax; k++) {
      if (d[k] < threshold) {
        while (k + 1 <= tauMax && d[k + 1] < d[k]) k++;
        tau = k;
        break;
      }
    }
    if (tau < 0) { frames.push({ t, midi: null, conf: 0 }); continue; }
    // parabolic interpolation for sub-sample period
    const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
    const den = a - 2 * b + c;
    const p = tau + (den ? (a - c) / (2 * den) : 0);
    frames.push({ t, midi: hzToMidi(sr / p), conf: 1 - b });
  }
  return frames;
}
