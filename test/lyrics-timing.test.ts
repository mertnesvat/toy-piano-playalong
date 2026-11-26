import { describe, expect, it } from 'vitest';
import { parseLrc, placeLines, tapLine, toLrc, voiceMap } from '../src/lyrics';
import { framesToNotes, vocalSpans, type Note } from '../src/melody';
import { yin } from '../src/pitch';
import { noteStarts, synth } from './synth';

// A song with an 8 s instrumental intro (steady, bell-like tones), then three sung phrases
// (vibrato) separated by rests, an instrumental break, and a fourth sung phrase.
const bell = (midi: number) => ({ midi, dur: 0.45, rest: 0.05 });
const sung = (midi: number, rest = 0.05) => ({ midi, dur: 0.5, rest, vibrato: 0.4 });
const song = [
  ...[60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62].map(bell), // 0.1 .. 8.1 s
  sung(60), sung(60), sung(67), sung(67, 1.0), // phrase 1
  sung(69), sung(69), sung(67, 1.0), // phrase 2
  sung(65), sung(65), sung(64), sung(64, 0.05), // phrase 3
  ...[60, 64, 67, 72, 67, 64, 60, 64].map(bell), // instrumental break
  sung(62), sung(62), sung(60, 0.05), // phrase 4
];
const at = noteStarts(song);
const phraseStarts = [at[16], at[20], at[23], at[35]];

describe('placing untimed lyrics over the melody (generated audio)', () => {
  const sr = 16000;
  const { notes } = framesToNotes(yin(synth(song, sr), sr));
  const voice = voiceMap(notes, 30);

  it('finds the voice after the intro and skips the instrumental break', () => {
    const spans = vocalSpans(notes);
    expect(spans[0].start).toBeGreaterThan(at[16] - 0.15);
    expect(spans[0].start).toBeLessThan(at[16] + 0.15);
    expect(spans.some((s) => s.start < at[35] - 0.5 && s.end > at[27] + 1)).toBe(false); // nothing sung in the break
  });

  it('puts the first line where the voice starts and each line on a sung phrase', () => {
    const lines = parseLrc('Bir küçük yıldız\nGökte parlar\nGece boyu\nUyu bebek', voice);
    lines.forEach((l, i) => expect(Math.abs(l.start - phraseStarts[i])).toBeLessThan(0.15));
    expect(lines[0].start).toBeGreaterThan(8); // not at 0:00, not at the first (intro) note
  });

  it('places untimed lines between timed ones inside that window', () => {
    const ts = (t: number) => `[00:${t.toFixed(2).padStart(5, '0')}]`;
    const lines = parseLrc(`${ts(phraseStarts[0])} Bir küçük yıldız\nGökte parlar\nGece boyu\n${ts(phraseStarts[3])} Uyu bebek`, voice);
    expect(Math.abs(lines[1].start - phraseStarts[1])).toBeLessThan(0.15);
    expect(Math.abs(lines[2].start - phraseStarts[2])).toBeLessThan(0.15);
  });
});

describe('placeLines', () => {
  it('spreads lines by length over sung spans only', () => {
    const starts = placeLines(['aaaa', 'aaaa', 'aaaa', 'aaaa'], { spans: [{ start: 10, end: 20 }, { start: 60, end: 70 }], starts: [] });
    expect(starts).toEqual([10, 15, 60, 65]);
  });

  it('snaps to a nearby phrase start but not to a far one', () => {
    expect(placeLines(['aaaa', 'aaaa'], { spans: [{ start: 10, end: 20 }], starts: [10, 14.2] })).toEqual([10, 14.2]);
    expect(placeLines(['aaaa', 'aaaa'], { spans: [{ start: 10, end: 20 }], starts: [10, 19.5] })).toEqual([10, 15]);
  });

  it('uses Whisper word times as the voice map when there is a transcription', () => {
    const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });
    const voice = voiceMap([], 60, [w('a', 20), w('b', 20.5), w('c', 25.5), w('d', 26)]);
    expect(voice.spans[0].start).toBe(20);
    expect(parseLrc('Bir iki\nüç dört', voice).map((l) => l.start)).toEqual([20, 25.5]);
  });

  it('falls back to every note when nothing wobbles', () => {
    const flat: Note[] = [{ start: 5, end: 6, midi: 60, wobble: 0.01 }, { start: 6, end: 7, midi: 62, wobble: 0.01 }];
    expect(voiceMap(flat, 30).spans[0].start).toBe(5);
  });
});

describe('LRC times are used exactly', () => {
  it('keeps given times, including several times on one line and an offset tag', () => {
    const lines = parseLrc('[offset:+500]\n[00:14.35] Twinkle\n[00:21.56][00:50.00] How I\n[00:27.00]\n[00:30.00] Up', { spans: [], starts: [] });
    expect(lines.map((l) => [l.start, l.text])).toEqual([[13.85, 'Twinkle'], [21.06, 'How I'], [29.5, 'Up'], [49.5, 'How I']]);
    expect(lines[1].end).toBeCloseTo(26.5); // ends at the empty (instrumental) line
  });
});

describe('tap-to-sync', () => {
  const lrc = '[00:14.35] Twinkle twinkle little star\n[00:21.56] How I wonder what you are\n[00:26.93] Up above the world so high';
  const base = parseLrc(lrc, { spans: [], starts: [] });

  it('a tap sets that line and moves the later lines by the same amount', () => {
    const t = tapLine(base, 0, 20.0);
    expect(t.map((l) => +l.start.toFixed(2))).toEqual([20, 27.21, 32.58]);
    expect(t[0].words[0].start).toBeCloseTo(20);
    expect(t[1].words[0].start).toBeCloseTo(27.21);
    expect(t[0].end).toBeCloseTo(27.21);
  });

  it('the next tap fixes the next line, and redoing a line overwrites it', () => {
    let t = tapLine(base, 0, 20.0);
    t = tapLine(t, 1, 25.5);
    expect(t.map((l) => +l.start.toFixed(2))).toEqual([20, 25.5, 30.87]);
    expect(t[0].end).toBeCloseTo(25.5);
    expect(t[0].words.every((w) => w.start < 25.5)).toBe(true);
    t = tapLine(t, 1, 25.8); // redo
    expect(t.map((l) => +l.start.toFixed(2))).toEqual([20, 25.8, 31.17]);
    expect(parseLrc(toLrc(t), { spans: [], starts: [] }).map((l) => l.start)).toEqual([20, 25.8, 31.17]);
  });

  it('a tap cannot move a line before the one it follows', () => {
    const t = tapLine(tapLine(base, 0, 20), 1, 10);
    expect(t[1].start).toBeCloseTo(20.1);
  });
});
