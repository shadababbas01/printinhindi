// Regression suite for the Kruti Dev / Devlys conversion + Devanagari
// normalization logic, extracted verbatim from the production HTML file.
// These pin the CURRENT verified behavior (validated by hand against real
// registry documents during development) so that any future refactor of
// this module can be checked against a known-good baseline instead of
// re-litigating correctness from scratch.
import { describe, it, expect } from 'vitest';
import {
  convertLegacyText,
  detectLegacyFont,
  normalizeDevanagariText,
} from '../../apps/web/src/registry/legacy-font.js';

describe('Kruti Dev 010 -> Unicode conversion', () => {
  const cases = {
    'Hkkjr': 'भारत',
    'jkT;': 'राज्य',
    'vkosnu': 'आवेदन',
    'ftyk': 'जिला',
    'rglhy': 'तहसील',
    'laifRr': 'संपत्ति',
    'fganh': 'हिंदी',
    'fnukad': 'दिनांक',
    'dk;kZy;': 'कार्यालय',
    'dd±/kq': 'कर्कंधु',
    'gLrk{kj': 'हस्ताक्षर',
  };

  for (const [input, expected] of Object.entries(cases)) {
    it(`converts "${input}" -> "${expected}"`, () => {
      expect(convertLegacyText(input, 'kruti')).toBe(expected);
    });
  }

  it('leaves plain ASCII digits untouched (no Devanagari numerals)', () => {
    expect(convertLegacyText('1234', 'kruti')).toBe('1234');
  });

  it('keeps survey-number punctuation literal when adjacent to digits', () => {
    expect(convertLegacyText('कीला नं0 6/1(6-17)', 'kruti')).toBe('कीला नं0 6/1(6-17)');
    expect(convertLegacyText('01-12-2025', 'kruti')).toBe('01-12-2025');
    expect(convertLegacyText('33.4', 'kruti')).toBe('33.4');
  });

  it('still converts ambiguous punctuation to its Devanagari glyph in word context', () => {
    // ':ह' -> 'रूह' ("by virtue of") — a real legal-deed phrase, not a citation.
    expect(convertLegacyText(':ह', 'kruti')).toBe('रूह');
  });
});

describe('detectLegacyFont', () => {
  it('flags high confidence for text with strong Kruti Dev signatures', () => {
    const sample = 'ftyk Qjhnkckn esa vjkth [ksor@[kkrk ua0 106@115 Hkkjr jkT; U;kfn laifRr iath ljdkj rglhy izkFkZuk vkosnu '.repeat(3);
    const result = detectLegacyFont(sample);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('does not flag well-formed Unicode Hindi text', () => {
    const sample = 'यह एक पूर्णतः यूनिकोड हिंदी दस्तावेज़ है जिसमें कोई लैटिन अक्षर सम्मिलित नहीं है।';
    const result = detectLegacyFont(sample);
    expect(result.detected).toBe(false);
  });
});

describe('normalizeDevanagariText', () => {
  const alreadyCorrect = [
    'संपत्ति', 'हैं', 'कहीं', 'वहीं', 'दिनांक', 'मैं', 'गांव', 'पत्नी', 'हूँ',
    'रजिस्ट्री', 'क्षेत्र', 'ज्ञान', 'आवेदन', 'अराजी', 'फरीदाबाद', 'हरियाणा',
    'मुख्तारनामा', 'हस्तांतरण', 'कार्यालय', 'बल्लबगढ', 'जिला', 'कीला',
  ];

  for (const word of alreadyCorrect) {
    it(`is a no-op on already-correct "${word}"`, () => {
      expect(normalizeDevanagariText(word)).toBe(word);
    });
  }

  it('fixes anusvar-before-matra ordering', () => {
    expect(normalizeDevanagariText('दिनं़ाक')).toBe('दिनांक');
  });

  it('drops an orphaned nukta with no valid base', () => {
    expect(normalizeDevanagariText('कीला ़न0')).toBe('कीला न0');
  });

  it('cleans a mixed orphan+ordering case without inventing missing characters', () => {
    expect(normalizeDevanagariText('मैनं़े')).toBe('मैनें');
  });
});
