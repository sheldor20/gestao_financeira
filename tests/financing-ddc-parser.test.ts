import test from "node:test";
import assert from "node:assert/strict";
import { parseDdcFinancingDocument } from "../app/lib/financing-ddc-parser.ts";

const ddcText = `
Demonstrativo Descritivo de Crédito (DDC) Emitido em 27.8.2026 às 20:39:3
Prazo total operação 360 Taxa de Juros (mensal) 0,774476900%
Prazo remanescente 308 Taxa de Juros (anual) 9,293722800%
Data do vencimento da última parcela 30/03/2052 Número do contrato 10172998909
Operação: Implantacao de contrato - Esteira Data: 30/03/2022 Valor da Operação: 236.000,00
52 30/07/2026 744,22 1.781,01 1,001711 23,71 17,56 0,00 25,00 0,00 0,00 0,00 0,00 1,001711 0,00 Paga 2.591,50 229.219,37
53 30/08/2026 745,49 1.778,29 1,001710 23,67 17,59 0,00 25,00 0,00 0,00 0,00 0,00 1,001710 0,00 Emitida 2.590,04 228.865,85
54 30/09/2026 745,49 1.772,51 1,000000 23,60 17,59 0,00 25,00 0,00 0,00 0,00 0,00 1,000000 0,00 Projetada 2.584,19 228.120,36
55 30/10/2026 745,49 1.766,74 1,000000 23,52 17,59 0,00 25,00 0,00 0,00 0,00 0,00 1,000000 0,00 Vencida 2.578,34 227.374,87
`;

test("lê todas as parcelas não pagas do DDC do Itaú", () => {
  const document = parseDdcFinancingDocument(ddcText);
  const financing = document?.financings[0];

  assert.ok(financing);
  assert.equal(document?.institution, "Itaú");
  assert.equal(financing.contractReference, "10172998909");
  assert.equal(financing.statementDate, "2026-08-27");
  assert.equal(financing.originalAmountCents, 23_600_000);
  assert.equal(financing.outstandingAmountCents, 22_886_585);
  assert.equal(financing.installmentCurrent, 53);
  assert.equal(financing.installmentTotal, 360);
  assert.equal(financing.nextDueDate, "2026-08-30");
  assert.equal(financing.interestRateAnnualPercent, 9.2937228);
  assert.equal(financing.assetDescription, "Apartamento financiado");
  assert.equal(financing.assetValueCents, 23_600_000);
  assert.equal(financing.assetValueSource, "financed_amount");
  assert.equal(financing.installments.length, 3);
  assert.deepEqual(
    financing.installments.map((item) => item.status),
    ["pending", "pending", "overdue"],
  );
  assert.equal(
    financing.installments.reduce((sum, item) => sum + item.amountCents, 0),
    775_257,
  );
});

test("não tenta interpretar um PDF que não seja DDC", () => {
  assert.equal(parseDdcFinancingDocument("Extrato bancário comum"), null);
});
