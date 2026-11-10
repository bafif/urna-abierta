import legalEn from '../../../../LEGAL.en.md?raw';
import legalEs from '../../../../LEGAL.md?raw';

/** A piece of the legal text, as plain text: nothing of the file becomes markup on the page. */
export interface Block {
  kind: 'title' | 'paragraph' | 'item' | 'note';
  text: string;
}

/** Links keep their words, emphasis marks go: the text reads the same without them. */
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/&nbsp;/g, ' ');

/** The legal text of this very version, read from the file it was built with, without going online. */
export function legalBlocks(language: string): Block[] {
  const source = language === 'en' ? legalEn : legalEs;
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: plain(paragraph.join(' ')) });
    paragraph = [];
  };
  // The first lines are the title and the links between the files of the repository.
  for (const line of source.split('\n').slice(3)) {
    const trimmed = line.trim();
    if (!trimmed) flush();
    else if (trimmed.startsWith('#')) {
      flush();
      blocks.push({ kind: 'title', text: plain(trimmed.replace(/^#+\s*/, '')) });
    } else if (/^[-*] /.test(trimmed)) {
      flush();
      blocks.push({ kind: 'item', text: plain(trimmed.slice(2)) });
    } else if (trimmed.startsWith('>')) {
      const text = plain(trimmed.replace(/^>\s?/, ''));
      const last = blocks.at(-1);
      if (last?.kind === 'note' && !paragraph.length) last.text += ` ${text}`;
      else {
        flush();
        blocks.push({ kind: 'note', text });
      }
    } else paragraph.push(trimmed);
  }
  flush();
  return blocks;
}
