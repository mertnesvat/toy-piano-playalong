// Melody extraction off the main thread. Basic Pitch (TF.js) for full mixes, YIN for a single voice.
import { framesToNotes, pickMelodyLine, type PolyNote } from '../melody';
import { yin } from '../pitch';

export type MelodyRequest =
  | { kind: 'basic-pitch'; audio: Float32Array; modelUrl: string } // 22050 Hz mono
  | { kind: 'yin'; audio: Float32Array; sr: number };

// tfjs 3 webgl tests `!window` (a ReferenceError in workers); undefined sends it down the plain setTimeout path
(globalThis as Record<string, unknown>).window = undefined;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<MelodyRequest>) => {
  try {
    const req = e.data;
    if (req.kind === 'yin') {
      post({ type: 'progress', label: 'Tracking pitch', pct: 0 });
      const frames = yin(req.audio, req.sr, { fmin: 75, fmax: 900 });
      post({ type: 'done', ...framesToNotes(frames, { minConf: 0.6 }) });
      return;
    }
    post({ type: 'progress', label: 'Loading Basic Pitch model', pct: 0 });
    const bp = await import('@spotify/basic-pitch');
    const model = new bp.BasicPitch(req.modelUrl);
    const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
    await model.evaluateModel(
      req.audio,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
      (p) => post({ type: 'progress', label: 'Listening for notes', pct: p }),
    );
    // melodiaTrick on, vocal-ish range; thresholds a bit stricter than defaults to skip faint accompaniment
    const events = bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true, 1400, 70, true);
    const poly: PolyNote[] = bp.noteFramesToTime(events).map((n, i) => {
      const f = finePitch(contours, events[i].startFrame, events[i].durationFrames, n.pitchMidi);
      return { start: n.startTimeSeconds, end: n.startTimeSeconds + n.durationSeconds, midi: n.pitchMidi + f.offset, amp: n.amplitude, wobble: f.wobble };
    });
    post({ type: 'progress', label: 'Picking the melody line', pct: 1 });
    post({ type: 'done', ...framesToNotes(pickMelodyLine(poly), { minConf: 0.5, smooth: 1 }), poly: poly.length });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.stack ?? err) });
  }
};

/**
 * Sub-semitone pitch of a note from the contour output (3 bins per semitone from A0), using a
 * parabolic fit around the peak. Basic Pitch's own pitch bends are whole bins (33 cents): too
 * coarse to estimate the tuning of an old recording. `offset` is the median; `wobble` is the
 * 10-90% spread in semitones: voices (vibrato, glides) wobble, piano/bells/kanun hold steady.
 */
function finePitch(contours: number[][], start: number, len: number, midi: number): { offset: number; wobble: number } {
  // +1: measured with concert-pitch synthesized tones, the contour peak sits one bin above 3*(midi-21)
  const c = 3 * (midi - 21) + 1;
  const offs: number[] = [];
  for (let f = start; f < start + len && f < contours.length; f++) {
    const row = contours[f];
    let k = c;
    for (let j = c - 1; j <= c + 1; j++) if ((row[j] ?? 0) > (row[k] ?? 0)) k = j;
    const a = row[k - 1] ?? 0, b = row[k], d = row[k + 1] ?? 0;
    const den = a - 2 * b + d;
    offs.push((k - c + (den < 0 ? (a - d) / (2 * den) : 0)) / 3);
  }
  offs.sort((x, y) => x - y);
  const q = (p: number) => offs[Math.min(offs.length - 1, Math.floor(p * offs.length))];
  return offs.length ? { offset: q(0.5), wobble: q(0.9) - q(0.1) } : { offset: 0, wobble: 0 };
}
