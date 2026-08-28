import OpenAI from "openai";
import { extractText, getDocumentProxy } from "unpdf";
import { parseDdcFinancingDocument } from "./financing-ddc-parser";
import { parseInterCreditCardInvoice } from "./inter-credit-card-parser";
import { parseInvoiceText } from "./invoice-parser";
import {
  isNonAssetBalanceName,
  normalizeMerchant,
} from "@/lib/finance-domain";

export type DocumentType =
  | "bank_statement"
  | "credit_card_invoice"
  | "financing_statement"
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

export type ExtractedFinancingInstallment = {
  installmentNumber: number;
  dueDate: string;
  amountCents: number;
  principalCents: number | null;
  interestCents: number | null;
  feesCents: number | null;
  remainingBalanceCents: number | null;
  status: "pending" | "paid" | "overdue" | "partially_paid";
};

export type ExtractedFinancing = {
  contractReference: string | null;
  description: string;
  institution: string | null;
  statementDate: string | null;
  originalAmountCents: number | null;
  outstandingAmountCents: number | null;
  installmentAmountCents: number | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  nextDueDate: string | null;
  interestRateAnnualPercent: number | null;
  explicitAmortizationCents: number | null;
  assetDescription: string | null;
  assetValueCents: number | null;
  assetValueSource:
    | "property_value"
    | "purchase_price"
    | "financed_amount"
    | null;
  installments: ExtractedFinancingInstallment[];
};

export type ExtractedInvoice = {
  totalCents: number;
  dueDate: string;
  chargesTotalCents: number | null;
  anticipatedCreditCents: number | null;
  items: ExtractedTransaction[];
};

export type ExtractedFinancialDocument = {
  institution: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactions: ExtractedTransaction[];
  balances: ExtractedBalance[];
  invoice: ExtractedInvoice | null;
  financings: ExtractedFinancing[];
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
    "invoice",
    "financings",
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
    invoice: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "totalCents",
            "dueDate",
            "chargesTotalCents",
            "anticipatedCreditCents",
            "items",
          ],
          properties: {
            totalCents: { type: "integer", minimum: 0 },
            dueDate: { type: "string" },
            chargesTotalCents: { type: ["integer", "null"], minimum: 0 },
            anticipatedCreditCents: {
              type: ["integer", "null"],
              minimum: 0,
            },
            items: {
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
                  kind: {
                    type: "string",
                    enum: ["income", "expense", "transfer"],
                  },
                  category: { type: "string" },
                  merchant: { type: "string" },
                  installmentCurrent: {
                    type: ["integer", "null"],
                    minimum: 1,
                  },
                  installmentTotal: {
                    type: ["integer", "null"],
                    minimum: 1,
                  },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
      ],
    },
    financings: {
      type: "array",
      items: {
          type: "object",
          additionalProperties: false,
          required: [
            "contractReference",
            "description",
            "institution",
            "statementDate",
            "originalAmountCents",
            "outstandingAmountCents",
            "installmentAmountCents",
            "installmentCurrent",
            "installmentTotal",
            "nextDueDate",
            "interestRateAnnualPercent",
            "explicitAmortizationCents",
            "assetDescription",
            "assetValueCents",
            "assetValueSource",
            "installments",
          ],
          properties: {
            contractReference: { type: ["string", "null"] },
            description: { type: "string" },
            institution: { type: ["string", "null"] },
            statementDate: { type: ["string", "null"] },
            originalAmountCents: { type: ["integer", "null"], minimum: 0 },
            outstandingAmountCents: { type: ["integer", "null"], minimum: 0 },
            installmentAmountCents: { type: ["integer", "null"], minimum: 0 },
            installmentCurrent: { type: ["integer", "null"], minimum: 1 },
            installmentTotal: { type: ["integer", "null"], minimum: 1 },
            nextDueDate: { type: ["string", "null"] },
            interestRateAnnualPercent: { type: ["number", "null"], minimum: 0 },
            explicitAmortizationCents: { type: ["integer", "null"], minimum: 0 },
            assetDescription: { type: ["string", "null"] },
            assetValueCents: { type: ["integer", "null"], minimum: 0 },
            assetValueSource: {
              type: ["string", "null"],
              enum: [
                "property_value",
                "purchase_price",
                "financed_amount",
                null,
              ],
            },
            installments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "installmentNumber",
                  "dueDate",
                  "amountCents",
                  "principalCents",
                  "interestCents",
                  "feesCents",
                  "remainingBalanceCents",
                  "status",
                ],
                properties: {
                  installmentNumber: { type: "integer", minimum: 1 },
                  dueDate: { type: "string" },
                  amountCents: { type: "integer", minimum: 0 },
                  principalCents: { type: ["integer", "null"], minimum: 0 },
                  interestCents: { type: ["integer", "null"], minimum: 0 },
                  feesCents: { type: ["integer", "null"], minimum: 0 },
                  remainingBalanceCents: { type: ["integer", "null"], minimum: 0 },
                  status: {
                    type: "string",
                    enum: ["pending", "paid", "overdue", "partially_paid"],
                  },
                },
              },
            },
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
- Em faturas de cartão, preencha invoice com o valor total a pagar, vencimento e todos os itens da seção da fatura atual. Não inclua compras da seção de próxima fatura.
- Em faturas de cartão, transactions deve conter somente uma expense com o valor total a pagar na data do vencimento. Os itens individuais ficam em invoice.items para não duplicar a saída.
- Limite total, limite utilizado, limite disponível, saldo de compras parceladas e opções de parcelamento nunca são balances nem transactions. Em faturas de cartão, balances deve ficar vazio.
- Pagamentos e créditos exibidos dentro da fatura devem ficar em invoice.items como transfer, pois não são renda. Compras e encargos ficam como expense.
- Em extratos, extraia todas as entradas, saídas e transferências, sem transformar saldo em transação.
- Em documentos de investimento, previdência e seguros, extraia o saldo atual em balances.
- O tipo informado pelo usuário é somente uma pista. Classifique pelo conteúdo real do documento.
- Em financiamentos, empréstimos e antecipações, preencha financings com um item separado para cada contrato ou operação exibida, mesmo quando o tipo informado for "other". Não transforme o cronograma em transactions e use invoice como null.
- Antecipação do FGTS é dívida/financiamento, nunca renda, saldo de conta ou patrimônio. "Total bloqueado FGTS" é o total da dívida; "total antecipado" é o valor original liberado.
- A description do financiamento deve ser curta e estável entre documentos, como "Financiamento do apartamento", sem saldo, parcela ou data.
- Em financiamento que esteja explicitamente ligado a um imóvel ou veículo, identifique também o bem: assetDescription deve descrevê-lo e assetValueCents deve usar, nesta ordem, valor do imóvel/avaliação, preço de compra ou valor originalmente financiado. Informe a origem em assetValueSource. Em empréstimos sem um bem real identificado, mantenha os três campos de asset como null. Nunca use saldo devedor como valor do bem.
- Use a referência do contrato exatamente como aparece. Se estiver mascarada, mantenha a máscara; nunca complete dígitos ausentes.
- explicitAmortizationCents só deve ser preenchido quando o documento disser explicitamente que houve amortização, liquidação antecipada ou redução extraordinária. Uma parcela normal não é amortização extraordinária.
- Em installments, separe principal, juros e encargos apenas quando estiverem discriminados; caso contrário use null. Não projete parcelas que não estejam no PDF. Quando o documento não informar o status, considere pagas as parcelas anteriores ao período de referência informado e pendentes as posteriores.
- Limites de crédito, limites de cartão, saldo devedor, saldo financiado, faturas e compras parceladas nunca são balances nem patrimônio.
- Nunca invente datas, valores, contas ou transações. Se não estiver legível, omita o item.
- Use categorias curtas em português: Moradia, Alimentação, Transporte, Saúde, Educação, Lazer, Assinaturas, Impostos, Dívidas, Investimentos, Seguros, Transferências, Renda ou Outros.
- merchant deve ser o nome estável do estabelecimento ou contraparte, sem números de parcela, datas ou identificadores.
- confidence representa apenas a confiança na leitura daquele lançamento.`;

function cleanTransactions(items: ExtractedTransaction[]) {
  return (items ?? [])
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
    }));
}

function cleanExtraction(value: ExtractedFinancialDocument) {
  const invoice =
    value.invoice &&
    value.invoice.totalCents > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.invoice.dueDate)
      ? {
          ...value.invoice,
          items: cleanTransactions(value.invoice.items),
        }
      : null;
  const financings = (value.financings ?? []).map((financing) => ({
    ...financing,
    contractReference:
      financing.contractReference?.trim().slice(0, 120) || null,
    description: financing.description.trim().slice(0, 240),
    institution: financing.institution?.trim().slice(0, 120) || null,
    assetDescription:
      financing.assetDescription?.trim().slice(0, 240) || null,
    statementDate:
      financing.statementDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(financing.statementDate)
        ? financing.statementDate
        : null,
    nextDueDate:
      financing.nextDueDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(financing.nextDueDate)
        ? financing.nextDueDate
        : null,
    installments: financing.installments
      .filter(
        (item) =>
          item.installmentNumber > 0 &&
          item.amountCents >= 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate),
      )
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
  }));
  const extractedTransactions = cleanTransactions(value.transactions);
  const transactions =
    invoice
      ? [
          {
            date: invoice.dueDate,
            description: `Fatura ${value.institution?.trim() || "do cartão"}`,
            amountCents: invoice.totalCents,
            kind: "expense" as const,
            category: "Dívidas",
            merchant: normalizeMerchant(value.institution || "fatura do cartão"),
            installmentCurrent: null,
            installmentTotal: null,
            confidence: 0.99,
          },
        ]
      : financings.length
        ? []
        : extractedTransactions;

  return {
    institution: value.institution?.trim() || null,
    periodStart: value.periodStart || null,
    periodEnd: value.periodEnd || null,
    transactions,
    balances: (invoice || financings.length
      ? []
      : value.balances)
      .filter(
        (item) =>
          item.name.trim() &&
          !isNonAssetBalanceName(item.name) &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.balanceDate),
      )
      .map((item) => ({
        ...item,
        name: item.name.trim().slice(0, 120),
        institution: item.institution.trim().slice(0, 120),
      })),
    invoice,
    financings,
  } satisfies ExtractedFinancialDocument;
}

async function extractWithAI(
  bytes: Uint8Array,
  file: { name: string; type: string },
  documentType: DocumentType,
  period: string,
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
            text: `${extractionInstructions}\n\nTipo informado pelo usuário: ${documentType}.\nPeríodo de referência informado: ${period}.`,
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
  const text = await extractDocumentText(bytes, file);

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
    invoice: null,
    financings: [],
  } satisfies ExtractedFinancialDocument;
}

async function extractDocumentText(
  bytes: Uint8Array,
  file: { name: string; type: string },
) {
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    const pdf = await getDocumentProxy(bytes);
    return (await extractText(pdf, { mergePages: true })).text;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function extractFinancialDocument(
  bytes: Uint8Array,
  file: { name: string; type: string },
  documentType: DocumentType,
  period: string,
) {
  try {
    const text = await extractDocumentText(bytes, file);
    const deterministic =
      parseDdcFinancingDocument(text) ?? parseInterCreditCardInvoice(text);
    if (deterministic) {
      return {
        data: cleanExtraction(deterministic),
        model: null,
        mode: "deterministic" as const,
      };
    }
  } catch {
    // Documentos sem texto legível seguem para a leitura visual inteligente.
  }

  const ai = await extractWithAI(bytes, file, documentType, period);
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
