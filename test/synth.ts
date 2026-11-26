// Generated test audio: a sine-ish tone melody (never commit real recordings).
export function synth(melody: { midi: number; dur: number; rest?: number }[], sr: number): Float32Array {
  const total = melody.reduce((a, n) => a + n.dur + (n.rest ?? 0.05), 0) + 0.2;
  const x = new Float32Array(Math.ceil(total * sr));
  let i0 = Math.round(0.1 * sr);
  for (const n of melody) {
    const f = 440 * 2 ** ((n.midi - 69) / 12);
    const len = Math.round(n.dur * sr);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (0.01 * sr), (len - i) / (0.02 * sr));
      x[i0 + i] = 0.4 * env * (Math.sin((2 * Math.PI * f * i) / sr) + 0.3 * Math.sin((4 * Math.PI * f * i) / sr));
    }
    i0 += len + Math.round((n.rest ?? 0.05) * sr);
  }
  return x;
}
