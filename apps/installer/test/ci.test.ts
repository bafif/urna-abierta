import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const packages = ['apps', 'packages', 'tools'].flatMap((folder) => readdirSync(new URL(`${folder}/`, root)).map((name) => `${folder}/${name}/`));

describe('the end to end scripts', () => {
  it.each(['deploy/e2e.sh', 'deploy/e2e-instalador.sh'])('%s hands Playwright the report folder only when there is one', (path) => {
    const script = read(path);
    // The bash of macOS, 3.2, stops on an empty array under set -u, and only a run there would show it.
    expect(script).not.toMatch(/\$\{\w+\[[@*]\]/);
    // How each one starts the browsers, with a podman that only says what it got.
    const start = script.slice(script.indexOf('# With URNA_E2E_INFORME'));
    const shell = `set -euo pipefail\npodman() { printf '%s\\n' "$@"; }\nroot=/repo port=1 url=http://x\n${start}`;
    const args = (env: Record<string, string>) =>
      execFileSync('bash', ['-c', shell, 'e2e', '--grep', 'una prueba'], { env: { PATH: process.env.PATH ?? '', ...env } }).toString().trimEnd().split('\n');
    const work = mkdtempSync(join(tmpdir(), 'informe '));
    try {
      const plain = args({});
      expect(plain.join(' ')).not.toContain('informe');
      expect(plain.slice(-4)).toEqual(['--output', '/tmp/results', '--grep', 'una prueba']);

      const folder = join(work, 'con espacios');
      const kept = args({ URNA_E2E_INFORME: folder });
      expect(kept[kept.indexOf(`${folder}:/informe`) - 1]).toBe('-v');
      expect(kept).toContain('PLAYWRIGHT_HTML_OUTPUT_DIR=/informe/html');
      expect(kept.slice(-7)).toEqual(['--output', '/informe/resultados', '--reporter=list,html', '--trace', 'retain-on-failure', '--grep', 'una prueba']);
      expect(readdirSync(work)).toEqual(['con espacios']);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('what GitHub runs', () => {
  const workflow = read('.github/workflows/tests.yml');

  it('cancels only an older run of the same pull request, and every commit to main gets its own', () => {
    // In a group that runs share, GitHub keeps only the newest waiting run and cancels the others.
    expect(/^concurrency:\n {2}group: (.*)$/m.exec(workflow)?.[1]).toBe("tests-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}");
  });

  it('checks the types of every package, its tests and end to end ones included', () => {
    expect(workflow).toContain('run: pnpm -r --no-bail run check');
    for (const pkg of packages) {
      const { scripts } = JSON.parse(read(`${pkg}package.json`)) as { scripts?: Record<string, string> };
      expect(scripts?.check, pkg).toBeDefined();
      // tsc and svelte-check look only in the folders that the tsconfig names.
      const { include } = JSON.parse(read(`${pkg}tsconfig.json`)) as { include: string[] };
      const folders = readdirSync(new URL(pkg, root), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
        .filter((entry) => (readdirSync(new URL(`${pkg}${entry.name}/`, root), { recursive: true }) as string[]).some((file) => file.endsWith('.ts')))
        .map((entry) => entry.name);
      expect(folders.filter((folder) => !include.includes(folder)), pkg).toEqual([]);
    }
  });
});

describe('what a release says', () => {
  const notes = read('.github/release-notes.md');

  it('says what to download in both languages, above the changes GitHub lists', () => {
    expect(read('.github/workflows/release.yml')).toMatch(/gh release create "\$GITHUB_REF_NAME" --draft --generate-notes --notes-file /);
    expect(notes).toContain('en español y en inglés');
    expect(notes).toContain('in Spanish and English');
  });

  it('points only to guides that exist, in the language of each part', () => {
    const guides = [...notes.matchAll(/blob\/\{tag\}\/(docs\/(es|en)\/[\w-]+\.md)/g)].map((match) => match[1]!);
    expect(guides.filter((path) => path.startsWith('docs/es/')).length).toBeGreaterThan(0);
    expect(guides.filter((path) => path.startsWith('docs/en/')).length).toBeGreaterThan(0);
    for (const path of guides) expect(() => read(path), path).not.toThrow();
  });
});
