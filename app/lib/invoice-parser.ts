export type ParsedInvoiceItem = {
  description: string;
  amountCents: number;
  transactionDate: string;
  category: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
};

const categoryRules: Array<[string, RegExp]> = [
  [
    "Alimentação",
    /ifood|rappi|restaur|lanch|padaria|mercado|supermerc|carrefour|pao de acucar|madero|outback|cafe/i,
  ],
  [
    "Transporte",
    /uber|99app|cabify|posto|shell|ipiranga|estacion|sem parar|movida|localiza|azul|latam|gol /i,
  ],
  [
    "Saúde",
    /farmac|drog|hospital|clinica|laborat|totalpass|smart fit|wellhub|psicol/i,
  ],
  [
    "Casa e serviços",
    /vivo|claro|tim |enel|sabesp|energia|internet|condominio|gas /i,
  ],
  [
    "Assinaturas",
    /netflix|spotify|apple|google|canva|amazon prime|disney|hbo|max |youtube|vercel|supabase|hostinger/i,
  ],
  [
    "Compras",
    /amazon|mercado livre|shopee|magalu|renner|riachuelo|zara|centauro|c&a/i,
  ],
  ["Lazer", /cinema|ingresso|teatro|show|steam|playstation|xbox|parque|hotel/i],
  ["Educação", /curso|escola|faculdade|udemy|alura|livraria|kindle/i],
  ["Profissional", /contabil|adobe|microsoft|notion|slack|linkedin/i],
];

function categoryFor(description: string) {
  return (
    categoryRules.find(([, rule]) => rule.test(description))?.[0] ?? "Outros"
  );
}

function amountToCents(raw: string) {
  const normalized = raw
    .replace(/R\$\s?/gi, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number.parseFloat(normalized);
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : 0;
}

function isoDate(day: number, month: number, year: number) {
  const fullYear = year < 100 ? 2000 + year : year;
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseInvoiceText(
  text: string,
  period: string,
): ParsedInvoiceItem[] {
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const seen = new Set<string>();
  const items: ParsedInvoiceItem[] = [];

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, " ").trim();
    if (
      line.length < 6 ||
      /pagamento recebido|saldo anterior|total da fatura|limite dispon[ií]vel|encargos|melhor dia/i.test(
        line,
      )
    )
      continue;

    const dateMatch = line.match(
      /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/,
    );
    if (!dateMatch) continue;
    const amountMatches = [
      ...line.matchAll(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}/g),
    ];
    if (!amountMatches.length) continue;

    const rawAmount = amountMatches.at(-1)?.[0] ?? "";
    const amountCents = amountToCents(rawAmount);
    if (!amountCents || amountCents > 100_000_000) continue;

    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = dateMatch[3] ? Number(dateMatch[3]) : periodYear;
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;

    const installment = line.match(
      /\b(\d{1,2})\s*[-/]\s*(\d{1,2})\b(?!.*\d{2},\d{2})/,
    );
    const description =
      line
        .replace(dateMatch[0], "")
        .replace(rawAmount, "")
        .replace(/^[,;|\s-]+|[,;|\s-]+$/g, "")
        .replace(/\s*[;|]\s*/g, " ")
        .slice(0, 120) || "Compra no cartão";
    const transactionDate = isoDate(day, month, year || periodYear);
    const key = `${transactionDate}-${description}-${amountCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      description,
      amountCents,
      transactionDate: transactionDate.includes("NaN")
        ? `${periodYear}-${String(periodMonth).padStart(2, "0")}-01`
        : transactionDate,
      category: categoryFor(description),
      installmentCurrent: installment ? Number(installment[1]) : null,
      installmentTotal: installment ? Number(installment[2]) : null,
    });
  }
  return items;
}
