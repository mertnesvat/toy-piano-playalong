// Generated test audio: a sine-ish tone melody (never commit real recordings).
// `vibrato` (semitones) makes a note wobble at 5.5 Hz like a singing voice; without it the tone is steady like a bell.
export function synth(melody: { midi: number; dur: number; rest?: number; vibrato?: number }[], sr: number): Float32Array {
  const total = melody.reduce((a, n) => a + n.dur + (n.rest ?? 0.05), 0) + 0.2;
  const x = new Float32Array(Math.ceil(total * sr));
  let i0 = Math.round(0.1 * sr);
  for (const n of melody) {
    const len = Math.round(n.dur * sr);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const f = 440 * 2 ** ((n.midi + (n.vibrato ?? 0) * Math.sin((2 * Math.PI * 5.5 * i) / sr) - 69) / 12);
      phase += (2 * Math.PI * f) / sr;
      const env = Math.min(1, i / (0.01 * sr), (len - i) / (0.02 * sr));
      x[i0 + i] = 0.4 * env * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
    }
    i0 += len + Math.round((n.rest ?? 0.05) * sr);
  }
  return x;
}

/** Start time of each note as synth() lays them out. */
export const noteStarts = (melody: { dur: number; rest?: number }[]) => {
  let t = 0.1;
  return melody.map((n) => { const s = t; t += n.dur + (n.rest ?? 0.05); return s; });
};
