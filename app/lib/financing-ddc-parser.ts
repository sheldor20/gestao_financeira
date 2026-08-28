import type {
  ExtractedFinancialDocument,
  ExtractedFinancingInstallment,
} from "./document-extractor";

const installmentRowPattern =
  /^(\d{1,4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(Paga|Quitada|Emitida|Projetada|Vencida|Em atraso|Em aberto|Parcialmente paga)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/i;

function brlCents(value: string) {
  return Math.round(
    Number(value.replace(/\./g, "").replace(",", ".")) * 100,
  );
}

function decimal(value: string) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function isoDate(value: string) {
  const [day, month, year] = value.split(/[/.]/).map(Number);
  if (!day || !month || !year) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function installmentStatus(
  value: string,
): ExtractedFinancingInstallment["status"] {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("parcial")) return "partially_paid";
  if (normalized.includes("vencida") || normalized.includes("atraso")) {
    return "overdue";
  }
  if (normalized.includes("paga") || normalized.includes("quitada")) {
    return "paid";
  }
  return "pending";
}

function matchValue(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1] ?? null;
}

export function parseDdcFinancingDocument(
  text: string,
): ExtractedFinancialDocument | null {
  if (!/Demonstrativo Descritivo de Cr[eé]dito\s*\(DDC\)/i.test(text)) {
    return null;
  }

  const allInstallments = text
    .split(/\r?\n/)
    .map((line) => line.trim().match(installmentRowPattern))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .flatMap((match) => {
      const columns = match[3].trim().split(/\s+/);
      const principalCents = columns[0] ? brlCents(columns[0]) : null;
      const interestCents = columns[1] ? brlCents(columns[1]) : null;
      const amountCents = brlCents(match[5]);
      const status = installmentStatus(match[4]);
      const dueDate = isoDate(match[2]);
      if (!dueDate) return [];

      return [
        {
          installmentNumber: Number(match[1]),
          dueDate,
          amountCents,
          principalCents,
          interestCents,
          feesCents:
            principalCents !== null && interestCents !== null
              ? Math.max(0, amountCents - principalCents - interestCents)
              : null,
          remainingBalanceCents: brlCents(match[6]),
          status,
        } satisfies ExtractedFinancingInstallment,
      ];
    });

  const installments = allInstallments
    .filter((installment) => installment.status !== "paid")
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  if (!installments.length) return null;

  const firstInstallment = installments[0];
  const statementDateValue = matchValue(
    text,
    /Emitido em\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i,
  );
  const originalAmount = matchValue(
    text,
    /Opera[cç][aã]o:\s*Implanta[^\n]*?Valor da Opera[cç][aã]o:\s*([\d.]+,\d{2})/i,
  );
  const annualInterest = matchValue(
    text,
    /Taxa de Juros\s*\(anual\)\s*([\d.,]+)%/i,
  );
  const installmentTotalValue = matchValue(
    text,
    /Prazo total opera[cç][aã]o\s+(\d+)/i,
  );
  const contractReference = matchValue(
    text,
    /N[uú]mero do contrato\s+([\d./-]+)/i,
  );
  const statementDate = statementDateValue
    ? isoDate(statementDateValue)
    : null;

  return {
    institution: "Itaú",
    periodStart: statementDate,
    periodEnd: statementDate,
    transactions: [],
    balances: [],
    invoice: null,
    financing: {
      contractReference,
      description: "Financiamento imobiliário",
      institution: "Itaú",
      statementDate,
      originalAmountCents: originalAmount ? brlCents(originalAmount) : null,
      outstandingAmountCents: firstInstallment.remainingBalanceCents,
      installmentAmountCents: firstInstallment.amountCents,
      installmentCurrent: firstInstallment.installmentNumber,
      installmentTotal: installmentTotalValue
        ? Number(installmentTotalValue)
        : Math.max(...allInstallments.map((item) => item.installmentNumber)),
      nextDueDate: firstInstallment.dueDate,
      interestRateAnnualPercent: annualInterest
        ? decimal(annualInterest)
        : null,
      explicitAmortizationCents: null,
      installments,
    },
  };
}
