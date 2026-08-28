import type {
  ExtractedFinancialDocument,
  ExtractedTransaction,
} from "./document-extractor";

const monthNumbers: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

const detailBoundary =
  /^(?:ELIAKIM|Despesas da fatura|CART[AÃ]O|Data Movimenta[cç][aã]o|Total CART[AÃ]O)/i;

function normalizeMerchant(description: string) {
  return description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(parc(?:ela)?|compra|pagamento|debito|credito)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function brlCents(value: string) {
  const number = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function isoNumericDate(value: string) {
  const [day, month, year] = value.split("/").map(Number);
  if (!day || !month || !year) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function itemDate(day: string, monthName: string, year: string) {
  const month = monthNumbers[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function categoryFor(description: string) {
  if (/pagamento|deb aut parcial/i.test(description)) return "Transferências";
  if (/ifd\*|sushi|pizza|mercado|sacolao|batata|rango|restaur/i.test(description)) {
    return "Alimentação";
  }
  if (/uber|estacionamento|latam|petrobras/i.test(description)) return "Transporte";
  if (/raia|drogaria|farmace|totalpass/i.test(description)) return "Saúde";
  if (/vivo|leroy|condom|eletronicos/i.test(description)) return "Moradia";
  if (/apple|google one|canva|vercel|openai|supabase|assinet/i.test(description)) {
    return "Assinaturas";
  }
  if (/iof|rotativo|encargos/i.test(description)) return "Impostos";
  return "Outros";
}

function cleanDescription(value: string) {
  return value
    .replace(/\s*-\s*\+?\s*R\$\s*[\d.]+,\d{2}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function parseInterCreditCardInvoice(
  text: string,
): ExtractedFinancialDocument | null {
  if (
    !/Resumo da fatura/i.test(text) ||
    !/Limite de cr[eé]dito total/i.test(text) ||
    !/Despesas da fatura/i.test(text)
  ) {
    return null;
  }

  const totalValue = text.match(
    /Total da sua fatura\s*R\$\s*([\d.]+,\d{2})/i,
  )?.[1];
  const dueDateValue = text.match(
    /Data de Vencimento\s*(\d{2}\/\d{2}\/\d{4})/i,
  )?.[1];
  const dueDate = dueDateValue ? isoNumericDate(dueDateValue) : null;
  const totalCents = totalValue ? brlCents(totalValue) : 0;
  if (!dueDate || !totalCents) return null;

  const chargesValue = text.match(
    /DESPESAS DO M[EÊ]S\s*R\$\s*([\d.]+,\d{2})/i,
  )?.[1];
  const anticipatedValue = text.match(
    /VALOR ANTECIPADO\s*R\$\s*([\d.]+,\d{2})/i,
  )?.[1];
  const detailStart = text.indexOf("Despesas da fatura");
  const detailEnd = text.indexOf("Limite de crédito total:", detailStart);
  if (detailStart < 0 || detailEnd < 0) return null;

  const lines = text
    .slice(detailStart, detailEnd)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const startIndexes = lines.flatMap((line, index) =>
    /^\d{1,2} de [a-zç]{3}\. \d{4} /i.test(line) ? [index] : [],
  );
  const items: ExtractedTransaction[] = [];

  startIndexes.forEach((startIndex, itemIndex) => {
    const block = lines.slice(
      startIndex,
      startIndexes[itemIndex + 1] ?? lines.length,
    );
    const boundary = block.findIndex(
      (line, index) => index > 0 && detailBoundary.test(line),
    );
    const relevant = boundary > 0 ? block.slice(0, boundary) : block;
    const firstLine = relevant[0] ?? "";
    const dateMatch = firstLine.match(
      /^(\d{1,2}) de ([a-zç]{3})\. (\d{4}) (.+)$/i,
    );
    if (!dateMatch) return;

    const transactionDate = itemDate(dateMatch[1], dateMatch[2], dateMatch[3]);
    const amounts = [
      ...relevant
        .join(" ")
        .matchAll(/([+-])?\s*R\$\s*([\d.]+,\d{2})/gi),
    ];
    const amount = amounts.at(-1);
    const description = cleanDescription(dateMatch[4]);
    const amountCents = amount ? brlCents(amount[2]) : 0;
    if (!transactionDate || !description || !amountCents) return;

    const installment = description.match(
      /(?:Parcela\s*)?(\d{1,2}) de (\d{1,2})\b/i,
    );
    const isCredit = amount?.[1] === "+";
    items.push({
      date: transactionDate,
      description,
      amountCents,
      kind: isCredit ? "transfer" : "expense",
      category: categoryFor(description),
      merchant: normalizeMerchant(description),
      installmentCurrent: installment ? Number(installment[1]) : null,
      installmentTotal: installment ? Number(installment[2]) : null,
      confidence: 0.99,
    });
  });

  if (!items.length) return null;
  const referenceMonth = dueDate.slice(0, 7);
  return {
    institution: "Banco Inter",
    periodStart: `${referenceMonth}-01`,
    periodEnd: dueDate,
    transactions: [
      {
        date: dueDate,
        description: "Fatura Banco Inter",
        amountCents: totalCents,
        kind: "expense",
        category: "Dívidas",
        merchant: "banco inter",
        installmentCurrent: null,
        installmentTotal: null,
        confidence: 0.99,
      },
    ],
    balances: [],
    invoice: {
      totalCents,
      dueDate,
      chargesTotalCents: chargesValue ? brlCents(chargesValue) : null,
      anticipatedCreditCents: anticipatedValue
        ? brlCents(anticipatedValue)
        : null,
      items,
    },
    financing: null,
  };
}
