import OpenAI from "openai";
import { extractText, getDocumentProxy } from "unpdf";
import { parseInvoiceText } from "./invoice-parser";
import { normalizeMerchant } from "@/lib/finance-domain";

export type DocumentType =
  | "bank_statement"
  | "credit_card_invoice"
  | "investment_statement"
  | "insurance_statement"
  | "pension_statement"
  | "other";

export type ExtractedTransaction = {
  date: string;
  description: string;
  amountCents: number;
  kind: "income" | "expense" | "transfer";
  category: string;
  merchant: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  confidence: number;
};

export type ExtractedBalance = {
  name: string;
  institution: string;
  accountType:
    | "checking"
    | "savings"
    | "investment"
    | "pension"
    | "insurance"
    | "cash"
    | "other";
  balanceCents: number;
  balanceDate: string;
};

export type ExtractedFinancialDocument = {
  institution: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: ExtractedTransaction[];
  balances: ExtractedBalance[];
};

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "institution",
    "periodStart",
    "periodEnd",
    "transactions",
    "balances",
  ],
  properties: {
    institution: { type: ["string", "null"] },
    periodStart: { type: ["string", "null"] },
    periodEnd: { type: ["string", "null"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "date",
          "description",
          "amountCents",
          "kind",
          "category",
          "merchant",
          "installmentCurrent",
          "installmentTotal",
          "confidence",
        ],
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          amountCents: { type: "integer", minimum: 0 },
          kind: { type: "string", enum: ["income", "expense", "transfer"] },
          category: { type: "string" },
          merchant: { type: "string" },
          installmentCurrent: { type: ["integer", "null"], minimum: 1 },
          installmentTotal: { type: ["integer", "null"], minimum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    balances: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "institution",
          "accountType",
          "balanceCents",
          "balanceDate",
        ],
        properties: {
          name: { type: "string" },
          institution: { type: "string" },
          accountType: {
            type: "string",
            enum: [
              "checking",
              "savings",
              "investment",
              "pension",
              "insurance",
              "cash",
              "other",
            ],
          },
          balanceCents: { type: "integer" },
          balanceDate: { type: "string" },
        },
      },
    },
  },
} as const;

const extractionInstructions = `Você extrai dados financeiros de documentos brasileiros.

Regras obrigatórias:
- Retorne todos os valores monetários em centavos inteiros, sem separadores.
- Retorne datas no formato YYYY-MM-DD.
- Entradas em conta são income; débitos e compras são expense; movimentações entre contas são transfer.
- Em faturas de cartão, extraia cada compra como expense e ignore linhas de total, limite, saldo anterior e pagamento da fatura.
- Em extratos, extraia todas as entradas, saídas e transferências, sem transformar saldo em transação.
- Em documentos de investimento, previdência e seguros, extraia o saldo atual em balances.
- Nunca invente datas, valores, contas ou transações. Se não estiver legível, omita o item.
- Use categorias curtas em português: Moradia, Alimentação, Transporte, Saúde, Educação, Lazer, Assinaturas, Impostos, Dívidas, Investimentos, Seguros, Transferências, Renda ou Outros.
- merchant deve ser o nome estável do estabelecimento ou contraparte, sem números de parcela, datas ou identificadores.
- confidence representa apenas a confiança na leitura daquele lançamento.`;

function cleanExtraction(value: ExtractedFinancialDocument) {
  return {
    institution: value.institution?.trim() || null,
    periodStart: value.periodStart || null,
    periodEnd: value.periodEnd || null,
    transactions: value.transactions
      .filter(
        (item) =>
          /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
          item.amountCents > 0 &&
          item.description.trim(),
      )
      .map((item) => ({
        ...item,
        description: item.description.trim().slice(0, 240),
        category: item.category.trim().slice(0, 80) || "Outros",
        merchant:
          normalizeMerchant(item.merchant || item.description) ||
          normalizeMerchant(item.description),
        confidence: Math.min(1, Math.max(0, item.confidence)),
      })),
    balances: value.balances
      .filter(
        (item) =>
          item.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(item.balanceDate),
      )
      .map((item) => ({
        ...item,
        name: item.name.trim().slice(0, 120),
        institution: item.institution.trim().slice(0, 120),
      })),
  } satisfies ExtractedFinancialDocument;
}

async function extractWithAI(
  bytes: Uint8Array,
  file: { name: string; type: string },
  documentType: DocumentType,
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.4-nano";
  const client = new OpenAI({ apiKey });
  const fileData = `data:${file.type || "application/pdf"};base64,${Buffer.from(bytes).toString("base64")}`;
  const response = await client.responses.create({
    model,
    store: false,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: file.name,
            file_data: fileData,
            detail: "high",
          },
          {
            type: "input_text",
            text: `${extractionInstructions}\n\nTipo informado pelo usuário: ${documentType}.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "financial_document_extraction",
        strict: true,
        schema: extractionSchema,
      },
    },
  });

  if (!response.output_text) throw new Error("A IA não retornou dados estruturados.");
  return {
    data: cleanExtraction(
      JSON.parse(response.output_text) as ExtractedFinancialDocument,
    ),
    model,
  };
}

async function deterministicExtraction(
  bytes: Uint8Array,
  file: { name: string; type: string },
  documentType: DocumentType,
  period: string,
) {
  let text = "";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } else {
    text = new TextDecoder("utf-8").decode(bytes);
  }

  const items = parseInvoiceText(text, period).map((item) => ({
    date: item.transactionDate,
    description: item.description,
    amountCents: item.amountCents,
    kind: documentType === "bank_statement" ? ("expense" as const) : ("expense" as const),
    category: item.category,
    merchant: normalizeMerchant(item.description),
    installmentCurrent: item.installmentCurrent,
    installmentTotal: item.installmentTotal,
    confidence: 0.55,
  }));

  return {
    institution: null,
    periodStart: `${period}-01`,
    periodEnd: null,
    transactions: items,
    balances: [],
  } satisfies ExtractedFinancialDocument;
}

export async function extractFinancialDocument(
  bytes: Uint8Array,
  file: { name: string; type: string },
  documentType: DocumentType,
  period: string,
) {
  const ai = await extractWithAI(bytes, file, documentType);
  if (ai) return { ...ai, mode: "ai" as const };
  if (documentType !== "credit_card_invoice") {
    throw new Error(
      "A leitura inteligente ainda não está configurada no servidor. Defina OPENAI_API_KEY para importar este documento.",
    );
  }
  return {
    data: await deterministicExtraction(bytes, file, documentType, period),
    model: null,
    mode: "deterministic" as const,
  };
}
