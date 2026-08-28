import { createHash } from "node:crypto";
import {
  extractFinancialDocument,
  type DocumentType,
  type ExtractedFinancing,
  type ExtractedTransaction,
} from "@/app/lib/document-extractor";
import { financingContractKey } from "@/lib/financing";
import { normalizeFinancialDocumentContentType } from "@/lib/document-upload";
import {
  isNonAssetBalanceName,
  normalizeMerchant,
  type Owner,
} from "@/lib/finance-domain";
import { ownerColumnsForSelection } from "@/lib/owner-selection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const documentTypes = new Set<DocumentType>([
  "bank_statement",
  "credit_card_invoice",
  "financing_statement",
  "investment_statement",
  "insurance_statement",
  "pension_statement",
  "other",
]);

function financingRow(
  financing: ExtractedFinancing,
  owner: Owner,
  ownerData: { owner_scope: string; owner_member_id: string | null },
  period: string,
) {
  const firstInstallment = financing.installments[0] ?? null;
  const statementDate =
    financing.statementDate ?? financing.nextDueDate ?? `${period}-01`;
  const dueDate = financing.nextDueDate ?? firstInstallment?.dueDate;
  const outstandingCents = financing.outstandingAmountCents;

  if (outstandingCents === null) {
    throw new Error("Não encontrei o saldo devedor no PDF do financiamento.");
  }
  if (!dueDate) {
    throw new Error("Não encontrei o próximo vencimento no PDF do financiamento.");
  }

  const installmentCurrent =
    financing.installmentCurrent ?? firstInstallment?.installmentNumber ?? 1;
  const highestExtractedInstallment = financing.installments.reduce(
    (highest, item) => Math.max(highest, item.installmentNumber),
    installmentCurrent,
  );
  const installmentTotal = Math.max(
    installmentCurrent,
    highestExtractedInstallment,
    financing.installmentTotal ?? 0,
  );
  const installmentCents =
    financing.installmentAmountCents ?? firstInstallment?.amountCents ?? 0;
  const totalCents = Math.max(
    financing.originalAmountCents ?? outstandingCents,
    outstandingCents,
  );
  const description =
    financing.description ||
    `Financiamento ${financing.institution ?? "imobiliário"}`;
  const assetValueCents =
    financing.assetValueCents ?? financing.originalAmountCents;

  return {
    ...ownerData,
    description,
    institution: financing.institution,
    contract_reference: financing.contractReference,
    contract_key: financingContractKey({
      institution: financing.institution,
      contractReference: financing.contractReference,
      description,
      owner,
    }),
    total_cents: totalCents,
    outstanding_cents: outstandingCents,
    installment_cents: installmentCents,
    installment_current: installmentCurrent,
    installment_total: installmentTotal,
    due_date: dueDate,
    statement_date: statementDate,
    interest_rate_annual: financing.interestRateAnnualPercent,
    amortization_cents: financing.explicitAmortizationCents ?? 0,
    asset:
      assetValueCents && assetValueCents > 0
        ? {
            name: financing.assetDescription || "Apartamento financiado",
            asset_type: "real_estate",
            total_value_cents: assetValueCents,
            valuation_date: statementDate,
            value_source: financing.assetValueSource ?? "financed_amount",
          }
        : null,
    installments: financing.installments.map((item) => ({
      installment_number: item.installmentNumber,
      due_date: item.dueDate,
      amount_cents: item.amountCents,
      principal_cents: item.principalCents,
      interest_cents: item.interestCents,
      fees_cents: item.feesCents,
      remaining_balance_cents: item.remainingBalanceCents,
      status: item.status,
    })),
  };
}

function safeFilename(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(-140);
}

function matchesDescription(source: string, target: string) {
  const left = normalizeMerchant(source);
  const right = normalizeMerchant(target);
  return right.length >= 4 && (left.includes(right) || right.includes(left));
}

function findDebt(
  transaction: ExtractedTransaction,
  debts: Array<{ id: string; description: string }>,
) {
  const debtLike = /d[ií]vida|empr[eé]stimo|financiamento|parcela/i.test(
    `${transaction.category} ${transaction.description}`,
  );
  if (!debtLike) return null;
  return (
    debts.find((debt) =>
      matchesDescription(transaction.description, debt.description),
    )?.id ?? null
  );
}

function findGoal(
  transaction: ExtractedTransaction,
  goals: Array<{ id: string; name: string }>,
) {
  if (
    transaction.kind !== "transfer" &&
    !/investimento|reserva|aporte|previd[eê]ncia/i.test(transaction.category)
  ) {
    return null;
  }
  return (
    goals.find((goal) =>
      matchesDescription(transaction.description, goal.name),
    )?.id ?? null
  );
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Sessão expirada." }, { status: 401 });
  }

  let documentId = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const owner = String(form.get("owner") ?? "joint") as Owner;
    const documentType = String(
      form.get("documentType") ?? "other",
    ) as DocumentType;
    const period = String(
      form.get("period") ?? new Date().toISOString().slice(0, 7),
    );
    const accountId = String(form.get("accountId") ?? "") || null;
    const cardId = String(form.get("cardId") ?? "") || null;

    if (!(file instanceof File)) {
      return Response.json({ error: "Selecione um documento." }, { status: 400 });
    }
    if (!(["kim", "alexandre", "joint"] as string[]).includes(owner)) {
      return Response.json({ error: "Responsável inválido." }, { status: 400 });
    }
    if (!documentTypes.has(documentType)) {
      return Response.json({ error: "Tipo de documento inválido." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return Response.json({ error: "Período inválido." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return Response.json(
        { error: "O documento deve ter no máximo 15 MB." },
        { status: 400 },
      );
    }
    const contentType = normalizeFinancialDocumentContentType({
      name: file.name,
      type: file.type,
    });
    if (!contentType) {
      return Response.json(
        { error: "Envie PDF, CSV ou TXT." },
        { status: 400 },
      );
    }

    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();
    if (!membership) {
      return Response.json({ error: "Família não encontrada." }, { status: 403 });
    }
    const householdId = String(membership.household_id);

    const { data: members, error: membersError } = await supabase
      .from("household_members")
      .select("id, person_key")
      .eq("household_id", householdId)
      .eq("status", "active");
    if (membersError) throw membersError;
    const ownerData = ownerColumnsForSelection(
      owner,
      (members ?? []).flatMap((member) =>
        member.person_key === "kim" || member.person_key === "alexandre"
          ? [
              {
                personKey: member.person_key,
                memberId: String(member.id),
              },
            ]
          : [],
      ),
    );

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const { data: duplicate } = await supabase
      .from("financial_documents")
      .select("id, status, storage_path")
      .eq("household_id", householdId)
      .eq("content_checksum", checksum)
      .maybeSingle();
    if (duplicate && duplicate.status !== "failed") {
      return Response.json(
        { error: "Este documento já foi importado." },
        { status: 409 },
      );
    }

    documentId = duplicate?.id ?? crypto.randomUUID();
    const storagePath =
      duplicate?.storage_path ??
      `${householdId}/${documentId}/${safeFilename(file.name)}`;
    if (duplicate) {
      const { error: removeError } = await supabase.storage
        .from("financial-documents")
        .remove([storagePath]);
      if (removeError) throw removeError;
    }
    const { error: uploadError } = await supabase.storage
      .from("financial-documents")
      .upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const documentPayload = {
      household_id: householdId,
      ...ownerData,
      document_type: documentType,
      file_name: file.name,
      mime_type: contentType,
      storage_path: storagePath,
      content_checksum: checksum,
      status: "processing",
      error_message: null,
    };
    const documentRequest = duplicate
      ? supabase
          .from("financial_documents")
          .update(documentPayload)
          .eq("id", documentId)
          .eq("household_id", householdId)
          .eq("status", "failed")
      : supabase
          .from("financial_documents")
          .insert({ id: documentId, ...documentPayload });
    const { error: documentError } = await documentRequest;
    if (documentError) {
      await supabase.storage.from("financial-documents").remove([storagePath]);
      throw documentError;
    }

    const extraction = await extractFinancialDocument(
      bytes,
      { name: file.name, type: contentType },
      documentType,
      period,
    );
    if (documentType === "financing_statement" && !extraction.data.financing) {
      throw new Error(
        "O PDF não trouxe dados suficientes para identificar um financiamento.",
      );
    }

    const [{ data: debts }, { data: goals }, { data: existingAccounts }] =
      await Promise.all([
        supabase
          .from("debts")
          .select("id, description")
          .eq("household_id", householdId)
          .neq("status", "paid"),
        supabase
          .from("goals")
          .select("id, name")
          .eq("household_id", householdId)
          .eq("status", "active"),
        supabase
          .from("accounts")
          .select("id, name, institution, owner_scope, owner_member_id, account_type")
          .eq("household_id", householdId),
      ]);

    const source =
      documentType === "bank_statement"
        ? "bank_statement"
        : documentType === "credit_card_invoice"
          ? "card_invoice"
          : "document_ai";

    const transactionRows = extraction.data.transactions.map((item, index) => ({
      household_id: householdId,
      ...ownerData,
      kind: item.kind,
      description: item.description,
      category_label: item.category,
      amount_cents: item.amountCents,
      transaction_date: item.date,
      status: documentType === "credit_card_invoice" ? "scheduled" : "paid",
      source,
      account_id: accountId,
      credit_card_id: cardId,
      installment_current: item.installmentCurrent,
      installment_total: item.installmentTotal,
      merchant_key: normalizeMerchant(item.merchant || item.description),
      ai_confidence: item.confidence,
      source_document_id: documentId,
      debt_id: findDebt(item, debts ?? []),
      goal_id: findGoal(item, goals ?? []),
      external_fingerprint: createHash("sha256")
        .update(`${checksum}:${index}`)
        .digest("hex"),
    }));

    const balanceRows = extraction.data.balances
      .filter((balance) => !isNonAssetBalanceName(balance.name))
      .map((balance) => {
        const match = (existingAccounts ?? []).find(
          (item) =>
            item.owner_scope === ownerData.owner_scope &&
            item.owner_member_id === ownerData.owner_member_id &&
            item.account_type === balance.accountType &&
            normalizeMerchant(item.name) === normalizeMerchant(balance.name),
        );
        return {
          account_id: match?.id ?? null,
          ...ownerData,
          name: balance.name,
          institution: balance.institution,
          account_type: balance.accountType,
          balance_cents: balance.balanceCents,
          balance_date: balance.balanceDate,
          include_in_net_worth: balance.accountType !== "insurance",
        };
      });

    const invoiceRow =
      documentType === "credit_card_invoice"
        ? {
            ...ownerData,
            credit_card_id: cardId,
            filename: file.name,
            period: extraction.data.invoice
              ? `${extraction.data.invoice.dueDate.slice(0, 7)}-01`
              : `${period}-01`,
            total_cents:
              extraction.data.invoice?.totalCents ??
              extraction.data.transactions
                .filter((item) => item.kind === "expense")
                .reduce((sum, item) => sum + item.amountCents, 0),
            item_count:
              extraction.data.invoice?.items.length ?? transactionRows.length,
            status: "reviewed",
            content_checksum: checksum,
          }
        : null;

    const financing =
      documentType === "financing_statement" && extraction.data.financing
      ? financingRow(extraction.data.financing, owner, ownerData, period)
      : null;

    const { data: application, error: applicationError } = await supabase.rpc(
      "apply_financial_document_import",
      {
        household_id_input: householdId,
        document_id_input: documentId,
        transaction_rows_input: transactionRows,
        balance_rows_input: balanceRows,
        invoice_input: invoiceRow,
        financing_input: financing,
        document_result_input: {
          institution: extraction.data.institution,
          period_start: extraction.data.periodStart,
          period_end: extraction.data.periodEnd,
          extraction_model: extraction.model,
          extraction_mode: extraction.mode,
          extracted_item_count:
            (extraction.data.invoice?.items.length ??
              extraction.data.transactions.length) +
            extraction.data.balances.length +
            (financing ? 1 + financing.installments.length : 0),
          raw_extraction: extraction.data,
        },
      },
    );
    if (applicationError) throw applicationError;

    return Response.json(
      {
        documentId,
        imported: Number(application?.imported ?? transactionRows.length),
        updatedAccounts: Number(
          application?.updated_accounts ?? balanceRows.length,
        ),
        financingUpdated: Boolean(application?.financing_debt_id),
        updatedInstallments: Number(application?.updated_installments ?? 0),
        assetUpdated: Boolean(financing?.asset),
        extractionMode: extraction.mode,
        invoiceItems: extraction.data.invoice?.items.length ?? null,
        invoiceTotalCents: extraction.data.invoice?.totalCents ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    if (documentId) {
      await supabase
        .from("financial_documents")
        .update({
          status: "failed",
          error_message:
            error instanceof Error ? error.message.slice(0, 500) : "Falha na importação.",
        })
        .eq("id", documentId);
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o documento.",
      },
      { status: 500 },
    );
  }
}
