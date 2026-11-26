import { describe, expect, it } from 'vitest';
import { cleanNotes, framesToNotes, pickMelodyLine, type PolyNote } from '../src/melody';
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
