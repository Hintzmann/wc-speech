import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  endsWithAbbreviation,
  fallbackSentenceSegments,
  mergeAbbreviationSegments,
} from '../wc-speech-segment.js';

describe('endsWithAbbreviation', () => {
  it('detects initialisms', () => {
    assert.equal(endsWithAbbreviation('See U.S.A.'), true);
    assert.equal(endsWithAbbreviation('Hello world.'), false);
  });

  it('detects common abbreviations', () => {
    assert.equal(endsWithAbbreviation('f.eks.'), true);
    assert.equal(endsWithAbbreviation('fig.'), true);
  });
});

describe('fallbackSentenceSegments', () => {
  it('splits on sentence-ending punctuation', () => {
    const segments = fallbackSentenceSegments('Hello world. Second sentence!');
    assert.deepEqual(segments, [
      { start: 0, end: 12 },
      { start: 13, end: 29 },
    ]);
  });

  it('does not split on abbreviation periods', () => {
    const text = 'Det er f.eks. et eksempel. Ny sætning.';
    const segments = fallbackSentenceSegments(text);
    assert.equal(segments.length, 2);
    assert.equal(text.slice(segments[0].start, segments[0].end), 'Det er f.eks. et eksempel.');
  });

  it('returns one segment for text without breaks', () => {
    const text = 'No ending punctuation';
    const segments = fallbackSentenceSegments(text);
    assert.deepEqual(segments, [{ start: 0, end: text.length }]);
  });
});

describe('mergeAbbreviationSegments', () => {
  it('merges segments when the previous text ends with an abbreviation', () => {
    const text = 'Det er f.eks. et eksempel.';
    const merged = mergeAbbreviationSegments(text, [
      { start: 0, end: 13 },
      { start: 13, end: text.length },
    ]);

    assert.deepEqual(merged, [{ start: 0, end: text.length }]);
  });
});
