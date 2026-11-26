import { describe, expect, it } from 'vitest';
import { cleanNotes, framesToNotes, pickMelodyLine, tidyLine, voiceRegister, type PolyNote } from '../src/melody';
import { mergeVibratoSplits } from '../src/basicpitch';
import { yin, type Frame } from '../src/pitch';
import { synth } from './synth';

const frames = (pitches: (number | null)[], hop = 0.01): Frame[] =>
  pitches.map((m, i) => ({ t: (i + 0.5) * hop, midi: m, conf: m === null ? 0 : 1 }));
const run = (m: number | null, n: number) => Array<number | null>(n).fill(m);

describe('framesToNotes', () => {
  it('groups runs into notes with times', () => {
    const { notes } = framesToNotes(frames([...run(60, 30), ...run(62, 30), ...run(null, 10), ...run(64, 30)]));
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    expect(notes[0].start).toBeCloseTo(0, 2);
    expect(notes[1].end).toBeCloseTo(0.6, 2);
    expect(notes[2].start).toBeCloseTo(0.7, 2);
  });

  it('smooths vibrato and short ornaments', () => {
    const vib = Array.from({ length: 60 }, (_, i) => 67 + 0.3 * Math.sin(i / 2));
    const ornament = [...run(60, 25), 62, 63, ...run(60, 25)];
    expect(framesToNotes(frames(vib)).notes.map((n) => n.midi)).toEqual([67]);
    expect(framesToNotes(frames(ornament)).notes.map((n) => n.midi)).toEqual([60]);
  });

  it('rounds microtonal pitches relative to the recording tuning', () => {
    const sharp = [...run(64.4, 20), ...run(65.42, 20), ...run(67.38, 20)];
    const { notes, tuning } = framesToNotes(frames(sharp));
    expect(tuning).toBeCloseTo(0.4, 1);
    expect(notes.map((n) => n.midi)).toEqual([64, 65, 67]);
  });

  it('ignores low-confidence frames', () => {
    const f = frames(run(60, 30)).map((x, i) => (i < 15 ? { ...x, conf: 0.1, midi: 72 } : x));
    expect(framesToNotes(f).notes.map((n) => n.midi)).toEqual([60]);
  });
});

describe('cleanNotes', () => {
  it('drops blips and merges same-pitch notes split by short gaps', () => {
    const out = cleanNotes([
      { start: 0, end: 0.3, midi: 60 },
      { start: 0.32, end: 0.6, midi: 60 },
      { start: 0.6, end: 0.63, midi: 71 }, // blip
      { start: 0.63, end: 1, midi: 60 },
      { start: 1.2, end: 1.5, midi: 62 },
    ]);
    expect(out).toEqual([{ start: 0, end: 1, midi: 60 }, { start: 1.2, end: 1.5, midi: 62 }]);
  });
});

describe('pickMelodyLine', () => {
  it('follows the loud vocal line over quieter ornaments above it', () => {
    const voice: PolyNote[] = [60, 62, 64, 65].map((m, i) => ({ start: i * 0.5, end: i * 0.5 + 0.45, midi: m, amp: 0.8 }));
    const kanun: PolyNote[] = Array.from({ length: 16 }, (_, i) => ({ start: i * 0.125, end: i * 0.125 + 0.1, midi: 72 + (i % 4), amp: 0.35 }));
    const { notes } = framesToNotes(pickMelodyLine([...voice, ...kanun]), { tuning: 0 });
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65]);
  });

  it('keeps re-struck repeated notes apart', () => {
    const rep: PolyNote[] = [0, 0.45, 0.9].map((s) => ({ start: s, end: s + 0.44, midi: 62, amp: 0.7 }));
    const { notes } = framesToNotes(pickMelodyLine(rep), { tuning: 0, smooth: 1 });
    expect(notes.map((n) => n.midi)).toEqual([62, 62, 62]);
  });

  it('prefers a smooth line when two notes are equally loud', () => {
    const a: PolyNote[] = [
      { start: 0, end: 1, midi: 64, amp: 0.6 },
      { start: 1, end: 2, midi: 65, amp: 0.6 },
      { start: 1, end: 2, midi: 76, amp: 0.6 },
    ];
    const { notes } = framesToNotes(pickMelodyLine(a), { tuning: 0 });
    expect(notes.map((n) => n.midi)).toEqual([64, 65]);
  });
});

describe('yin', () => {
  it('tracks a synthesized melody', () => {
    const melody = [{ midi: 60, dur: 0.4 }, { midi: 64, dur: 0.4 }, { midi: 67, dur: 0.4 }, { midi: 72, dur: 0.4 }];
    const sr = 16000;
    const x = synth(melody, sr);
    const { notes, tuning } = framesToNotes(yin(x, sr));
    expect(Math.abs(tuning)).toBeLessThan(0.05);
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 72]);
  });

  it('is silent on silence', () => {
    expect(yin(new Float32Array(16000), 16000).every((f) => f.midi === null)).toBe(true);
  });
});

describe('voiceRegister and tidyLine', () => {
  const n = (start: number, midi: number, dur = 0.5) => ({ start, end: start + dur, midi });

  it('finds the register of the notes that wobble like a voice, not the louder steady bass', () => {
    const voice = [64, 65, 67, 65].map((m, i) => ({ ...n(i, m), amp: 0.5, wobble: 0.4 }));
    const bass = [40, 43, 40, 43].map((m, i) => ({ ...n(i, m, 1), amp: 0.9, wobble: 0.02 }));
    expect(voiceRegister([...voice, ...bass]).center).toBeGreaterThanOrEqual(64);
  });

  it('folds octave errors and bass doublings into the line, keeps repeated notes apart', () => {
    const line = [n(0, 61), n(0.5, 61), n(1, 73), n(1.5, 68), n(2, 44), n(2.5, 70), n(3, 70), n(3.5, 68)];
    expect(tidyLine(line, 65).map((x) => x.midi)).toEqual([61, 61, 61, 68, 68, 70, 70, 68]);
  });

  it('leaves a melody that already sits in its register alone', () => {
    const line = [60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60].map((m, i) => n(i * 0.5, m));
    expect(tidyLine(line, 64)).toEqual(line);
  });
});

describe('mergeVibratoSplits', () => {
  const ev = (startFrame: number, durationFrames: number, pitchMidi = 60) => ({ startFrame, durationFrames, pitchMidi, amplitude: 0.5 });
  const frames = (dipAt: number | null) => Array.from({ length: 100 }, (_, f) => { const row = new Array(88).fill(0); row[39] = dipAt !== null && Math.abs(f - dipAt) <= 1 ? 0.3 : 0.7; return row; });

  it('joins a held note that vibrato split in two', () => {
    expect(mergeVibratoSplits([ev(10, 20), ev(30, 20)], frames(null))).toEqual([{ ...ev(10, 40) }]);
  });

  it('keeps a re-sung note (the activation dips between them)', () => {
    expect(mergeVibratoSplits([ev(10, 20), ev(30, 20)], frames(29))).toHaveLength(2);
  });

  it('keeps notes of different pitch, or with a real gap, apart', () => {
    expect(mergeVibratoSplits([ev(10, 20), ev(30, 20, 62)], frames(null))).toHaveLength(2);
    expect(mergeVibratoSplits([ev(10, 20), ev(40, 20)], frames(null))).toHaveLength(2);
  });
});
