// The shapes of everything the app stores. Money is always whole cents.

export type Member = { id: string; name: string };

/** How one expense is divided between people. */
export type Split =
  | { kind: "equal"; among: string[] } // same share for each listed person
  | { kind: "exact"; shares: Record<string, number> } // memberId -> cents
  | { kind: "percent"; percents: Record<string, number> } // memberId -> hundredths of a percent (5000 = 50%)
  | { kind: "shares"; weights: Record<string, number> }; // memberId -> shares (2 = twice as much as 1)

export type SplitKind = Split["kind"];

/** The amount as it was spent, when it wasn't in the group's currency. */
export type Foreign = { currency: string; cents: number; rate: number }; // rate = group currency per 1 unit

export const CATEGORIES = [
  "Groceries", "Dining", "Rent", "Utilities", "Transport", "Household", "Entertainment", "Travel", "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Expense = {
  id: string;
  description: string;
  date: string; // YYYY-MM-DD
  payers: Record<string, number>; // memberId -> cents they paid; adds up to totalCents
  totalCents: number; // in the group's currency
  foreign?: Foreign;
  split: Split;
  category: Category;
  notes?: string;
  photo?: string; // small JPEG as a data: URL
  recurringId?: string;
  itemized?: Itemized; // set when the expense came from a receipt
  createdAt: number;
};

/** The lines of a split receipt, kept so anyone can see who had what. */
export type Itemized = {
  store: string;
  lines: { name: string; cents: number; who: string[] }[]; // cents include that line's tax
  taxCents: number;
  tipCents: number;
};

/** One person paying another back. */
export type Settlement = {
  id: string;
  from: string;
  to: string;
  cents: number;
  date: string;
  createdAt: number;
};

/** A repeating expense such as rent. A copy is added on each due date. */
export type Recurring = {
  id: string;
  every: "week" | "month";
  nextDate: string;
  template: Omit<Expense, "id" | "date" | "createdAt" | "recurringId">;
};

export type Group = {
  id: string;
  name: string;
  currency: string; // e.g. "CAD"
  members: Member[];
  meId: string; // which member is the person using this phone
  defaultSplit?: Split;
  expenses: Expense[];
  settlements: Settlement[];
  recurring: Recurring[];
  itemMemory?: Record<string, string[]>; // remembered "who takes which item"
  createdAt: number;
};

export type AppState = { version: 2; groups: Group[] };
