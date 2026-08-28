import test from "node:test";
import assert from "node:assert/strict";
import {
  accountTotals,
  classifyFixedExpenses,
  debtPaidCents,
  documentTransactionCount,
  goalSavedCents,
  isNonAssetBalanceName,
  monthlyIncomeByPerson,
  monthlySummary,
  openInstallmentsTotalCents,
  proportionalSplit,
  transactionsWithDebtInstallments,
  transactionsWithInvoiceDetails,
  type FinancialDocument,
  type Account,
  type Asset,
  type Debt,
  type Transaction,
} from "../lib/finance-domain.ts";
import { normalizeFinancialDocumentContentType } from "../lib/document-upload.ts";
import { getAuthorizedUser } from "../lib/authorized-users.ts";
import { financingContractKey } from "../lib/financing.ts";

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
    countsInCashflow: true,
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

const financingDebt: Debt = {
  id: "financing-1",
  owner: "kim",
  description: "Financiamento do apartamento",
  totalCents: 23_600_000,
  installmentCents: 258_419,
  installmentCurrent: 64,
  installmentTotal: 110,
  dueDate: "2026-09-30",
  status: "pending",
  category: "Dívidas",
  debtType: "financing",
  institution: "Itaú",
  outstandingCents: 0,
  interestRateAnnual: null,
  lastStatementDate: "2026-08-27",
  lastAmortizationCents: 0,
  sourceDocumentId: "document-financing",
  installments: [
    {
      id: "installment-64",
      installmentNumber: 64,
      dueDate: "2026-09-30",
      amountCents: 258_419,
      principalCents: 74_549,
      interestCents: null,
      feesCents: null,
      remainingBalanceCents: null,
      status: "pending",
      sourceDocumentId: "document-financing",
    },
    {
      id: "installment-65",
      installmentNumber: 65,
      dueDate: "2026-10-30",
      amountCents: 257_834,
      principalCents: 74_549,
      interestCents: null,
      feesCents: null,
      remainingBalanceCents: null,
      status: "pending",
      sourceDocumentId: "document-financing",
    },
  ],
  snapshots: [],
};

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

test("mostra itens da fatura sem somá-los outra vez na saída mensal", () => {
  const invoiceTotal = {
    ...movement(
      "invoice-total",
      "kim",
      "expense",
      1_974_959,
      "2026-09-01",
      "Fatura Banco Inter",
    ),
    source: "card_invoice" as const,
    sourceDocumentId: "invoice-document",
  };
  const document: FinancialDocument = {
    id: "invoice-document",
    owner: "kim",
    documentType: "credit_card_invoice",
    filename: "Fatura.pdf",
    institution: "Banco Inter",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-01",
    status: "applied",
    extractionMode: "deterministic",
    itemCount: 2,
    createdAt: "2026-08-28T12:00:00Z",
    invoiceItems: [
      {
        date: "2026-09-01",
        description: "Compra A",
        amountCents: 1_000_000,
        kind: "expense",
        category: "Outros",
        merchant: "compra a",
        installmentCurrent: null,
        installmentTotal: null,
        confidence: 0.99,
      },
      {
        date: "2026-09-01",
        description: "Compra B",
        amountCents: 982_593,
        kind: "expense",
        category: "Outros",
        merchant: "compra b",
        installmentCurrent: null,
        installmentTotal: null,
        confidence: 0.99,
      },
    ],
  };
  const withDetails = transactionsWithInvoiceDetails([invoiceTotal], [document]);
  const summary = monthlySummary(withDetails, "2026-09", "all");

  assert.equal(summary.expenseCents, 1_974_959);
  assert.equal(summary.visible.length, 3);
  assert.equal(summary.cashflow.length, 1);
  assert.equal(
    withDetails.filter((item) => item.source === "invoice_detail").length,
    2,
  );
});

test("soma as parcelas abertas como total devido do financiamento", () => {
  assert.equal(openInstallmentsTotalCents(financingDebt), 516_253);
});

test("leva cada parcela aberta para as saídas do mês de vencimento", () => {
  const withInstallments = transactionsWithDebtInstallments([], [financingDebt]);

  assert.equal(
    monthlySummary(withInstallments, "2026-09", "all").expenseCents,
    258_419,
  );
  assert.equal(
    monthlySummary(withInstallments, "2026-10", "all").expenseCents,
    257_834,
  );
  assert.equal(withInstallments[0]?.source, "debt_installment");
  assert.equal(withInstallments[0]?.status, "scheduled");
});

test("substitui a parcela prevista por um pagamento real vinculado", () => {
  const payment = {
    ...movement("paid-64", "kim", "expense", 258_419, "2026-09-30"),
    debtId: financingDebt.id,
  };
  const withInstallments = transactionsWithDebtInstallments(
    [payment],
    [financingDebt],
  );

  assert.equal(
    monthlySummary(withInstallments, "2026-09", "all").expenseCents,
    258_419,
  );
  assert.equal(
    withInstallments.filter((item) =>
      item.transactionDate.startsWith("2026-09"),
    ).length,
    1,
  );
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

test("conta somente os lançamentos vinculados ao documento excluído", () => {
  const fromDocument = [
    { ...transactions[0], id: "doc-1", sourceDocumentId: "document-1" },
    { ...transactions[1], id: "doc-2", sourceDocumentId: "document-1" },
    { ...transactions[2], id: "doc-3", sourceDocumentId: "document-2" },
    transactions[3],
  ];

  assert.equal(documentTransactionCount("document-1", fromDocument), 2);
  assert.equal(documentTransactionCount("document-2", fromDocument), 1);
  assert.equal(documentTransactionCount("missing", fromDocument), 0);
});

test("normaliza o tipo de arquivo antes de enviar ao bucket privado", () => {
  assert.equal(
    normalizeFinancialDocumentContentType({
      name: "fatura.csv",
      type: "application/vnd.ms-excel",
    }),
    "text/csv",
  );
  assert.equal(
    normalizeFinancialDocumentContentType({ name: "extrato.pdf", type: "" }),
    "application/pdf",
  );
  assert.equal(
    normalizeFinancialDocumentContentType({ name: "foto.png", type: "image/png" }),
    null,
  );
});

test("vincula somente os dois e-mails às identidades corretas", () => {
  assert.deepEqual(getAuthorizedUser("ELIAKIM.MINICHIELLO@GMAIL.COM"), {
    email: "eliakim.minichiello@gmail.com",
    person: "kim",
    name: "Kim",
  });
  assert.equal(getAuthorizedUser("pantoja.smp@gmail.com")?.person, "alexandre");
  assert.equal(getAuthorizedUser("outra-pessoa@example.com"), null);
});

test("reconhece o mesmo financiamento em PDFs atualizados", () => {
  const first = financingContractKey({
    institution: "Banco Exemplo S.A.",
    contractReference: "Contrato 001.234-5",
    description: "Financiamento apartamento",
    owner: "joint",
  });
  const afterAmortization = financingContractKey({
    institution: "BANCO EXEMPLO",
    contractReference: "0012345",
    description: "Crédito imobiliário - saldo atualizado",
    owner: "joint",
  });
  const anotherContract = financingContractKey({
    institution: "Banco Exemplo",
    contractReference: "0012346",
    description: "Financiamento apartamento",
    owner: "joint",
  });

  assert.equal(first, afterAmortization);
  assert.notEqual(first, anotherContract);
});

test("não agrupa contratos sem número que tenham a mesma descrição", () => {
  const first = financingContractKey({
    institution: "Itaú",
    contractReference: null,
    description: "Antecipação FGTS",
    owner: "alexandre",
    fallbackIdentity: "Antecipação FGTS:795290:2023-01-01:2032-01-01",
  });
  const second = financingContractKey({
    institution: "Itaú",
    contractReference: null,
    description: "Antecipação FGTS",
    owner: "alexandre",
    fallbackIdentity: "Antecipação FGTS:609020:2025-01-01:2034-01-01",
  });

  assert.notEqual(first, second);
});

test("não considera limite de crédito ou saldo devedor como patrimônio", () => {
  const accounts: Account[] = [
    {
      id: "credit-limit",
      owner: "kim",
      name: "Limite de crédito total",
      institution: "Banco Inter",
      type: "other",
      balanceCents: 4_965_000,
      includeInNetWorth: true,
      balanceDate: "2026-09-01",
      sourceDocumentId: "invoice",
    },
    {
      id: "investment",
      owner: "kim",
      name: "Reserva de investimentos",
      institution: "Banco",
      type: "investment",
      balanceCents: 1_000_000,
      includeInNetWorth: true,
      balanceDate: "2026-08-28",
      sourceDocumentId: "statement",
    },
  ];
  const assets: Asset[] = [
    {
      id: "apartment",
      owner: "kim",
      name: "Apartamento financiado",
      type: "real_estate",
      totalValueCents: 23_600_000,
      valuationDate: "2026-08-27",
      valueSource: "financed_amount",
      institution: "Itaú",
      debtId: "financing",
      sourceDocumentId: "financing-pdf",
    },
  ];

  assert.equal(isNonAssetBalanceName("Limite de crédito total"), true);
  assert.equal(
    isNonAssetBalanceName("Saldo devedor (Sistema Financeiro Habitacional)"),
    true,
  );
  assert.deepEqual(accountTotals(accounts, "all", assets), {
    netWorthCents: 24_600_000,
    financialCents: 1_000_000,
    assetsCents: 23_600_000,
    insuredCents: 0,
  });
});
