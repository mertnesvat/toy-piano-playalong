import { describe, expect, it } from 'vitest';
import { cleanWhisperWords, parseLrc, spreadWords, toLrc, wordsToLines } from '../src/lyrics';

const whole = (start: number, end: number) => ({ spans: [{ start, end }], starts: [] });

describe('lyrics', () => {
  it('parses LRC lines and ends each line at the next', () => {
    const lines = parseLrc('[ar:Someone]\n[00:05.00] bir iki\n[00:09.50] üç dört beş', whole(0, 20));
    expect(lines.map((l) => [l.start, l.end, l.text])).toEqual([[5, 9.5, 'bir iki'], [9.5, 13.5, 'üç dört beş']]);
  });

  it('spreads untimed lines evenly over the song', () => {
    const lines = parseLrc('a\nb\nc\nd', whole(10, 50));
    expect(lines.map((l) => l.start)).toEqual([10, 20, 30, 40]);
  });

  it('fills untimed lines between timed ones', () => {
    const lines = parseLrc('[00:10.00] a\nb\n[00:20.00] c', whole(0, 30));
    expect(lines.map((l) => l.start)).toEqual([10, 15, 20]);
  });

  it('spreads word times by length', () => {
    const w = spreadWords('ab abcd', 0, 8);
    expect(w[0]).toEqual({ start: 0, end: 3, text: 'ab' });
    expect(w[1].end).toBeCloseTo(8);
  });

  it('round-trips through LRC', () => {
    const lines = parseLrc('[01:02.50] merhaba dünya', whole(0, 70));
    expect(toLrc(lines)).toBe('[01:02.50] merhaba dünya');
  });

  it('keeps existing word timings for unchanged lines', () => {
    const words = [{ start: 1, end: 1.2, text: 'a' }, { start: 2, end: 2.5, text: 'b' }];
    const lines = wordsToLines(words);
    const again = parseLrc(toLrc(lines), whole(0, 5), lines);
    expect(again[0].words).toEqual(words);
  });

  it('splits whisper words into lines at pauses', () => {
    const lines = wordsToLines([
      { start: 0, end: 0.5, text: ' bir' },
      { start: 0.5, end: 1, text: ' iki' },
      { start: 3, end: 3.5, text: ' üç' },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['bir iki', 'üç']);
  });

  it('removes Whisper repetition loops, credit hallucinations and out-of-range words', () => {
    const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
    const words = [w('yine', 1), w('ah', 2), w('ah', 2.2), w('Ah', 2.4), w('ah', 2.6), w('bayram', 3), w('oluyor', 3.3), w('Altyazı', 9), w('M.K.', 9.2), w('Ağzını', 20), w('O', 30)];
    expect(cleanWhisperWords(words, 25).map((x) => x.text)).toEqual(['yine', 'bayram', 'oluyor', 'Ağzını']);
  });

  it('removes multi-word Whisper loops (crammed timestamps)', () => {
    const t = 'bir iki ah ve yüz ah ve yüz ah ve yüz ah ve üç'.split(' ');
    const words = t.map((text, i) => (i < 2 || i > 10 ? { text, start: i, end: i + 0.5 } : { text, start: 2 + i * 0.05, end: 2.05 + i * 0.05 }));
    expect(cleanWhisperWords(words, 99).map((x) => x.text)).toEqual(['bir', 'iki', 'ah', 've', 'üç']);
  });

  it('keeps a phrase that is really sung several times', () => {
    const words = 'let it be let it be let it be let it be'.split(' ').map((text, i) => ({ text, start: i * 0.6, end: i * 0.6 + 0.5 }));
    expect(cleanWhisperWords(words, 99)).toHaveLength(12);
  });

  it('keeps the known end of a long Whisper line after reparsing', () => {
    const words = Array.from({ length: 8 }, (_, i) => ({ text: `w${i}`, start: 10 + i, end: 10.8 + i }));
    const lines = wordsToLines(words);
    expect(parseLrc(toLrc(lines), whole(0, 60), lines)[0].end).toBeCloseTo(17.8);
  });
});
