import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFixedExpenses,
  debtPaidCents,
  goalSavedCents,
  monthlyIncomeByPerson,
  monthlySummary,
  proportionalSplit,
  type Transaction,
} from "../lib/finance-domain.ts";

function movement(
  id: string,
  owner: Transaction["owner"],
  kind: Transaction["kind"],
  amountCents: number,
  transactionDate: string,
  description = "Movimentação",
): Transaction {
  return {
    id,
    owner,
    kind,
    amountCents,
    transactionDate,
    description,
    category: "Outros",
    status: "paid",
    source: "bank_statement",
    accountId: null,
    cardId: null,
    installmentCurrent: null,
    installmentTotal: null,
    note: null,
    merchantKey: description.toLowerCase(),
    isFixedRecurring: false,
    recurrenceStreak: 0,
    aiConfidence: null,
    sourceDocumentId: null,
    debtId: null,
    goalId: null,
  };
}

const transactions = [
  movement("k1", "kim", "income", 4_000_000, "2026-08-05", "Salário Kim"),
  movement(
    "a1",
    "alexandre",
    "income",
    1_029_868,
    "2026-08-05",
    "Salário Alexandre",
  ),
  movement("e1", "kim", "expense", 500_000, "2026-08-10", "Aluguel"),
  movement("e2", "joint", "expense", 80_000, "2026-08-12", "Energia"),
];

test("calcula a renda mensal somente pelas entradas importadas", () => {
  assert.deepEqual(monthlyIncomeByPerson(transactions, "2026-08"), {
    kimCents: 4_000_000,
    alexandreCents: 1_029_868,
  });
  assert.deepEqual(monthlyIncomeByPerson(transactions, "2026-07"), {
    kimCents: 0,
    alexandreCents: 0,
  });
});

test("divide R$ 5.000 proporcionalmente à renda apurada", () => {
  const split = proportionalSplit(500_000, {
    kimCents: 4_000_000,
    alexandreCents: 1_029_868,
  });
  assert.equal(split.kimCents, 397_625);
  assert.equal(split.alexandreCents, 102_375);
  assert.ok(Math.abs(split.kimPercent - 79.525) < 0.01);
});

test("consolida entradas e saídas por pessoa e mês", () => {
  const all = monthlySummary(transactions, "2026-08", "all");
  const kim = monthlySummary(transactions, "2026-08", "kim");
  assert.equal(all.incomeCents, 5_029_868);
  assert.equal(all.expenseCents, 580_000);
  assert.equal(kim.incomeCents, 4_000_000);
  assert.equal(kim.expenseCents, 500_000);
});

test("só classifica uma saída como fixa após três meses consecutivos", () => {
  const recurring = [
    movement("jan", "kim", "expense", 10_000, "2026-01-10", "Netflix"),
    movement("feb", "kim", "expense", 10_000, "2026-02-10", "Netflix"),
    movement("mar", "kim", "expense", 10_000, "2026-03-10", "Netflix"),
  ];
  const twoMonths = classifyFixedExpenses(recurring.slice(0, 2));
  assert.equal(twoMonths.get("feb")?.isFixedRecurring, false);

  const threeMonths = classifyFixedExpenses(recurring);
  assert.equal(threeMonths.get("jan")?.isFixedRecurring, true);
  assert.equal(threeMonths.get("mar")?.recurrenceStreak, 3);

  const brokenSequence = classifyFixedExpenses([
    ...recurring.slice(0, 2),
    movement("apr", "kim", "expense", 10_000, "2026-04-10", "Netflix"),
  ]);
  assert.equal(brokenSequence.get("apr")?.isFixedRecurring, false);
});

test("pagamentos vinculados reduzem dívidas e acumulam metas", () => {
  const debtPayment = {
    ...movement("p1", "kim", "expense", 30_000, "2026-08-20"),
    debtId: "debt-1",
  };
  const goalTransfer = {
    ...movement("g1", "kim", "transfer", 50_000, "2026-08-21"),
    goalId: "goal-1",
  };
  assert.equal(debtPaidCents("debt-1", [debtPayment]), 30_000);
  assert.equal(goalSavedCents("goal-1", [goalTransfer]), 50_000);
});
