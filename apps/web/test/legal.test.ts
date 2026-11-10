import { describe, expect, it } from 'vitest';
import { legalBlocks } from '../src/lib/legal.ts';

describe('the legal text inside the app', () => {
  it('is the file of this version, in each language, as plain text with no marks or links', () => {
    for (const language of ['es', 'en']) {
      const blocks = legalBlocks(language);
      expect(blocks.filter((block) => block.kind === 'title').length).toBeGreaterThan(3);
      expect(blocks.some((block) => block.text.includes('AGPL'))).toBe(true);
      expect(blocks.every((block) => !/\]\(|\*\*|<[a-z]/.test(block.text))).toBe(true);
    }
    expect(legalBlocks('es')[0]).toMatchObject({ kind: 'note' });
  });
});
