"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emptyFinanceState,
  normalizeMerchant,
  type Account,
  type Asset,
  type CreditCard,
  type Debt,
  type FinanceState,
  type FinancialDocument,
  type Goal,
  type InvoiceItem,
  type Member,
  type Owner,
  type PersonId,
  type Transaction,
  type TransactionSource,
} from "./finance-domain";
import { ownerColumnsForSelection } from "./owner-selection";
import { createSupabaseBrowserClient } from "./supabase/client";

type Row = Record<string, unknown>;

function number(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function ownerFromRow(row: Row, members: Member[]): Owner {
  if (row.owner_scope === "joint") return "joint";
  return (
    members.find((member) => member.memberId === row.owner_member_id)?.id ??
    "joint"
  );
}

function firstError(results: Array<{ error: { message: string } | null }>) {
  return results.find((result) => result.error)?.error ?? null;
}

function invoiceItemsFromRow(row: Row): InvoiceItem[] {
  const raw = row.raw_extraction;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const invoice = (raw as Row).invoice;
  if (!invoice || typeof invoice !== "object" || Array.isArray(invoice)) {
    return [];
  }
  const items = (invoice as Row).items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Row;
    const kind = item.kind;
    const date = String(item.date ?? "");
    const amountCents = number(item.amountCents);
    if (
      !["income", "expense", "transfer"].includes(String(kind)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      amountCents <= 0
    ) {
      return [];
    }
    return [
      {
        date,
        description: String(item.description ?? "Compra no cartão"),
        amountCents,
        kind: kind as InvoiceItem["kind"],
        category: String(item.category ?? "Outros"),
        merchant: String(item.merchant ?? item.description ?? ""),
        installmentCurrent:
          item.installmentCurrent == null
            ? null
            : number(item.installmentCurrent),
        installmentTotal:
          item.installmentTotal == null ? null : number(item.installmentTotal),
        confidence: number(item.confidence),
      },
    ];
  });
}

export function useFinanceStore() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<FinanceState>(emptyFinanceState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      setError("Sua sessão expirou. Entre novamente.");
      setLoading(false);
      return;
    }

    const { data: ownMembership, error: membershipError } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError || !ownMembership) {
      setError(membershipError?.message ?? "Família não encontrada.");
      setLoading(false);
      return;
    }

    const householdId = String(ownMembership.household_id);
    const [
      householdResult,
      membersResult,
      transactionsResult,
      accountsResult,
      assetsResult,
      cardsResult,
      debtsResult,
      debtInstallmentsResult,
      debtSnapshotsResult,
      goalsResult,
      documentsResult,
    ] = await Promise.all([
      supabase.from("households").select("name").eq("id", householdId).single(),
      supabase
        .from("household_members")
        .select("id, person_key, display_name, role")
        .eq("household_id", householdId)
        .eq("status", "active")
        .order("created_at"),
      supabase
        .from("transactions")
        .select("*")
        .eq("household_id", householdId)
        .order("transaction_date", { ascending: false }),
      supabase
        .from("accounts")
        .select("*")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("assets")
        .select("*")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("credit_cards")
        .select("*")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("debts")
        .select("*")
        .eq("household_id", householdId)
        .order("due_date"),
      supabase
        .from("debt_installments")
        .select("*")
        .eq("household_id", householdId)
        .in("status", ["pending", "overdue", "partially_paid"])
        .order("due_date"),
      supabase
        .from("debt_snapshots")
        .select("*")
        .eq("household_id", householdId)
        .order("statement_date", { ascending: false }),
      supabase
        .from("goals")
        .select("*")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false }),
      supabase
        .from("financial_documents")
        .select("*")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false }),
    ]);

    const queryError = firstError([
      householdResult,
      membersResult,
      transactionsResult,
      accountsResult,
      assetsResult,
      cardsResult,
      debtsResult,
      debtInstallmentsResult,
      debtSnapshotsResult,
      goalsResult,
      documentsResult,
    ]);
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }

    const members: Member[] = ((membersResult.data ?? []) as Row[])
      .filter((row) => row.person_key === "kim" || row.person_key === "alexandre")
      .map((row) => ({
        memberId: String(row.id),
        id: row.person_key as PersonId,
        name: String(row.display_name),
        role: row.role === "owner" ? "owner" : "member",
        color: row.person_key === "kim" ? "#7038ee" : "#1f8a70",
      }));

    const transactions: Transaction[] = (
      (transactionsResult.data ?? []) as Row[]
    ).map((row) => ({
      id: String(row.id),
      owner: ownerFromRow(row, members),
      kind: row.kind as Transaction["kind"],
      description: String(row.description),
      category: String(row.category_label ?? "Outros"),
      amountCents: number(row.amount_cents),
      transactionDate: String(row.transaction_date),
      status: row.status as Transaction["status"],
      source: row.source as TransactionSource,
      accountId: row.account_id ? String(row.account_id) : null,
      cardId: row.credit_card_id ? String(row.credit_card_id) : null,
      installmentCurrent: row.installment_current
        ? number(row.installment_current)
        : null,
      installmentTotal: row.installment_total
        ? number(row.installment_total)
        : null,
      note: row.note ? String(row.note) : null,
      merchantKey: String(
        row.merchant_key ?? normalizeMerchant(String(row.description)),
      ),
      isFixedRecurring: Boolean(row.is_fixed_recurring),
      recurrenceStreak: number(row.recurrence_streak),
      aiConfidence:
        row.ai_confidence === null ? null : number(row.ai_confidence),
      sourceDocumentId: row.source_document_id
        ? String(row.source_document_id)
        : null,
      debtId: row.debt_id ? String(row.debt_id) : null,
      goalId: row.goal_id ? String(row.goal_id) : null,
      countsInCashflow: true,
    }));

    const accounts: Account[] = ((accountsResult.data ?? []) as Row[]).map(
      (row) => ({
        id: String(row.id),
        owner: ownerFromRow(row, members),
        name: String(row.name),
        institution: String(row.institution ?? ""),
        type: row.account_type as Account["type"],
        balanceCents: number(row.balance_cents),
        includeInNetWorth: Boolean(row.include_in_net_worth),
        balanceDate: row.balance_date ? String(row.balance_date) : null,
        sourceDocumentId: row.source_document_id
          ? String(row.source_document_id)
          : null,
      }),
    );

    const assets: Asset[] = ((assetsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      owner: ownerFromRow(row, members),
      name: String(row.name),
      type: row.asset_type as Asset["type"],
      totalValueCents: number(row.total_value_cents),
      valuationDate: row.valuation_date ? String(row.valuation_date) : null,
      valueSource: row.value_source as Asset["valueSource"],
      institution: row.institution ? String(row.institution) : null,
      debtId: row.debt_id ? String(row.debt_id) : null,
      sourceDocumentId: row.source_document_id
        ? String(row.source_document_id)
        : null,
    }));

    const cards: CreditCard[] = ((cardsResult.data ?? []) as Row[]).map(
      (row) => ({
        id: String(row.id),
        owner: ownerFromRow(row, members),
        name: String(row.name),
        institution: String(row.institution ?? ""),
        closingDay: number(row.closing_day),
        dueDay: number(row.due_day),
        limitCents: number(row.limit_cents),
      }),
    );

    const installmentRows = (debtInstallmentsResult.data ?? []) as Row[];
    const snapshotRows = (debtSnapshotsResult.data ?? []) as Row[];
    const debts: Debt[] = ((debtsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      owner: ownerFromRow(row, members),
      description: String(row.description),
      totalCents: number(row.total_cents),
      installmentCents: number(row.installment_cents),
      installmentCurrent: number(row.installment_current),
      installmentTotal: number(row.installment_total),
      dueDate: String(row.due_date),
      status: row.status as Debt["status"],
      category: "Dívidas",
      debtType: row.debt_type === "financing" ? "financing" : "other",
      institution: row.institution ? String(row.institution) : null,
      outstandingCents:
        row.outstanding_cents == null ? null : number(row.outstanding_cents),
      interestRateAnnual:
        row.interest_rate_annual == null
          ? null
          : number(row.interest_rate_annual),
      lastStatementDate: row.last_statement_date
        ? String(row.last_statement_date)
        : null,
      lastAmortizationCents: number(row.last_amortization_cents),
      sourceDocumentId: row.source_document_id
        ? String(row.source_document_id)
        : null,
      installments: installmentRows
        .filter((item) => item.debt_id === row.id)
        .map((item) => ({
          id: String(item.id),
          installmentNumber: number(item.installment_number),
          dueDate: String(item.due_date),
          amountCents: number(item.amount_cents),
          principalCents:
            item.principal_cents == null ? null : number(item.principal_cents),
          interestCents:
            item.interest_cents == null ? null : number(item.interest_cents),
          feesCents: item.fees_cents == null ? null : number(item.fees_cents),
          remainingBalanceCents:
            item.remaining_balance_cents == null
              ? null
              : number(item.remaining_balance_cents),
          status: item.status as Debt["installments"][number]["status"],
          sourceDocumentId: String(item.source_document_id),
        })),
      snapshots: snapshotRows
        .filter((item) => item.debt_id === row.id)
        .map((item) => ({
          id: String(item.id),
          statementDate: String(item.statement_date),
          outstandingCents: number(item.outstanding_cents),
          amortizationCents: number(item.amortization_cents),
          sourceDocumentId: String(item.source_document_id),
        })),
    }));

    const goals: Goal[] = ((goalsResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      owner: ownerFromRow(row, members),
      name: String(row.name),
      targetCents: number(row.target_cents),
      currentCents: number(row.current_cents),
      monthlyTargetCents: number(row.monthly_target_cents),
      targetDate: row.target_date ? String(row.target_date) : null,
      targetAccountId: row.target_account_id
        ? String(row.target_account_id)
        : null,
      status: row.status as Goal["status"],
    }));

    const documents: FinancialDocument[] = (
      (documentsResult.data ?? []) as Row[]
    ).map((row) => ({
      id: String(row.id),
      owner: ownerFromRow(row, members),
      documentType: row.document_type as FinancialDocument["documentType"],
      filename: String(row.file_name),
      institution: row.institution ? String(row.institution) : null,
      periodStart: row.period_start ? String(row.period_start) : null,
      periodEnd: row.period_end ? String(row.period_end) : null,
      status: row.status as FinancialDocument["status"],
      extractionMode: row.extraction_mode as FinancialDocument["extractionMode"],
      itemCount: number(row.extracted_item_count),
      createdAt: String(row.created_at),
      invoiceItems: invoiceItemsFromRow(row),
    }));

    setState({
      householdId,
      householdName: String(householdResult.data?.name ?? "Kim & Alexandre"),
      people: members,
      transactions,
      accounts,
      assets,
      cards,
      debts,
      goals,
      documents,
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const refreshTask = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshTask);
  }, [refresh]);

  async function addDebt(
    input: Pick<
      Debt,
      | "owner"
      | "description"
      | "totalCents"
      | "installmentCents"
      | "installmentCurrent"
      | "installmentTotal"
      | "dueDate"
    >,
  ) {
    const { error: insertError } = await supabase.from("debts").insert({
      household_id: state.householdId,
      ...ownerColumnsForSelection(
        input.owner,
        state.people.map((member) => ({
          personKey: member.id,
          memberId: member.memberId,
        })),
      ),
      description: input.description,
      total_cents: input.totalCents,
      installment_cents: input.installmentCents,
      installment_current: input.installmentCurrent,
      installment_total: input.installmentTotal,
      due_date: input.dueDate,
      status: "pending",
      debt_type: "other",
    });
    if (insertError) throw insertError;
    await refresh();
  }

  async function addGoal(input: Omit<Goal, "id" | "currentCents" | "status">) {
    const { error: insertError } = await supabase.from("goals").insert({
      household_id: state.householdId,
      ...ownerColumnsForSelection(
        input.owner,
        state.people.map((member) => ({
          personKey: member.id,
          memberId: member.memberId,
        })),
      ),
      name: input.name,
      target_cents: input.targetCents,
      current_cents: 0,
      monthly_target_cents: input.monthlyTargetCents,
      target_date: input.targetDate,
      target_account_id: input.targetAccountId,
      status: "active",
    });
    if (insertError) throw insertError;
    await refresh();
  }

  async function linkTransaction(
    transactionId: string,
    field: "debt_id" | "goal_id",
    value: string | null,
  ) {
    const { error: updateError } = await supabase
      .from("transactions")
      .update({ [field]: value })
      .eq("id", transactionId)
      .eq("household_id", state.householdId);
    if (updateError) throw updateError;
    await refresh();
  }

  async function importDocument(form: FormData) {
    const response = await fetch("/api/documents/import", {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as {
      error?: string;
      imported?: number;
      updatedAccounts?: number;
      financingUpdated?: boolean;
      assetUpdated?: boolean;
      updatedInstallments?: number;
      extractionMode?: string;
      invoiceItems?: number | null;
      invoiceTotalCents?: number | null;
    };
    if (!response.ok) throw new Error(payload.error ?? "Falha na importação.");
    await refresh();
    return payload;
  }

  async function deleteDocument(documentId: string) {
    const response = await fetch(
      `/api/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
    const payload = (await response.json()) as {
      error?: string;
      deletedTransactions?: number;
      deletedInvoices?: number;
      deletedInstallments?: number;
      deletedDebts?: number;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Falha ao excluir o documento.");
    }
    await refresh();
    return payload;
  }

  async function createInvite() {
    const { data, error: inviteError } = await supabase.rpc(
      "create_household_invite",
      { household_id_input: state.householdId },
    );
    if (inviteError) throw inviteError;
    return String(data);
  }

  return {
    state,
    loading,
    error,
    refresh,
    addDebt,
    addGoal,
    linkDebt: (transactionId: string, debtId: string | null) =>
      linkTransaction(transactionId, "debt_id", debtId),
    linkGoal: (transactionId: string, goalId: string | null) =>
      linkTransaction(transactionId, "goal_id", goalId),
    importDocument,
    deleteDocument,
    createInvite,
    signOut: () => supabase.auth.signOut(),
  };
}
