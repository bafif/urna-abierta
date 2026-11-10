// Checks that every document is in Spanish and in English, and that its links lead somewhere.
//   node deploy/verificar-documentos.mjs
//
// The pair of a document: X.en.md next to X.md, or, when the name changes with the language (docs/es/instalacion.md
// and docs/en/installation.md), the one its [English] or [Español] link names at the top; the two must name each
// other. CLAUDE.md, licenses and the templates in .github/, which carry both languages inside, are left out.
//
// In every .md it also checks that each relative link (Markdown, or an HTML src or href) leads to a file that exists,
// and to a heading of it when it has an anchor, and that a document does not send its reader to the other language
// when there is a version in its own (except for the link to its own pair).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';

const root = normalize(join(dirname(new URL(import.meta.url).pathname), '..'));
const TOP_LINES = 8;
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_LINK = /\b(?:src|href)="([^"]+)"/g;
const LANGUAGE_LINK = /\[(English|Español)\]\(([^)\s]+)\)/;
const EXTERNAL = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const documents = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter((path) => path && existsSync(join(root, path)))
  .sort();
const texts = new Map(documents.map((path) => [path, readFileSync(join(root, path), 'utf8')]));

const leftOut = (path) => {
  const name = posix.basename(path);
  return path.startsWith('.github/') || name === 'CLAUDE.md' || name.startsWith('LICENSE') || name.startsWith('CHANGELOG');
};

/** The lines where a link is a link: without code blocks and inline code. */
function prose(text) {
  let inside = false;
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) {
      inside = !inside;
      return '';
    }
    return inside ? '' : line.replace(/`[^`]*`/g, '');
  });
}

/** The anchor GitHub gives a heading. */
function slug(heading) {
  return heading
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

const anchorCache = new Map();
function anchors(path) {
  if (!anchorCache.has(path)) {
    const seen = new Map();
    const found = new Set();
    let inside = false;
    const text = texts.get(path) ?? readFileSync(join(root, path), 'utf8');
    for (const line of text.split('\n')) {
      if (FENCE.test(line)) inside = !inside;
      const heading = inside ? null : HEADING.exec(line);
      if (!heading) continue;
      const base = slug(heading[2]);
      const times = seen.get(base) ?? 0;
      seen.set(base, times + 1);
      found.add(times ? `${base}-${times}` : base);
    }
    for (const match of text.matchAll(/\b(?:id|name)="([^"]+)"/g)) found.add(match[1]);
    anchorCache.set(path, found);
  }
  return anchorCache.get(path);
}

/** [path from the root, anchor] of a relative link in `from`. */
function resolve(from, target) {
  const [path, anchor = ''] = target.split('#');
  if (!path) return [from, anchor];
  const base = path.startsWith('/') ? '' : posix.dirname(from);
  return [posix.normalize(posix.join(base, path.replace(/^\/+/, ''))), decodeURIComponent(anchor)];
}

const links = new Map(documents.map((path) => {
  const found = [];
  prose(texts.get(path)).forEach((line, index) => {
    for (const pattern of [MARKDOWN_LINK, HTML_LINK]) for (const match of line.matchAll(pattern)) found.push([index + 1, match[1]]);
  });
  return [path, found];
}));

const problems = [];
const pair = new Map();
const language = new Map();

for (const path of documents.filter((each) => !leftOut(each))) {
  if (path.endsWith('.en.md')) {
    pair.set(path, path.replace(/\.en\.md$/, '.md'));
    language.set(path, 'en');
    continue;
  }
  if (texts.has(path.replace(/\.md$/, '.en.md'))) {
    pair.set(path, path.replace(/\.md$/, '.en.md'));
    language.set(path, 'es');
    continue;
  }
  const top = prose(texts.get(path)).slice(0, TOP_LINES).map((line) => LANGUAGE_LINK.exec(line)).find(Boolean);
  if (!top || EXTERNAL.test(top[2])) {
    problems.push(`${path}: it has no version in the other language: no ${posix.basename(path, '.md')}.en.md next to it, and no [English] or [Español] link at the top`);
    continue;
  }
  pair.set(path, resolve(path, top[2])[0]);
  language.set(path, top[1] === 'English' ? 'es' : 'en');
}

for (const [path, other] of pair) {
  if (!texts.has(other)) {
    problems.push(`${path}: its version in ${language.get(path) === 'es' ? 'English' : 'Spanish'}, ${other}, does not exist`);
    continue;
  }
  if (pair.has(other) && pair.get(other) !== path) problems.push(`${path}: names ${other} as its pair, but ${other} names ${pair.get(other)}`);
  if (language.get(other) === language.get(path)) problems.push(`${path} and ${other} are pairs, but both say they are in the same language`);
  if (!links.get(path).some(([, target]) => !EXTERNAL.test(target) && resolve(path, target)[0] === other)) {
    problems.push(`${path}: does not link to its version in the other language, ${other}`);
  }
}

for (const path of documents) {
  for (const [line, target] of links.get(path)) {
    if (EXTERNAL.test(target) || target.startsWith('{{')) continue;
    const [destination, anchor] = resolve(path, target);
    if (!existsSync(join(root, destination))) {
      problems.push(`${path}:${line}: ${target} leads to a file that does not exist${target.replace(/^\/+/, '') === destination ? '' : ` (${destination})`}`);
      continue;
    }
    if (anchor && destination.endsWith('.md') && !anchors(destination).has(anchor)) {
      problems.push(`${path}:${line}: ${target} leads to #${anchor}, which is not a heading of ${destination}`);
    }
    const mine = language.get(path);
    const theirs = language.get(destination);
    const translated = pair.get(destination);
    if (mine && theirs && mine !== theirs && destination !== pair.get(path) && translated && texts.has(translated)) {
      problems.push(`${path}:${line}: ${target} is in the other language; this document should link to ${translated}`);
    }
  }
}

for (const problem of problems) console.log(problem);
if (problems.length) {
  console.log(`\n${problems.length} problem(s) in the documentation.`);
  process.exit(1);
}
console.log(`${documents.length} documents, ${[...language.values()].filter((each) => each === 'es').length} pairs in Spanish and English: every one has its pair, and every link leads somewhere.`);
