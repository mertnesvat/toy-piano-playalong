// Basic Pitch -> one melody line. Shared by the worker and the tests (which run the real model on generated audio).
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';

type NoteEvent = ReturnType<typeof outputToNotesPoly>[number];
import { framesToNotes, pickMelodyLine, tidyLine, voiceRegister, type Note, type PolyNote } from './melody';

/** Run Basic Pitch on 22050 Hz mono audio and return the picked, tidied melody line. */
export async function basicPitchMelody(
  model: ConstructorParameters<typeof BasicPitch>[0],
  audio: Float32Array,
  onProgress: (pct: number) => void = () => {},
): Promise<{ notes: Note[]; tuning: number; poly: number }> {
  const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
  await new BasicPitch(model).evaluateModel(audio, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, onProgress);
  // melodiaTrick on, vocal-ish range; thresholds a bit stricter than defaults to skip faint accompaniment
  const events = mergeVibratoSplits(outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true, 1400, 70, true), frames);
  const poly: PolyNote[] = noteFramesToTime(events).map((n, i) => {
    const f = finePitch(contours, events[i].startFrame, events[i].durationFrames, n.pitchMidi);
    return { start: n.startTimeSeconds, end: n.startTimeSeconds + n.durationSeconds, midi: n.pitchMidi + f.offset, amp: n.amplitude, wobble: f.wobble };
  });
  return { ...melodyFromPoly(poly), poly: poly.length };
}

/**
 * Polyphonic notes -> the singable line: pick the voice (register, wobble, loudness, continuity),
 * drop fragments under 0.15 s (too fast for a toy, mostly ornaments and chord blips), then fold
 * octave errors and stray notes back to the line.
 */
export function melodyFromPoly(poly: PolyNote[]): { notes: Note[]; tuning: number } {
  const { notes, tuning } = framesToNotes(pickMelodyLine(poly), { minConf: 0.5, smooth: 1, minDur: 0.15 });
  return { notes: tidyLine(notes, voiceRegister(poly).center), tuning };
}

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

/**
 * Basic Pitch re-triggers a held, vibrato note every cycle or two, splitting one sung note into
 * several. Two back-to-back events of the same pitch are one note when the pitch's activation never
 * dips below 80% of the first event's level across the boundary; a re-sung note dips (measured:
 * about 55% at a real repeat, 100% or more at a vibrato split).
 */
export function mergeVibratoSplits(events: NoteEvent[], frames: number[][], { maxGap = 2, keep = 0.8 } = {}): NoteEvent[] {
  const sorted = [...events].sort((a, b) => a.pitchMidi - b.pitchMidi || a.startFrame - b.startFrame);
  const out: NoteEvent[] = [];
  for (const e of sorted) {
    const p = out[out.length - 1];
    if (p && p.pitchMidi === e.pitchMidi && e.startFrame - (p.startFrame + p.durationFrames) <= maxGap) {
      const bin = e.pitchMidi - 21;
      let level = 0;
      for (let f = p.startFrame; f < p.startFrame + p.durationFrames; f++) level += frames[f]?.[bin] ?? 0;
      level /= Math.max(1, p.durationFrames);
      let dip = Infinity;
      for (let f = e.startFrame - 3; f <= e.startFrame + 1; f++) dip = Math.min(dip, frames[f]?.[bin] ?? 0);
      if (dip >= keep * level) {
        p.durationFrames = e.startFrame + e.durationFrames - p.startFrame;
        p.amplitude = Math.max(p.amplitude, e.amplitude);
        continue;
      }
    }
    out.push({ ...e });
  }
  return out.sort((a, b) => a.startFrame - b.startFrame);
}
