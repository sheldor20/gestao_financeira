import test from "node:test";
import assert from "node:assert/strict";
import { parseInterCreditCardInvoice } from "../app/lib/inter-credit-card-parser.ts";

const invoiceText = `
Resumo da fatura
Total da sua fatura
R$ 19.749,59
Limite de crédito total
R$ 49.650,00
Data de Vencimento
01/09/2026
DESPESAS DO MÊS
R$ 19.825,93
VALOR ANTECIPADO
R$ 76,34
Despesas da fatura
CARTÃO 5364****2916
Data Movimentação Beneficiário Valor
11 de jun. 2026 PIX CRED PARCELADO (Parcela 03 de 04)
Principal (R$ 491,79) + Juros (R$ 81,73)
M SILVESTRE R$ 573,52
11 de jun. 2026 PIX CRED PARCELADO (Parcela 03 de 04)
Principal (R$ 491,79) + Juros (R$ 81,73)
M SILVESTRE R$ 573,52
03 de ago. 2026 PAGAMENTO DE FATURA - + R$ 10.000,00
26 de jul. 2026 VERCEL INC.
Valor e símbolo da moeda de origem: 20,00 USD
Cotação do dólar americano: R$ 5,3194
- R$ 106,39
Total CARTÃO 5364****2916 R$ 19.825,93
Limite de crédito total:
R$ 49.650,00
Utilizado:
R$ 42.642,37
Disponível:
R$ 7.007,63
Próxima fatura
Movimentação Valor
TT TECNICA (Parcela 10 de 10) R$ 175,20
`;

test("lê a fatura Inter completa sem transformar limite em patrimônio", () => {
  const document = parseInterCreditCardInvoice(invoiceText);

  assert.ok(document?.invoice);
  assert.equal(document.institution, "Banco Inter");
  assert.equal(document.balances.length, 0);
  assert.equal(document.transactions.length, 1);
  assert.equal(document.transactions[0]?.amountCents, 1_974_959);
  assert.equal(document.transactions[0]?.date, "2026-09-01");
  assert.equal(document.invoice.totalCents, 1_974_959);
  assert.equal(document.invoice.chargesTotalCents, 1_982_593);
  assert.equal(document.invoice.anticipatedCreditCents, 7_634);
  assert.equal(document.invoice.items.length, 4);
  assert.equal(document.invoice.items[0]?.amountCents, 57_352);
  assert.equal(document.invoice.items[1]?.amountCents, 57_352);
  assert.equal(document.invoice.items[2]?.kind, "transfer");
  assert.equal(document.invoice.items[3]?.amountCents, 10_639);
  assert.ok(
    document.invoice.items.every(
      (item) => !/TT TECNICA|49\.650|42\.642|7\.007/.test(item.description),
    ),
  );
});

test("ignora documentos que não sejam fatura do Inter", () => {
  assert.equal(parseInterCreditCardInvoice("Extrato bancário comum"), null);
});
