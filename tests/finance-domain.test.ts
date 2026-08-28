import test from "node:test";
import assert from "node:assert/strict";
import {
  customSplit,
  installmentRemaining,
  monthlySummary,
  proportionalSplit,
} from "../lib/finance-domain.ts";
import { initialFinanceState } from "../lib/mock-finance.ts";

test("divide R$ 5.000 proporcionalmente às rendas informadas", () => {
  const split = proportionalSplit(500_000, initialFinanceState.people);
  assert.equal(split.kimCents, 397_625);
  assert.equal(split.alexandreCents, 102_375);
  assert.ok(Math.abs(split.kimPercent - 79.525) < 0.01);
});

test("permite divisão igual ou personalizada", () => {
  assert.deepEqual(
    customSplit(
      100_000,
      { method: "equal", kimPercent: 79.52, alexandrePercent: 20.48 },
      initialFinanceState.people,
    ),
    {
      kimCents: 50_000,
      alexandreCents: 50_000,
      kimPercent: 50,
      alexandrePercent: 50,
    },
  );
  assert.deepEqual(
    customSplit(
      100_000,
      { method: "custom", kimPercent: 70, alexandrePercent: 30 },
      initialFinanceState.people,
    ),
    {
      kimCents: 70_000,
      alexandreCents: 30_000,
      kimPercent: 70,
      alexandrePercent: 30,
    },
  );
});

test("consolida entradas e saídas respeitando pessoa e mês", () => {
  const all = monthlySummary(
    initialFinanceState.transactions,
    "2026-08",
    "all",
  );
  const kim = monthlySummary(
    initialFinanceState.transactions,
    "2026-08",
    "kim",
  );
  assert.equal(all.incomeCents, 5_029_868);
  assert.equal(kim.incomeCents, 4_000_000);
  assert.ok(all.expenseCents > kim.expenseCents);
});

test("calcula o saldo restante de uma dívida parcelada", () => {
  assert.equal(
    installmentRemaining({
      id: "d",
      owner: "joint",
      description: "Teste",
      totalCents: 1_200_000,
      installmentCents: 100_000,
      installmentCurrent: 4,
      installmentTotal: 12,
      dueDate: "2026-09-01",
      status: "pending",
      category: "Outros",
    }),
    900_000,
  );
});
