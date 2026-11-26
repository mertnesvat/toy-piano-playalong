import { describe, expect, it } from 'vitest';
import { parseLrc, spreadWords, toLrc, wordsToLines } from '../src/lyrics';

describe('lyrics', () => {
  it('parses LRC lines and ends each line at the next', () => {
    const lines = parseLrc('[ar:Someone]\n[00:05.00] bir iki\n[00:09.50] üç dört beş', 0, 20);
    expect(lines.map((l) => [l.start, l.end, l.text])).toEqual([[5, 9.5, 'bir iki'], [9.5, 17.5, 'üç dört beş']]);
  });

  it('spreads untimed lines evenly over the song', () => {
    const lines = parseLrc('a\nb\nc\nd', 10, 50);
    expect(lines.map((l) => l.start)).toEqual([10, 20, 30, 40]);
  });

  it('fills untimed lines between timed ones', () => {
    const lines = parseLrc('[00:10.00] a\nb\n[00:20.00] c', 0, 30);
    expect(lines.map((l) => l.start)).toEqual([10, 15, 20]);
  });

  it('spreads word times by length', () => {
    const w = spreadWords('ab abcd', 0, 8);
    expect(w[0]).toEqual({ start: 0, end: 3, text: 'ab' });
    expect(w[1].end).toBeCloseTo(8);
  });

  it('round-trips through LRC', () => {
    const lines = parseLrc('[01:02.50] merhaba dünya', 0, 70);
    expect(toLrc(lines)).toBe('[01:02.50] merhaba dünya');
  });

  it('keeps existing word timings for unchanged lines', () => {
    const words = [{ start: 1, end: 1.2, text: 'a' }, { start: 2, end: 2.5, text: 'b' }];
    const lines = wordsToLines(words);
    const again = parseLrc(toLrc(lines), 0, 5, lines);
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
});
