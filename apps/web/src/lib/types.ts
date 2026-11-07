export interface ElectionSummary {
  id: string;
  name: string;
  kind: string;
  days: string[];
  status: string;
  people: number;
  to_review: number;
  without_table: number;
  tables: number;
  tables_without_fiscal: number;
  categories: { id: string; name: string; lists: { id: string; name: string }[] }[];
  /** At what time each day is voted, by day. */
  hours?: Record<string, { open: string; close: string }>;
}
