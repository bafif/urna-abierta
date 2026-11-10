import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export type Texts = Record<'es' | 'en', Record<string, string>>;

/** What ui/texts.js gives the screens, read as the browser reads it. */
export function installerTexts(): Texts {
  const context = { window: {} as { INSTALLER_TEXTS?: Texts; languageOf?: (preferred: string[]) => 'es' | 'en' } };
  vm.runInNewContext(readFileSync(new URL('../ui/texts.js', import.meta.url), 'utf8'), context);
  return context.window.INSTALLER_TEXTS!;
}

export function installerLanguageOf(): (preferred: string[]) => 'es' | 'en' {
  const context = { window: {} as { languageOf?: (preferred: string[]) => 'es' | 'en' } };
  vm.runInNewContext(readFileSync(new URL('../ui/texts.js', import.meta.url), 'utf8'), context);
  return context.window.languageOf!;
}
