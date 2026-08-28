"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileText,
  FileUp,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  PiggyBank,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UserPlus,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  accountTotals,
  debtPaidCents,
  documentTransactionCount,
  expenseByCategory,
  goalSavedCents,
  isNonAssetBalanceName,
  matchesScope,
  monthlyIncomeByPerson,
  monthlySummary,
  openInstallmentsTotalCents,
  transactionsWithDebtInstallments,
  transactionsWithInvoiceDetails,
  type Account,
  type FinancialDocument,
  type Owner,
  type Scope,
  type Transaction,
} from "@/lib/finance-domain";
import { useFinanceStore } from "@/lib/use-finance-store";

type Tab = "overview" | "transactions" | "debts" | "assets" | "planning";
type Modal = "import" | "debt" | "goal" | "invite" | null;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const navItems: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "transactions", label: "Entradas e saídas", icon: WalletCards },
  { id: "debts", label: "Dívidas", icon: HandCoins },
  { id: "assets", label: "Patrimônio", icon: Landmark },
  { id: "planning", label: "Planejamento", icon: Target },
];

const pageCopy: Record<Tab, { eyebrow: string; title: string; subtitle: string }> = {
  overview: {
    eyebrow: "CONSOLIDADO",
    title: "Visão financeira do casal",
    subtitle: "Entradas, saídas e planejamento calculados pelos documentos importados.",
  },
  transactions: {
    eyebrow: "MOVIMENTAÇÕES",
    title: "Entradas e saídas",
    subtitle: "Extratos, faturas e parcelas previstas para cada mês.",
  },
  debts: {
    eyebrow: "GESTÃO",
    title: "Dívidas",
    subtitle: "Financiamentos, próximas parcelas e amortizações atualizados pelos PDFs.",
  },
  assets: {
    eyebrow: "PATRIMÔNIO",
    title: "Bens e reservas",
    subtitle: "Contas, imóveis, investimentos, previdência e seguros extraídos dos documentos.",
  },
  planning: {
    eyebrow: "PLANEJAMENTO",
    title: "Metas de economia",
    subtitle: "Defina quanto guardar e em qual conta; os aportes também vêm dos extratos.",
  },
};

const documentLabels = {
  bank_statement: "Extrato bancário",
  credit_card_invoice: "Fatura do cartão",
  financing_statement: "Financiamento imobiliário",
  investment_statement: "Extrato de investimentos",
  pension_statement: "Extrato de previdência",
  insurance_statement: "Documento de seguro",
  other: "Outro documento financeiro",
};

const assetLabels: Record<Account["type"], string> = {
  checking: "Conta corrente",
  savings: "Reserva",
  investment: "Investimentos",
  pension: "Previdência",
  insurance: "Seguros",
  cash: "Dinheiro",
  other: "Outros bens",
};

const assetValueLabels = {
  property_value: "Valor de avaliação",
  purchase_price: "Preço de compra",
  financed_amount: "Valor financiado no contrato",
  document: "Valor informado no documento",
};

function money(cents: number) {
  return brl.format(cents / 100);
}

function cents(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .replace(/\s|R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Math.round((Number(normalized) || 0) * 100);
}

function ownerLabel(owner: Owner) {
  return owner === "kim" ? "Kim" : owner === "alexandre" ? "Alexandre" : "Grupo";
}

function ownerBadge(owner: Owner) {
  return (
    <span className="owner-badge">
      <i className={`mini-avatar ${owner === "kim" ? "kim" : owner === "alexandre" ? "alex" : "joint"}`}>
        {owner === "kim" ? "K" : owner === "alexandre" ? "A" : "2"}
      </i>
      {ownerLabel(owner)}
    </span>
  );
}

function dateLabel(date: string | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, value - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sourceLabel(source: Transaction["source"]) {
  if (source === "bank_statement") return "Extrato";
  if (source === "card_invoice" || source === "invoice") return "Fatura";
  if (source === "invoice_detail") return "Detalhe da fatura";
  if (source === "debt_installment") return "Parcela";
  if (source === "document_ai") return "Documento";
  return "Importado";
}

export function FinanceApp({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const store = useFinanceStore();
  const { state } = store;
  const [tab, setTab] = useState<Tab>("overview");
  const [scope, setScope] = useState<Scope>("all");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [pendingDocumentDelete, setPendingDocumentDelete] =
    useState<FinancialDocument | null>(null);
  const [defaultDocumentType, setDefaultDocumentType] = useState<
    keyof typeof documentLabels
  >("bank_statement");
  const importFormRef = useRef<HTMLFormElement>(null);

  const transactions = useMemo(
    () =>
      transactionsWithDebtInstallments(
        transactionsWithInvoiceDetails(state.transactions, state.documents),
        state.debts,
      ),
    [state.transactions, state.documents, state.debts],
  );
  const summary = useMemo(
    () => monthlySummary(transactions, month, scope),
    [transactions, month, scope],
  );
  const incomes = useMemo(
    () => monthlyIncomeByPerson(state.transactions, month),
    [state.transactions, month],
  );
  const visibleTransactions = useMemo(
    () =>
      summary.visible.filter(
        (item) =>
          !search ||
          `${item.description} ${item.category}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [summary.visible, search],
  );
  const visibleAccounts = state.accounts.filter(
    (item) =>
      matchesScope(item.owner, scope) &&
      (item.includeInNetWorth || item.type === "insurance") &&
      !isNonAssetBalanceName(item.name),
  );
  const visibleAssets = state.assets.filter((item) =>
    matchesScope(item.owner, scope),
  );
  const visibleDebts = state.debts.filter((item) =>
    matchesScope(item.owner, scope),
  );
  const visibleGoals = state.goals.filter((item) =>
    matchesScope(item.owner, scope),
  );
  const totals = accountTotals(state.accounts, scope, state.assets);
  const fixedExpenses = summary.cashflow.filter(
    (item) => item.kind === "expense" && item.isFixedRecurring,
  );
  const categories = expenseByCategory(summary.visible).slice(0, 5);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }

  function openImport(
    documentType: keyof typeof documentLabels = "bank_statement",
  ) {
    setDefaultDocumentType(documentType);
    setModal("import");
  }

  async function importDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await store.importDocument(new FormData(event.currentTarget));
      setModal(null);
      importFormRef.current?.reset();
      notify(
        payload.financingUpdated
          ? `Financiamento e ${payload.assetUpdated ? "bem financiado" : "cronograma"} atualizados, com ${payload.updatedInstallments ?? 0} próximas parcelas.`
          : payload.invoiceTotalCents
            ? `Fatura de ${money(payload.invoiceTotalCents)} aplicada como saída, com ${payload.invoiceItems ?? 0} itens detalhados.`
          : `${payload.imported ?? 0} movimentações e ${payload.updatedAccounts ?? 0} saldos aplicados${payload.extractionMode === "ai" ? " pela IA" : " pela leitura básica"}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha na importação.");
    } finally {
      setBusy(false);
    }
  }

  async function addDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await store.addDebt({
        owner: String(data.get("owner")) as Owner,
        description: String(data.get("description")),
        totalCents: cents(data.get("total")),
        installmentCents: cents(data.get("installment")),
        installmentCurrent: Number(data.get("current") ?? 1),
        installmentTotal: Number(data.get("installments") ?? 1),
        dueDate: String(data.get("dueDate")),
      });
      setModal(null);
      notify("Dívida adicionada. Os pagamentos poderão ser vinculados na tabela.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar a dívida.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument() {
    if (!pendingDocumentDelete) return;
    const chargeCount = documentTransactionCount(
      pendingDocumentDelete.id,
      transactions,
    );
    setDeletingDocumentId(pendingDocumentDelete.id);
    try {
      const result = await store.deleteDocument(pendingDocumentDelete.id);
      const deletedCharges = Math.max(
        chargeCount,
        (result.deletedTransactions ?? 0) + (result.deletedInstallments ?? 0),
      );
      setPendingDocumentDelete(null);
      notify(
        `Documento excluído com ${deletedCharges} ${deletedCharges === 1 ? "lançamento" : "lançamentos"}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao excluir o documento.");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await store.addGoal({
        owner: String(data.get("owner")) as Owner,
        name: String(data.get("name")),
        targetCents: cents(data.get("target")),
        monthlyTargetCents: cents(data.get("monthlyTarget")),
        targetDate: String(data.get("targetDate")) || null,
        targetAccountId: String(data.get("targetAccountId")) || null,
      });
      setModal(null);
      notify("Meta criada. Aportes importados poderão ser vinculados a ela.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao salvar a meta.");
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    setBusy(true);
    try {
      setInviteCode(await store.createInvite());
      setModal("invite");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao gerar convite.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await store.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (store.loading) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">2</div>
        <strong>Carregando as finanças do casal…</strong>
      </main>
    );
  }

  if (store.error) {
    return (
      <main className="loading-screen">
        <ShieldCheck size={36} />
        <strong>Não foi possível carregar os dados</strong>
        <p>{store.error}</p>
        <button className="primary-button" onClick={() => store.refresh()}>
          <RefreshCw size={17} /> Tentar novamente
        </button>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark"><CircleDollarSign size={22} /></div>
          <div><strong>Dois</strong><span>Finanças em conjunto</span></div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <nav className="main-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => {
                setTab(item.id);
                setSidebarOpen(false);
              }}
            >
              <item.icon size={19} /> {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-source-note">
          <Sparkles size={18} />
          <div><strong>Fonte dos dados</strong><span>Extratos e faturas importados</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button>
          <div className="topbar-actions">
            {state.people.length < 2 && (
              <button className="secondary-button" onClick={createInvite} disabled={busy}>
                <UserPlus size={17} /> Convidar
              </button>
            )}
            <button className="primary-button" onClick={() => openImport()}>
              <FileUp size={17} /> Importar PDF
            </button>
            <div className="profile-chip">
              <span>{userEmail}</span>
              <button onClick={logout} aria-label="Sair"><LogOut size={17} /></button>
            </div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">{pageCopy[tab].eyebrow}</span>
              <h1>{pageCopy[tab].title}</h1>
              <p>{pageCopy[tab].subtitle}</p>
            </div>
            <div className="global-filters">
              <label className="select-control">
                <span>Visão</span>
                <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
                  <option value="all">Consolidado</option>
                  {state.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  <option value="joint">Grupo</option>
                </select>
                <ChevronDown size={16} />
              </label>
              <label className="select-control">
                <span>Mês</span>
                <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              </label>
            </div>
          </div>

          {tab === "overview" && (
            <>
              <div className="metric-grid four">
                <Metric icon={ArrowDownLeft} label="Entradas do grupo" value={money(summary.incomeCents)} tone="green" note={monthLabel(month)} />
                <Metric icon={ArrowUpRight} label="Saídas do grupo" value={money(summary.expenseCents)} tone="coral" note={`${summary.cashflow.filter((item) => item.kind === "expense").length} lançamentos`} />
                <Metric icon={Banknote} label="Resultado do mês" value={money(summary.resultCents)} tone="purple" note="Entradas menos saídas" />
                <Metric icon={PiggyBank} label="Patrimônio" value={money(totals.netWorthCents)} tone="blue" note={`${visibleAccounts.length} contas e bens`} />
              </div>

              <div className="content-grid overview-grid">
                <section className="panel">
                  <div className="panel-heading"><div><span className="eyebrow">RENDA CALCULADA</span><h2>Entradas por pessoa</h2></div></div>
                  <div className="income-person-grid">
                    <div><span className="mini-avatar kim">K</span><div><small>Kim</small><strong>{money(incomes.kimCents)}</strong></div></div>
                    <div><span className="mini-avatar alex">A</span><div><small>Alexandre</small><strong>{money(incomes.alexandreCents)}</strong></div></div>
                  </div>
                  <p className="subtle-copy">Não existe salário cadastrado. Estes valores são a soma das entradas importadas no mês.</p>
                </section>
                <section className="panel">
                  <div className="panel-heading"><div><span className="eyebrow">DESPESAS FIXAS</span><h2>Confirmadas por recorrência</h2></div><span className="count-pill">{fixedExpenses.length}</span></div>
                  {fixedExpenses.length ? fixedExpenses.slice(0, 4).map((item) => (
                    <div className="compact-row" key={item.id}><div><strong>{item.description}</strong><span>{item.recurrenceStreak} meses consecutivos</span></div><b>{money(item.amountCents)}</b></div>
                  )) : <EmptyState compact text="Uma despesa só será marcada como fixa após aparecer em três meses consecutivos." />}
                </section>
              </div>

              <div className="content-grid overview-grid">
                <section className="panel">
                  <div className="panel-heading"><div><span className="eyebrow">CATEGORIAS</span><h2>Maiores saídas</h2></div></div>
                  {categories.length ? categories.map(([category, value]) => (
                    <div className="category-line" key={category}><span>{category}</span><div><i style={{ width: `${Math.max(8, (value / (categories[0]?.[1] || 1)) * 100)}%` }} /></div><strong>{money(value)}</strong></div>
                  )) : <EmptyState compact text="Importe um extrato ou uma fatura para ver as categorias." />}
                </section>
                <section className="panel">
                  <div className="panel-heading"><div><span className="eyebrow">ARQUIVOS</span><h2>Documentos importados</h2></div></div>
                  {state.documents.length ? <div className="document-list">{state.documents.map((document) => (
                    <div className="compact-row document-row" key={document.id}><FileText size={18} /><div><strong>{document.filename}</strong><span>{documentLabels[document.documentType]} · {document.itemCount} itens</span></div><span className={`status-badge ${document.status}`}>{document.status === "applied" ? "Aplicado" : document.status}</span><button className="document-delete" type="button" disabled={deletingDocumentId === document.id} aria-label={`Excluir ${document.filename}`} onClick={() => setPendingDocumentDelete(document)}>{deletingDocumentId === document.id ? <RefreshCw className="spin" size={15} /> : <Trash2 size={15} />}<span>Excluir</span></button></div>
                  ))}</div> : <EmptyState compact text="Nenhum documento importado ainda." />}
                </section>
              </div>
            </>
          )}

          {tab === "transactions" && (
            <section className="panel table-panel">
              <div className="panel-heading table-tools">
                <div><span className="eyebrow">{visibleTransactions.length} ITENS</span><h2>Movimentações de {monthLabel(month)}</h2></div>
                <label className="search-control"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar descrição ou categoria" /></label>
              </div>
              {visibleTransactions.length ? (
                <div className="table-wrap">
                  <table className="finance-table">
                    <thead><tr><th>Data</th><th>Descrição</th><th>Pessoa</th><th>Origem</th><th>Categoria</th><th>Vínculo</th><th>Valor</th></tr></thead>
                    <tbody>
                      {visibleTransactions.map((item) => (
                        <tr key={item.id}>
                          <td>{dateLabel(item.transactionDate)}</td>
                          <td><div className="transaction-name"><i className={item.kind}><span>{item.kind === "income" ? "↓" : item.kind === "expense" ? "↑" : "↔"}</span></i><div><strong>{item.description}</strong>{!item.countsInCashflow && <span className="detail-label">Informativo · já incluído no total</span>}{item.isFixedRecurring && <span className="fixed-label">Fixo · {item.recurrenceStreak} meses</span>}</div></div></td>
                          <td>{ownerBadge(item.owner)}</td>
                          <td><span className="source-badge">{sourceLabel(item.source)}</span></td>
                          <td>{item.category}</td>
                          <td>
                            {!item.countsInCashflow ? (
                              <span className="invoice-detail-link">Na fatura</span>
                            ) : item.source === "debt_installment" ? (
                              <span className="scheduled-link">Agendada</span>
                            ) : item.kind === "expense" && state.debts.length ? (
                              <select className="inline-select" value={item.debtId ?? ""} onChange={async (event) => {
                                try { await store.linkDebt(item.id, event.target.value || null); notify("Vínculo da dívida atualizado."); }
                                catch (error) { notify(error instanceof Error ? error.message : "Falha no vínculo."); }
                              }}><option value="">Sem dívida</option>{state.debts.map((debt) => <option key={debt.id} value={debt.id}>{debt.description}</option>)}</select>
                            ) : item.kind === "transfer" && state.goals.length ? (
                              <select className="inline-select" value={item.goalId ?? ""} onChange={async (event) => {
                                try { await store.linkGoal(item.id, event.target.value || null); notify("Aporte vinculado à meta."); }
                                catch (error) { notify(error instanceof Error ? error.message : "Falha no vínculo."); }
                              }}><option value="">Sem meta</option>{state.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td className={`money-cell ${item.kind}`}>{item.kind === "expense" ? "−" : item.kind === "income" ? "+" : ""}{money(item.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon={FileUp} text="Importe extratos, faturas ou um financiamento. As movimentações do mês aparecerão aqui automaticamente." action="Importar documento" onAction={() => openImport()} />}
            </section>
          )}

          {tab === "debts" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">{visibleDebts.length} DÍVIDAS</span><h2>Acompanhamento</h2></div><div className="panel-actions"><button className="secondary-button" onClick={() => openImport("financing_statement")}><FileUp size={17} /> Importar financiamento</button><button className="secondary-button" onClick={() => setModal("debt")}><Plus size={17} /> Adicionar manualmente</button></div></div>
              {visibleDebts.length ? <div className="card-list">{visibleDebts.map((debt) => {
                const importedPaid = Math.min(debt.totalCents, debtPaidCents(debt.id, state.transactions));
                const openInstallmentsCents = openInstallmentsTotalCents(debt);
                const outstanding = debt.debtType === "financing" && debt.installments.length
                  ? openInstallmentsCents
                  : debt.outstandingCents ?? Math.max(0, debt.totalCents - importedPaid);
                const paid = Math.max(importedPaid, debt.totalCents - outstanding);
                const percentage = debt.debtType === "financing"
                  ? Math.min(100, (Math.max(0, debt.installmentCurrent - 1) / debt.installmentTotal) * 100)
                  : debt.totalCents ? Math.min(100, (paid / debt.totalCents) * 100) : 0;
                const payments = state.transactions.filter((item) => item.debtId === debt.id).length;
                return <article className={`progress-card ${debt.debtType === "financing" ? "financing" : ""}`} key={debt.id}><div className="progress-card-top"><div>{ownerBadge(debt.owner)}<h3>{debt.description}</h3><span>{debt.debtType === "financing" ? `${debt.institution ?? "Instituição não identificada"} · ${debt.snapshots.length} PDF${debt.snapshots.length === 1 ? "" : "s"}` : `${payments} pagamentos importados vinculados`}</span></div><strong>{money(outstanding)}<small>{debt.debtType === "financing" ? "total das parcelas abertas" : "saldo devedor"}</small></strong></div><div className="progress-track"><i style={{ width: `${percentage}%` }} /></div><div className="progress-meta"><span>{debt.debtType === "financing" ? `${debt.installments.length} parcelas abertas` : `Quitado ${money(paid)}`}</span><span>Parcela {debt.installmentCurrent}/{debt.installmentTotal}</span><span>Vence {dateLabel(debt.dueDate)}</span></div>{debt.debtType === "financing" && <div className="financing-update"><span>Atualizado em {dateLabel(debt.lastStatementDate)}</span>{debt.lastAmortizationCents > 0 && <strong>Amortização identificada: {money(debt.lastAmortizationCents)}</strong>}</div>}{debt.installments.length > 0 && <div className="installment-schedule"><div className="schedule-heading"><strong>Próximas parcelas</strong><span>{debt.installments.length} no último PDF</span></div>{debt.installments.slice(0, 8).map((installment) => <div className="schedule-row" key={installment.id}><span><b>{installment.installmentNumber}</b>{dateLabel(installment.dueDate)}</span><span>{installment.principalCents !== null ? `Principal ${money(installment.principalCents)}` : installment.status === "overdue" ? "Em atraso" : "Prevista"}</span><strong>{money(installment.amountCents)}</strong></div>)}</div>}</article>;
              })}</div> : <EmptyState icon={HandCoins} text="Importe o PDF do financiamento para criar a dívida e listar as próximas parcelas." action="Importar financiamento" onAction={() => openImport("financing_statement")} />}
            </section>
          )}

          {tab === "assets" && (
            <>
              <div className="metric-grid three">
                <Metric icon={Landmark} label="Patrimônio total" value={money(totals.netWorthCents)} tone="purple" note="Financeiro + bens, sem seguros" />
                <Metric icon={ShieldCheck} label="Seguros" value={money(totals.insuredCents)} tone="blue" note="Coberturas importadas" />
                <Metric icon={TrendingUp} label="Contas e bens" value={String(visibleAccounts.length + visibleAssets.length)} tone="green" note="Com valor atualizado" />
              </div>
              <section className="panel">
                <div className="panel-heading"><div><span className="eyebrow">BENS E SALDOS IMPORTADOS</span><h2>Patrimônio por pessoa</h2></div></div>
                {visibleAccounts.length || visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => (
                  <article className="asset-card financed-asset" key={asset.id}><div className="asset-icon"><Building2 size={21} /></div><div className="asset-title"><span>{asset.type === "real_estate" ? "Imóvel" : "Bem"}</span><h3>{asset.name}</h3><small>{asset.institution || "Extraído do financiamento"}</small></div>{ownerBadge(asset.owner)}<strong>{money(asset.totalValueCents)}</strong><span className="balance-date">{assetValueLabels[asset.valueSource]} · {dateLabel(asset.valuationDate)}</span></article>
                ))}{visibleAccounts.map((account) => (
                  <article className="asset-card" key={account.id}><div className="asset-icon">{account.type === "insurance" ? <ShieldCheck size={21} /> : account.type === "investment" || account.type === "pension" ? <TrendingUp size={21} /> : <Landmark size={21} />}</div><div className="asset-title"><span>{assetLabels[account.type]}</span><h3>{account.name}</h3><small>{account.institution || "Instituição não identificada"}</small></div>{ownerBadge(account.owner)}<strong>{money(account.balanceCents)}</strong><span className="balance-date">Saldo em {dateLabel(account.balanceDate)}</span></article>
                ))}</div> : <EmptyState icon={Landmark} text="Importe extratos ou o PDF do financiamento para formar o patrimônio." action="Importar documento" onAction={() => openImport()} />}
              </section>
            </>
          )}

          {tab === "planning" && (
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">{visibleGoals.length} METAS</span><h2>Quanto guardar e onde</h2></div><button className="secondary-button" onClick={() => setModal("goal")}><Plus size={17} /> Nova meta</button></div>
              {visibleGoals.length ? <div className="card-list">{visibleGoals.map((goal) => {
                const imported = goalSavedCents(goal.id, state.transactions);
                const saved = goal.currentCents + imported;
                const percentage = goal.targetCents ? Math.min(100, (saved / goal.targetCents) * 100) : 0;
                const account = state.accounts.find((item) => item.id === goal.targetAccountId);
                return <article className="progress-card goal" key={goal.id}><div className="progress-card-top"><div>{ownerBadge(goal.owner)}<h3>{goal.name}</h3><span><Link2 size={14} /> {account ? `${account.name} · ${account.institution}` : "Conta de destino não definida"}</span></div><strong>{money(saved)}<small>de {money(goal.targetCents)}</small></strong></div><div className="progress-track"><i style={{ width: `${percentage}%` }} /></div><div className="progress-meta"><span>{percentage.toFixed(0)}% concluído</span><span>Guardar {money(goal.monthlyTargetCents)}/mês</span><span>Até {dateLabel(goal.targetDate)}</span></div></article>;
              })}</div> : <EmptyState icon={Target} text="Crie uma meta, escolha a conta de destino e vincule os aportes encontrados nos extratos." action="Criar meta" onAction={() => setModal("goal")} />}
            </section>
          )}
        </div>
      </section>

      {modal === "import" && <ModalShell title="Importar documento" subtitle="A IA lê o PDF e atualiza movimentações, saldos ou o cronograma do financiamento." onClose={() => setModal(null)}><form ref={importFormRef} className="modal-form" onSubmit={importDocument}><label><span>Arquivo</span><input type="file" name="file" accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain" required /></label><div className="form-grid"><label><span>Tipo</span><select key={defaultDocumentType} name="documentType" defaultValue={defaultDocumentType}>{Object.entries(documentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>De quem</span><select name="owner" defaultValue={state.people[0]?.id ?? "joint"}>{state.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="joint">Grupo</option></select></label><label><span>Período de referência</span><input name="period" type="month" defaultValue={month} required /></label><label><span>Conta relacionada (opcional)</span><select name="accountId" defaultValue=""><option value="">Identificar pelo PDF</option>{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label><span>Cartão relacionado (opcional)</span><select name="cardId" defaultValue=""><option value="">Identificar pelo PDF</option>{state.cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label></div><div className="ai-disclosure"><Sparkles size={18} /><span>Ao importar novamente o mesmo contrato, o saldo e as próximas parcelas são atualizados sem criar outra dívida. Amortizações explícitas ficam registradas no histórico.</span></div><button className="primary-button modal-submit" disabled={busy}>{busy ? "Lendo e aplicando…" : "Ler e aplicar tudo"}</button></form></ModalShell>}

      {pendingDocumentDelete && <ModalShell title="Excluir documento e lançamentos?" subtitle="A exclusão remove o arquivo e tudo que foi criado a partir dele." onClose={() => !deletingDocumentId && setPendingDocumentDelete(null)}><div className="delete-document-confirmation"><div className="delete-document-file"><span><FileText size={21} /></span><div><strong>{pendingDocumentDelete.filename}</strong><small>{documentLabels[pendingDocumentDelete.documentType]}</small></div></div><div className="delete-document-warning"><Trash2 size={18} /><p>Serão removidos permanentemente <strong>{documentTransactionCount(pendingDocumentDelete.id, transactions)} lançamentos e parcelas vinculados</strong>, além de faturas originadas deste PDF. Essa ação não pode ser desfeita.</p></div><footer><button className="secondary-button" type="button" disabled={Boolean(deletingDocumentId)} onClick={() => setPendingDocumentDelete(null)}>Cancelar</button><button className="delete-confirm-button" type="button" disabled={Boolean(deletingDocumentId)} onClick={() => void deleteDocument()}>{deletingDocumentId ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}{deletingDocumentId ? "Excluindo…" : "Excluir tudo"}</button></footer></div></ModalShell>}

      {modal === "debt" && <ModalShell title="Adicionar dívida" subtitle="Depois vincule os pagamentos importados na tabela de entradas e saídas." onClose={() => setModal(null)}><form className="modal-form" onSubmit={addDebt}><label><span>Descrição</span><input name="description" required placeholder="Ex.: Financiamento do carro" /></label><div className="form-grid"><OwnerSelect people={state.people} /><label><span>Valor total</span><input name="total" required placeholder="0,00" inputMode="decimal" /></label><label><span>Valor da parcela</span><input name="installment" required placeholder="0,00" inputMode="decimal" /></label><label><span>Parcela atual</span><input name="current" type="number" min="1" defaultValue="1" required /></label><label><span>Total de parcelas</span><input name="installments" type="number" min="1" defaultValue="1" required /></label><label><span>Próximo vencimento</span><input name="dueDate" type="date" required /></label></div><button className="primary-button modal-submit" disabled={busy}>{busy ? "Salvando…" : "Salvar dívida"}</button></form></ModalShell>}

      {modal === "goal" && <ModalShell title="Nova meta" subtitle="Defina o valor a guardar e a conta que receberá os aportes." onClose={() => setModal(null)}><form className="modal-form" onSubmit={addGoal}><label><span>Nome da meta</span><input name="name" required placeholder="Ex.: Reserva de emergência" /></label><div className="form-grid"><OwnerSelect people={state.people} /><label><span>Valor total</span><input name="target" required placeholder="0,00" inputMode="decimal" /></label><label><span>Guardar por mês</span><input name="monthlyTarget" required placeholder="0,00" inputMode="decimal" /></label><label><span>Conta de destino</span><select name="targetAccountId" defaultValue=""><option value="">Selecionar depois</option>{state.accounts.filter((account) => account.type !== "insurance").map((account) => <option key={account.id} value={account.id}>{account.name} · {account.institution}</option>)}</select></label><label><span>Data alvo</span><input name="targetDate" type="date" /></label></div><button className="primary-button modal-submit" disabled={busy}>{busy ? "Salvando…" : "Criar meta"}</button></form></ModalShell>}

      {modal === "invite" && <ModalShell title="Convidar a outra pessoa" subtitle="Este código é de uso único e expira em sete dias." onClose={() => setModal(null)}><div className="invite-code"><strong>{inviteCode}</strong><button onClick={() => navigator.clipboard.writeText(inviteCode)}>Copiar</button></div><p className="subtle-copy">A outra pessoa cria o próprio login e escolhe “Usar convite” no primeiro acesso.</p></ModalShell>}

      {toast && <div className="toast"><CheckCircle2 size={19} /> {toast}</div>}
      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
    </main>
  );
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: LucideIcon; label: string; value: string; note: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-icon"><Icon size={21} /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function EmptyState({ icon: Icon = FileText, text, compact = false, action, onAction }: { icon?: LucideIcon; text: string; compact?: boolean; action?: string; onAction?: () => void }) {
  return <div className={`empty-state ${compact ? "compact" : ""}`}><Icon size={compact ? 22 : 32} /><p>{text}</p>{action && <button className="secondary-button" onClick={onAction}>{action}</button>}</div>;
}

function OwnerSelect({ people }: { people: Array<{ id: string; name: string }> }) {
  return <label><span>Responsável</span><select name="owner" defaultValue={people[0]?.id ?? "joint"}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="joint">Grupo</option></select></label>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>{children}</section></div>;
}
