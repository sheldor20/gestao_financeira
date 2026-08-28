export type PersonId = "kim" | "alexandre";
export type Owner = PersonId | "joint";
export type Scope = Owner | "all";
export type TransactionKind = "income" | "expense" | "transfer";
export type PaymentStatus = "paid" | "pending" | "scheduled";

export type Member = {
  memberId: string;
  id: PersonId;
  name: string;
  role: "owner" | "member";
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
  balanceDate: string | null;
  sourceDocumentId: string | null;
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

export type TransactionSource =
  | "manual"
  | "email"
  | "invoice"
  | "recurrence"
  | "bank_statement"
  | "card_invoice"
  | "document_ai"
  | "debt_installment";

export type Transaction = {
  id: string;
  owner: Owner;
  kind: TransactionKind;
  description: string;
  category: string;
  amountCents: number;
  transactionDate: string;
  status: PaymentStatus;
  source: TransactionSource;
  accountId: string | null;
  cardId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  note: string | null;
  merchantKey: string;
  isFixedRecurring: boolean;
  recurrenceStreak: number;
  aiConfidence: number | null;
  sourceDocumentId: string | null;
  debtId: string | null;
  goalId: string | null;
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
  debtType: "other" | "financing";
  institution: string | null;
  outstandingCents: number | null;
  interestRateAnnual: number | null;
  lastStatementDate: string | null;
  lastAmortizationCents: number;
  sourceDocumentId: string | null;
  installments: DebtInstallment[];
  snapshots: DebtSnapshot[];
};

export type DebtInstallment = {
  id: string;
  installmentNumber: number;
  dueDate: string;
  amountCents: number;
  principalCents: number | null;
  interestCents: number | null;
  feesCents: number | null;
  remainingBalanceCents: number | null;
  status: "pending" | "paid" | "overdue" | "partially_paid";
  sourceDocumentId: string;
};

export type DebtSnapshot = {
  id: string;
  statementDate: string;
  outstandingCents: number;
  amortizationCents: number;
  sourceDocumentId: string;
};

export type Goal = {
  id: string;
  owner: Owner;
  name: string;
  targetCents: number;
  currentCents: number;
  monthlyTargetCents: number;
  targetDate: string | null;
  targetAccountId: string | null;
  status: "active" | "completed" | "paused";
};

export type FinancialDocument = {
  id: string;
  owner: Owner;
  documentType:
    | "bank_statement"
    | "credit_card_invoice"
    | "financing_statement"
    | "investment_statement"
    | "insurance_statement"
    | "pension_statement"
    | "other";
  filename: string;
  institution: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: "uploaded" | "processing" | "review" | "applied" | "failed";
  extractionMode: "ai" | "deterministic" | null;
  itemCount: number;
  createdAt: string;
};

export type FinanceState = {
  householdId: string;
  householdName: string;
  people: Member[];
  transactions: Transaction[];
  accounts: Account[];
  cards: CreditCard[];
  debts: Debt[];
  goals: Goal[];
  documents: FinancialDocument[];
};

export const emptyFinanceState: FinanceState = {
  householdId: "",
  householdName: "Kim & Alexandre",
  people: [],
  transactions: [],
  accounts: [],
  cards: [],
  debts: [],
  goals: [],
  documents: [],
};

export function matchesScope(owner: Owner, scope: Scope) {
  return scope === "all" || owner === scope;
}

export function documentTransactionCount(
  documentId: string,
  transactions: Transaction[],
) {
  return transactions.filter(
    (transaction) => transaction.sourceDocumentId === documentId,
  ).length;
}

export function openInstallmentsTotalCents(debt: Debt) {
  return debt.installments
    .filter((installment) => installment.status !== "paid")
    .reduce(
      (sum, installment) => sum + installment.amountCents,
      0,
    );
}

export function transactionsWithDebtInstallments(
  transactions: Transaction[],
  debts: Debt[],
) {
  const matchedPayments = new Set<string>();
  const scheduled = debts.flatMap((debt) =>
    debt.installments.flatMap((installment) => {
      if (installment.status === "paid") return [];

      const paidTransaction = transactions.find(
        (transaction) =>
          !matchedPayments.has(transaction.id) &&
          transaction.debtId === debt.id &&
          transaction.kind === "expense" &&
          transaction.status === "paid" &&
          transaction.transactionDate.slice(0, 7) ===
            installment.dueDate.slice(0, 7) &&
          (transaction.amountCents === installment.amountCents ||
            transaction.installmentCurrent === installment.installmentNumber),
      );

      if (paidTransaction) {
        matchedPayments.add(paidTransaction.id);
        return [];
      }

      return [
        {
          id: `debt-installment:${installment.id}`,
          owner: debt.owner,
          kind: "expense" as const,
          description: `${debt.description} · Parcela ${installment.installmentNumber}/${debt.installmentTotal}`,
          category: "Dívidas",
          amountCents: installment.amountCents,
          transactionDate: installment.dueDate,
          status: "scheduled" as const,
          source: "debt_installment" as const,
          accountId: null,
          cardId: null,
          installmentCurrent: installment.installmentNumber,
          installmentTotal: debt.installmentTotal,
          note: "Parcela prevista pelo cronograma do financiamento.",
          merchantKey: normalizeMerchant(debt.description),
          isFixedRecurring: false,
          recurrenceStreak: 0,
          aiConfidence: null,
          sourceDocumentId: installment.sourceDocumentId,
          debtId: debt.id,
          goalId: null,
        },
      ];
    }),
  );

  return [...transactions, ...scheduled].sort((left, right) =>
    right.transactionDate.localeCompare(left.transactionDate),
  );
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

export function monthlyIncomeByPerson(
  transactions: Transaction[],
  month: string,
) {
  return {
    kimCents: transactions
      .filter(
        (item) =>
          item.kind === "income" &&
          item.owner === "kim" &&
          item.transactionDate.startsWith(month),
      )
      .reduce((sum, item) => sum + item.amountCents, 0),
    alexandreCents: transactions
      .filter(
        (item) =>
          item.kind === "income" &&
          item.owner === "alexandre" &&
          item.transactionDate.startsWith(month),
      )
      .reduce((sum, item) => sum + item.amountCents, 0),
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

export function proportionalSplit(
  totalCents: number,
  incomes: { kimCents: number; alexandreCents: number },
) {
  const incomeTotal = incomes.kimCents + incomes.alexandreCents;
  if (!incomeTotal) {
    const kimCents = Math.round(totalCents / 2);
    return {
      kimCents,
      alexandreCents: totalCents - kimCents,
      kimPercent: 50,
      alexandrePercent: 50,
    };
  }
  const kimCents = Math.round(
    (totalCents * incomes.kimCents) / incomeTotal,
  );
  const kimPercent = (incomes.kimCents / incomeTotal) * 100;
  return {
    kimCents,
    alexandreCents: totalCents - kimCents,
    kimPercent,
    alexandrePercent: 100 - kimPercent,
  };
}

export function normalizeMerchant(description: string) {
  return description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(parc(?:ela)?|compra|pagamento|debito|credito)\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function monthNumber(month: string) {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value;
}

export function classifyFixedExpenses(transactions: Transaction[]) {
  const result = new Map<
    string,
    { isFixedRecurring: boolean; recurrenceStreak: number }
  >();
  const groups = new Map<string, Map<string, Transaction[]>>();

  for (const transaction of transactions) {
    if (transaction.kind !== "expense") continue;
    const merchant =
      transaction.merchantKey || normalizeMerchant(transaction.description);
    if (!merchant) continue;
    const key = `${transaction.owner}:${merchant}`;
    const byMonth = groups.get(key) ?? new Map<string, Transaction[]>();
    const month = transaction.transactionDate.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), transaction]);
    groups.set(key, byMonth);
  }

  for (const byMonth of groups.values()) {
    const months = [...byMonth.keys()].sort(
      (a, b) => monthNumber(a) - monthNumber(b),
    );
    let segment: string[] = [];

    const applySegment = () => {
      const isFixedRecurring = segment.length >= 3;
      segment.forEach((month, index) => {
        for (const transaction of byMonth.get(month) ?? []) {
          result.set(transaction.id, {
            isFixedRecurring,
            recurrenceStreak: index + 1,
          });
        }
      });
    };

    for (const month of months) {
      if (
        segment.length &&
        monthNumber(month) !== monthNumber(segment.at(-1) ?? month) + 1
      ) {
        applySegment();
        segment = [];
      }
      segment.push(month);
    }
    applySegment();
  }

  return result;
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

export function debtPaidCents(debtId: string, transactions: Transaction[]) {
  return transactions
    .filter(
      (item) =>
        item.debtId === debtId &&
        item.kind === "expense" &&
        item.status === "paid",
    )
    .reduce((sum, item) => sum + item.amountCents, 0);
}

export function goalSavedCents(goalId: string, transactions: Transaction[]) {
  return transactions
    .filter((item) => item.goalId === goalId && item.status === "paid")
    .reduce((sum, item) => sum + item.amountCents, 0);
}
