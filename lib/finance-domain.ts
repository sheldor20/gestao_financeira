export type PersonId = "kim" | "alexandre";
export type Owner = PersonId | "joint";
export type Scope = Owner | "all";
export type TransactionKind = "income" | "expense" | "transfer";
export type PaymentStatus = "paid" | "pending" | "scheduled";

export type Person = {
  id: PersonId;
  name: string;
  monthlyIncomeCents: number;
  color: string;
};

export type Account = {
  id: string;
  owner: Owner;
  name: string;
  institution: string;
  type:
    | "checking"
    | "savings"
    | "investment"
    | "pension"
    | "insurance"
    | "cash"
    | "other";
  balanceCents: number;
  includeInNetWorth: boolean;
};

export type CreditCard = {
  id: string;
  owner: Owner;
  name: string;
  institution: string;
  closingDay: number;
  dueDay: number;
  limitCents: number;
};

export type Transaction = {
  id: string;
  owner: Owner;
  kind: TransactionKind;
  description: string;
  category: string;
  amountCents: number;
  transactionDate: string;
  status: PaymentStatus;
  source: "manual" | "email" | "invoice" | "recurrence";
  accountId?: string | null;
  cardId?: string | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  note?: string;
};

export type Debt = {
  id: string;
  owner: Owner;
  description: string;
  totalCents: number;
  installmentCents: number;
  installmentCurrent: number;
  installmentTotal: number;
  dueDate: string;
  status: "pending" | "paid" | "overdue";
  category: string;
};

export type Budget = {
  id: string;
  owner: Owner;
  category: string;
  month: string;
  limitCents: number;
};

export type Goal = {
  id: string;
  owner: Owner;
  name: string;
  targetCents: number;
  currentCents: number;
  targetDate: string;
  status: "active" | "completed" | "paused";
};

export type Recurrence = {
  id: string;
  owner: Owner;
  description: string;
  category: string;
  amountCents: number;
  kind: "income" | "expense";
  frequency: "monthly" | "annual";
  nextDate: string;
  active: boolean;
};

export type Invoice = {
  id: string;
  cardId: string | null;
  owner: Owner;
  filename: string;
  period: string;
  totalCents: number;
  itemCount: number;
  status: "review" | "reviewed";
  createdAt: string;
};

export type SplitSettings = {
  method: "proportional" | "equal" | "custom";
  kimPercent: number;
  alexandrePercent: number;
};

export type FinanceState = {
  householdName: string;
  people: Person[];
  categories: string[];
  transactions: Transaction[];
  accounts: Account[];
  cards: CreditCard[];
  debts: Debt[];
  budgets: Budget[];
  goals: Goal[];
  recurrences: Recurrence[];
  invoices: Invoice[];
  split: SplitSettings;
};

export function matchesScope(owner: Owner, scope: Scope) {
  return scope === "all" || owner === scope;
}

export function transactionsForPeriod(
  transactions: Transaction[],
  month: string,
  scope: Scope,
) {
  return transactions.filter(
    (transaction) =>
      transaction.transactionDate.startsWith(month) &&
      matchesScope(transaction.owner, scope),
  );
}

export function monthlySummary(
  transactions: Transaction[],
  month: string,
  scope: Scope,
) {
  const visible = transactionsForPeriod(transactions, month, scope);
  const incomeCents = visible
    .filter((item) => item.kind === "income")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const expenseCents = visible
    .filter((item) => item.kind === "expense")
    .reduce((sum, item) => sum + item.amountCents, 0);
  return {
    incomeCents,
    expenseCents,
    resultCents: incomeCents - expenseCents,
    visible,
  };
}

export function expenseByCategory(transactions: Transaction[]) {
  return Object.entries(
    transactions
      .filter((item) => item.kind === "expense")
      .reduce<Record<string, number>>((totals, item) => {
        totals[item.category] = (totals[item.category] ?? 0) + item.amountCents;
        return totals;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);
}

export function proportionalSplit(totalCents: number, people: Person[]) {
  const incomeTotal = people.reduce(
    (sum, person) => sum + person.monthlyIncomeCents,
    0,
  );
  if (!incomeTotal)
    return {
      kimCents: Math.round(totalCents / 2),
      alexandreCents: totalCents - Math.round(totalCents / 2),
      kimPercent: 50,
      alexandrePercent: 50,
    };
  const kimIncome =
    people.find((person) => person.id === "kim")?.monthlyIncomeCents ?? 0;
  const kimCents = Math.round((totalCents * kimIncome) / incomeTotal);
  const kimPercent = (kimIncome / incomeTotal) * 100;
  return {
    kimCents,
    alexandreCents: totalCents - kimCents,
    kimPercent,
    alexandrePercent: 100 - kimPercent,
  };
}

export function customSplit(
  totalCents: number,
  settings: SplitSettings,
  people: Person[],
) {
  if (settings.method === "proportional")
    return proportionalSplit(totalCents, people);
  const kimPercent = settings.method === "equal" ? 50 : settings.kimPercent;
  const kimCents = Math.round((totalCents * kimPercent) / 100);
  return {
    kimCents,
    alexandreCents: totalCents - kimCents,
    kimPercent,
    alexandrePercent: 100 - kimPercent,
  };
}

export function accountTotals(accounts: Account[], scope: Scope) {
  const visible = accounts.filter((account) =>
    matchesScope(account.owner, scope),
  );
  const netWorthCents = visible
    .filter(
      (account) => account.includeInNetWorth && account.type !== "insurance",
    )
    .reduce((sum, account) => sum + account.balanceCents, 0);
  const insuredCents = visible
    .filter((account) => account.type === "insurance")
    .reduce((sum, account) => sum + account.balanceCents, 0);
  return { netWorthCents, insuredCents };
}

export function installmentRemaining(debt: Debt) {
  if (debt.status === "paid") return 0;
  return (
    Math.max(0, debt.installmentTotal - debt.installmentCurrent + 1) *
    debt.installmentCents
  );
}

export function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
