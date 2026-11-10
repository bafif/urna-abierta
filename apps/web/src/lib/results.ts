export interface ResultList {
  id: string;
  name: string;
  votes: number;
}

export interface ResultCategory {
  id: string;
  name: string;
  /** Tables whose tally is added up: the chosen version, or the only one. */
  counted: number;
  /** Tables with two versions and nobody who chose yet. */
  undecided: number;
  /** Tables that sent no tally for it. */
  missing: number;
  lists: ResultList[];
}

export interface Results {
  name: string;
  status: string;
  tables: number;
  categories: ResultCategory[];
}

/** Each table's own numbers, as the server gives them for the spreadsheet. */
export interface ResultsByTable extends Results {
  perTable: { name: string; categories: Record<string, Record<string, number> | 'undecided' | null> }[];
}

/** What each column and each table left out are called in the language of whoever downloads it. */
export interface SheetWords {
  table: string;
  category: string;
  list: string;
  votes: string;
  undecided: string;
  missing: string;
}

/**
 * A value as a spreadsheet reads it. A name that starts like a formula is taken as text: a table named «=1+1»
 * shows as written, and runs nothing.
 */
function cell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One row per table, category and list. A table that adds nothing says why, in place of its lists. */
export function resultsCsv(sheet: ResultsByTable, words: SheetWords): string {
  const rows: (string | number)[][] = [[words.table, words.category, words.list, words.votes]];
  for (const table of sheet.perTable) {
    for (const category of sheet.categories) {
      const found = table.categories[category.id];
      if (found && found !== 'undecided') for (const list of category.lists) rows.push([table.name, category.name, list.name, found[list.id] ?? 0]);
      else rows.push([table.name, category.name, found === 'undecided' ? words.undecided : words.missing, '']);
    }
  }
  // The mark at the start tells Excel the accents are UTF-8.
  return `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Each list's share of all the votes of its category, blank and null included, rounded. */
export function shareOf(votes: number, category: ResultCategory): number {
  const total = category.lists.reduce((sum, list) => sum + list.votes, 0);
  return total === 0 ? 0 : Math.round((votes / total) * 100);
}
