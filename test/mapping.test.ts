import { describe, expect, it } from 'vitest';
import { KEYS, bestFit, describe as explain, estimateTuning, mapToToy, roundToSemitone } from '../src/mapping';

describe('microtone rounding', () => {
  it('rounds to the nearest semitone', () => {
    expect(roundToSemitone(60.3)).toBe(60);
    expect(roundToSemitone(60.6)).toBe(61);
    // a koma-flat segah (~ -0.25 st) still lands on its semitone
    expect(roundToSemitone(63.75)).toBe(64);
  });

  it('removes a global tuning offset before rounding', () => {
    // a recording 45 cents sharp: E4 sung at 64.45, F4 at 65.45
    const sung = [64.45, 65.45, 67.47, 64.43, 62.44];
    const tuning = estimateTuning(sung);
    expect(tuning).toBeCloseTo(0.45, 1);
    expect(sung.map((m) => roundToSemitone(m, tuning))).toEqual([64, 65, 67, 64, 62]);
  });

  it('handles offsets near half a semitone without cancelling out', () => {
    const t = estimateTuning([60.49, 61.51, 62.5, 63.49]);
    expect(Math.abs(Math.abs(t) - 0.5)).toBeLessThan(0.02);
  });
});

describe('mapToToy', () => {
  it('keeps pitch class: C major scale lands on the 8 white keys in order', () => {
    const r = mapToToy([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(r.keys).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(r.wraps).toBe(0);
    expect(KEYS[r.keys[4]].shape).toBe('star');
  });

  it('octave does not matter, only pitch class', () => {
    expect(mapToToy([48, 50, 52]).keys).toEqual(mapToToy([72, 74, 76]).keys);
  });

  it('picks low or high C to avoid jumps', () => {
    expect(mapToToy([71, 72, 71]).keys).toEqual([11, 12, 11]); // B C B -> moon diamond moon
    expect(mapToToy([62, 60, 62]).keys).toEqual([2, 0, 2]); // D C D -> heart circle heart
  });

  it('folds a melody wider than the toy with the fewest wraps', () => {
    // G3 A3 B3 C4 D4 E4 D4 C4 B3: crosses C, one fold is unavoidable
    const r = mapToToy([55, 57, 59, 60, 62, 64, 62, 60, 59]);
    expect(r.keys.slice(0, 3)).toEqual([7, 9, 11]);
    expect(r.keys.slice(4, 7)).toEqual([2, 4, 2]);
    expect(r.wraps).toBe(2); // up across C and back down across C
  });

  it('maps black-key notes to black keys by default', () => {
    expect(mapToToy([61, 63, 66, 68, 70]).keys).toEqual([1, 3, 6, 8, 10]);
  });

  it('white-only snaps every black-key note to a neighbouring white key', () => {
    const r = mapToToy([60, 61, 62, 66, 67, 70, 72], { whiteOnly: true });
    expect(r.keys.every((k) => !KEYS[k].black)).toBe(true);
    expect(r.snapped).toBe(3);
    r.keys.forEach((k, i) => expect(Math.abs(k - [0, 1, 2, 6, 7, 10, 12][i])).toBeLessThanOrEqual(1));
  });

  it('white-only snaps toward the direction the melody is heading', () => {
    // E F# G: F# snaps to F or G; rising line should not repeat G
    expect(mapToToy([64, 66, 67], { whiteOnly: true }).keys).toEqual([4, 5, 7]);
    // A Bb A: Bb between A and B; going up then back, B keeps the movement
    expect(mapToToy([69, 70, 69], { whiteOnly: true }).keys).toEqual([9, 11, 9]);
  });

  it('transpose shifts every note', () => {
    expect(mapToToy([60, 62], { transpose: 2 }).keys).toEqual([2, 4]);
  });

  it('bestFit prefers no shift when the tune already fits', () => {
    expect(bestFit([60, 62, 64, 65, 67]).transpose).toBe(0);
  });

  it('bestFit finds a shift that removes wraps', () => {
    // A3 B3 C#4 D4 E4: crosses C; shifting down 9 puts it at C..G
    const r = bestFit([57, 59, 61, 62, 64]);
    expect(r.wraps).toBe(0);
    expect(r.cost).toBeLessThan(mapToToy([57, 59, 61, 62, 64]).cost);
  });

  it('explains the result in plain words', () => {
    const midis = [55, 57, 59, 60, 62];
    const text = explain(midis, mapToToy(midis, { whiteOnly: true }), 0.3).join(' ');
    expect(text).toMatch(/30 cents sharp/);
    expect(text).toMatch(/G3 to D4/);
    expect(text).toMatch(/in tune/);
  });
});
