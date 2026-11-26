// Melody extraction off the main thread. Basic Pitch (TF.js) for full mixes, YIN for a single voice.
import { framesToNotes, tidyLine, voiceRegister } from '../melody';
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
      const { notes, tuning } = framesToNotes(yin(req.audio, req.sr, { fmin: 75, fmax: 900 }), { minConf: 0.6 });
      // one voice: its register is simply where its notes are; tidy folds YIN's octave errors back
      post({ type: 'done', notes: tidyLine(notes, voiceRegister(notes.map((n) => ({ ...n, amp: 1 }))).center), tuning });
      return;
    }
    post({ type: 'progress', label: 'Loading Basic Pitch model', pct: 0 });
    const { basicPitchMelody } = await import('../basicpitch'); // lazy: TF.js and the model load on first use
    const r = await basicPitchMelody(req.modelUrl, req.audio, (p) => post({ type: 'progress', label: 'Listening for notes', pct: p }));
    post({ type: 'done', ...r });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.stack ?? err) });
  }
};
