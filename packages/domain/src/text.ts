/** Remove case and accents, so that searching «nunez» finds «Núñez». */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
