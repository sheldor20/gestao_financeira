"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  FileUp,
  HandCoins,
  LayoutDashboard,
  Landmark,
  Menu,
  PiggyBank,
  Plus,
  ReceiptText,
  Repeat2,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useMemo, useRef, useState } from "react";
import {
  accountTotals,
  customSplit,
  expenseByCategory,
  installmentRemaining,
  matchesScope,
  monthlySummary,
  nextId,
  type Account,
  type Budget,
  type CreditCard as CreditCardModel,
  type Debt,
  type FinanceState,
  type Goal,
  type Invoice,
  type Owner,
  type Recurrence,
  type Scope,
  type Transaction,
} from "@/lib/finance-domain";
import { useFinanceStore } from "@/lib/use-finance-store";

type Tab =
  | "overview"
  | "transactions"
  | "planning"
  | "debts"
  | "assets"
  | "invoices"
  | "settings";
type ModalType =
  | "transaction"
  | "debt"
  | "account"
  | "budget"
  | "goal"
  | "recurrence"
  | "card";
type Analysis = {
  totalCents: number;
  itemCount: number;
  byCategory: Record<string, number>;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const categoryColors = [
  "#7038ee",
  "#d17f2c",
  "#1f8a70",
  "#e05252",
  "#277ac2",
  "#c34c9b",
  "#7867a7",
  "#4b8cbe",
];

const navItems: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "transactions", label: "Movimentações", icon: ReceiptText },
  { id: "planning", label: "Planejamento", icon: Target },
  { id: "debts", label: "Dívidas", icon: HandCoins },
  { id: "assets", label: "Patrimônio", icon: Landmark },
  { id: "invoices", label: "Faturas", icon: CreditCard },
  { id: "settings", label: "Configurações", icon: Settings },
];

const pageCopy: Record<
  Tab,
  { eyebrow: string; title: string; subtitle: string }
> = {
  overview: {
    eyebrow: "SUA VIDA FINANCEIRA",
    title: "Olá, Kim e Alexandre.",
    subtitle:
      "O dinheiro de vocês, individual e compartilhado, em uma única visão.",
  },
  transactions: {
    eyebrow: "MOVIMENTAÇÃO",
    title: "Entradas e saídas",
    subtitle: "Registre, filtre e acompanhe cada lançamento do casal.",
  },
  planning: {
    eyebrow: "PLANEJAMENTO",
    title: "Orçamentos e objetivos",
    subtitle: "Definam limites, metas e compromissos recorrentes.",
  },
  debts: {
    eyebrow: "COMPROMISSOS",
    title: "Dívidas e parcelas",
    subtitle: "Acompanhem vencimentos, progresso e pagamentos.",
  },
  assets: {
    eyebrow: "PATRIMÔNIO",
    title: "Contas, reservas e proteção",
    subtitle:
      "Saldos bancários, investimentos, previdência, seguros e outros bens.",
  },
  invoices: {
    eyebrow: "CARTÕES",
    title: "Faturas e compras",
    subtitle: "Importe PDF ou CSV e revise a categorização dos gastos.",
  },
  settings: {
    eyebrow: "CASAL",
    title: "Regras e preferências",
    subtitle:
      "Rendas, divisão de gastos, categorias e futura conexão do sistema.",
  },
};

function money(cents: number) {
  return brl.format(cents / 100);
}
function inputCents(value: string) {
  const normalized = value
    .trim()
    .replace(/\s|R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Math.round((Number(normalized) || 0) * 100);
}
function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, m - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function dateLabel(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(" de ", " ");
}
function ownerLabel(owner: Owner) {
  return owner === "kim"
    ? "Kim"
    : owner === "alexandre"
      ? "Alexandre"
      : "Compartilhado";
}
function ownerBadge(owner: Owner, showLabel = true) {
  const letter = owner === "kim" ? "K" : owner === "alexandre" ? "A" : "2";
  const cls =
    owner === "kim" ? "kim" : owner === "alexandre" ? "alex" : "joint";
  return (
    <span className="owner-badge">
      <i className={`mini-avatar ${cls}`}>{letter}</i>
      {showLabel && ownerLabel(owner)}
    </span>
  );
}

export function FinanceApp() {
  const store = useFinanceStore();
  const { state } = store;
  const [tab, setTab] = useState<Tab>("overview");
  const [scope, setScope] = useState<Scope>("all");
  const [month, setMonth] = useState("2026-08");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalType | null>(null);
  const [toast, setToast] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [uploading, setUploading] = useState(false);

  const summary = useMemo(
    () => monthlySummary(state.transactions, month, scope),
    [state.transactions, month, scope],
  );
  const searched = summary.visible.filter(
    (item) =>
      !search ||
      `${item.description} ${item.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const assets = state.accounts.filter((item) =>
    matchesScope(item.owner, scope),
  );
  const debts = state.debts.filter((item) => matchesScope(item.owner, scope));
  const budgets = state.budgets.filter(
    (item) => item.month === month && matchesScope(item.owner, scope),
  );
  const goals = state.goals.filter((item) => matchesScope(item.owner, scope));
  const recurrences = state.recurrences.filter((item) =>
    matchesScope(item.owner, scope),
  );
  const cards = state.cards.filter((item) => matchesScope(item.owner, scope));

  function changeTab(next: Tab) {
    setTab(next);
    setSidebarOpen(false);
    setSearch("");
  }
  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }
  function saved(message: string) {
    setModal(null);
    notify(message);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <CircleDollarSign size={22} />
          </div>
          <div>
            <strong>Dois</strong>
            <span>Finanças em conjunto</span>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="main-nav" aria-label="Navegação principal">
          <p className="nav-eyebrow">Organizar</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => changeTab(id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "debts" &&
                debts.filter((item) => item.status !== "paid").length > 0 && (
                  <b>{debts.filter((item) => item.status !== "paid").length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-card">
          <Sparkles size={20} />
          <strong>Fatura inteligente</strong>
          <p>Envie PDF ou CSV e organize as compras por categoria.</p>
          <button onClick={() => changeTab("invoices")}>
            <FileUp size={16} /> Enviar fatura
          </button>
        </div>
        <div className="profile-row">
          <div className="avatar avatar-kim">K</div>
          <div>
            <strong>{state.householdName}</strong>
            <span>Ambiente do casal</span>
          </div>
          <ShieldCheck size={17} />
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={21} />
          </button>
          <div className="search">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar"
              placeholder="Buscar lançamento, categoria ou conta"
            />
          </div>
          <label className="month-selector">
            <CalendarDays size={15} />
            <span>{monthLabel(month)}</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <ChevronDown size={15} />
          </label>
          <button
            className="icon-button notification"
            aria-label="Notificações"
          >
            <Bell size={19} />
            <i />
          </button>
          <button
            className="primary-button"
            onClick={() => setModal("transaction")}
          >
            <Plus size={18} /> Novo lançamento
          </button>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p>{pageCopy[tab].eyebrow}</p>
              <h1>{pageCopy[tab].title}</h1>
              <span>{pageCopy[tab].subtitle}</span>
            </div>
            <ScopeFilter value={scope} onChange={setScope} />
          </div>

          {tab === "overview" && (
            <Overview
              state={state}
              month={month}
              scope={scope}
              transactions={summary.visible}
              summary={summary}
              onNavigate={changeTab}
              onAdd={setModal}
            />
          )}
          {tab === "transactions" && (
            <Transactions
              items={searched}
              summary={summary}
              onAdd={() => setModal("transaction")}
              onUpdate={store.updateTransaction}
              onDelete={(id) => {
                store.deleteTransaction(id);
                notify("Lançamento removido.");
              }}
            />
          )}
          {tab === "planning" && (
            <Planning
              month={month}
              transactions={summary.visible}
              budgets={budgets}
              goals={goals}
              recurrences={recurrences}
              onAdd={setModal}
              onDeleteBudget={store.deleteBudget}
              onUpdateGoal={store.updateGoal}
              onDeleteGoal={store.deleteGoal}
              onUpdateRecurrence={store.updateRecurrence}
              onDeleteRecurrence={store.deleteRecurrence}
              notify={notify}
            />
          )}
          {tab === "debts" && (
            <Debts
              items={debts}
              onAdd={() => setModal("debt")}
              onUpdate={store.updateDebt}
              onDelete={store.deleteDebt}
            />
          )}
          {tab === "assets" && (
            <Assets
              items={assets}
              onAdd={() => setModal("account")}
              onDelete={store.deleteAccount}
            />
          )}
          {tab === "invoices" && (
            <Invoices
              state={state}
              scope={scope}
              month={month}
              cards={cards}
              analysis={analysis}
              uploading={uploading}
              onAddCard={() => setModal("card")}
              onDeleteCard={store.deleteCard}
              onImport={(invoice, transactions, nextAnalysis) => {
                store.addInvoice(invoice, transactions);
                setAnalysis(nextAnalysis);
                notify(`${transactions.length} compras importadas.`);
              }}
              setUploading={setUploading}
              onUpdateTransaction={store.updateTransaction}
            />
          )}
          {tab === "settings" && (
            <SettingsView
              state={state}
              onUpdatePerson={store.updatePerson}
              onUpdateSplit={store.updateSplit}
              onAddCategory={store.addCategory}
              onReset={() => {
                if (
                  window.confirm(
                    "Restaurar os dados iniciais desta versão local?",
                  )
                ) {
                  store.resetDemo();
                  notify("Dados locais restaurados.");
                }
              }}
            />
          )}
        </div>
      </section>

      {modal && (
        <CreateModal
          type={modal}
          state={state}
          month={month}
          onClose={() => setModal(null)}
          onCreate={(entity) => {
            if (entity.type === "transaction") {
              store.addTransaction(entity.value);
              saved("Lançamento adicionado.");
            }
            if (entity.type === "debt") {
              store.addDebt(entity.value);
              saved("Dívida adicionada.");
            }
            if (entity.type === "account") {
              store.addAccount(entity.value);
              saved("Conta adicionada.");
            }
            if (entity.type === "budget") {
              store.addBudget(entity.value);
              saved("Orçamento definido.");
            }
            if (entity.type === "goal") {
              store.addGoal(entity.value);
              saved("Meta criada.");
            }
            if (entity.type === "recurrence") {
              store.addRecurrence(entity.value);
              saved("Recorrência criada.");
            }
            if (entity.type === "card") {
              store.addCard(entity.value);
              saved("Cartão adicionado.");
            }
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
    </main>
  );
}

function ScopeFilter({
  value,
  onChange,
}: {
  value: Scope;
  onChange: (scope: Scope) => void;
}) {
  const filters: Array<{
    id: Scope;
    label: string;
    letter?: string;
    cls?: string;
  }> = [
    { id: "all", label: "Consolidado" },
    { id: "kim", label: "Kim", letter: "K", cls: "kim" },
    { id: "alexandre", label: "Alexandre", letter: "A", cls: "alex" },
    { id: "joint", label: "Compartilhado", letter: "2", cls: "joint" },
  ];
  return (
    <div className="people-filter">
      {filters.map((item) => (
        <button
          key={item.id}
          className={value === item.id ? "selected" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.letter && (
            <i className={`mini-avatar ${item.cls}`}>{item.letter}</i>
          )}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Overview({
  state,
  month,
  scope,
  transactions,
  summary,
  onNavigate,
  onAdd,
}: {
  state: FinanceState;
  month: string;
  scope: Scope;
  transactions: Transaction[];
  summary: ReturnType<typeof monthlySummary>;
  onNavigate: (tab: Tab) => void;
  onAdd: (modal: ModalType) => void;
}) {
  const account = accountTotals(state.accounts, scope);
  const categories = expenseByCategory(transactions);
  const split = customSplit(500_000, state.split, state.people);
  const pendingDebts = state.debts
    .filter((item) => item.status !== "paid" && matchesScope(item.owner, scope))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const activeRecurring = state.recurrences
    .filter((item) => item.active && matchesScope(item.owner, scope))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const salaryKim = transactions
    .filter((item) => item.kind === "income" && item.owner === "kim")
    .reduce((s, item) => s + item.amountCents, 0);
  const salaryAlex = transactions
    .filter((item) => item.kind === "income" && item.owner === "alexandre")
    .reduce((s, item) => s + item.amountCents, 0);
  const maxCategory = categories[0]?.[1] || 1;
  return (
    <>
      <section className="hero-grid">
        <article className="balance-card">
          <div className="card-title">
            <span>
              <WalletCards size={18} /> Patrimônio financeiro
            </span>
          </div>
          <h2>{money(account.netWorthCents)}</h2>
          <p>
            <ShieldCheck size={15} /> Capital segurado:{" "}
            {money(account.insuredCents)}
          </p>
          <div className="account-split">
            <span>
              <i className="dot kim-dot" /> Contas cadastradas{" "}
              <strong>
                {state.accounts.filter((item) => item.owner === "kim").length}{" "}
                da Kim
              </strong>
            </span>
            <span>
              <i className="dot alex-dot" /> Alexandre{" "}
              <strong>
                {
                  state.accounts.filter((item) => item.owner === "alexandre")
                    .length
                }{" "}
                contas
              </strong>
            </span>
          </div>
          <div className="balance-decoration" />
        </article>
        <SummaryCard
          icon={ArrowDownLeft}
          label="Entradas no mês"
          value={money(summary.incomeCents)}
          footer={
            <>
              <span>
                Kim <strong>{money(salaryKim)}</strong>
              </span>
              <span>
                Alexandre <strong>{money(salaryAlex)}</strong>
              </span>
            </>
          }
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Saídas no mês"
          value={money(summary.expenseCents)}
          footer={
            <>
              <span>
                Resultado <strong>{money(summary.resultCents)}</strong>
              </span>
              <span>
                Renda usada{" "}
                <strong>
                  {summary.incomeCents
                    ? Math.round(
                        (summary.expenseCents / summary.incomeCents) * 100,
                      )
                    : 0}
                  %
                </strong>
              </span>
            </>
          }
        />
      </section>
      <section className="main-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span>ORÇAMENTO REAL</span>
              <h3>Gastos por categoria</h3>
            </div>
            <span className="panel-period">{monthLabel(month)}</span>
          </div>
          <div className="horizontal-categories">
            {categories.slice(0, 6).map(([name, value], index) => (
              <div key={name}>
                <span>
                  <i
                    style={{
                      background: categoryColors[index % categoryColors.length],
                    }}
                  />
                  {name}
                  <b>{money(value)}</b>
                </span>
                <em>
                  <i
                    style={{
                      width: `${(value / maxCategory) * 100}%`,
                      background: categoryColors[index % categoryColors.length],
                    }}
                  />
                </em>
              </div>
            ))}
            {!categories.length && (
              <EmptyMini text="Nenhuma saída neste recorte." />
            )}
          </div>
          <button
            className="text-link"
            onClick={() => onNavigate("transactions")}
          >
            Ver movimentações <ArrowUpRight size={15} />
          </button>
        </article>
        <article className="panel spending-panel">
          <div className="panel-heading">
            <div>
              <span>DIVISÃO DO CASAL</span>
              <h3>Aluguel proporcional</h3>
            </div>
            <span className="pill">
              {state.split.method === "proportional"
                ? "Por renda"
                : state.split.method === "equal"
                  ? "50 / 50"
                  : "Personalizada"}
            </span>
          </div>
          <div className="rent-total">
            <span>Valor total</span>
            <strong>{money(500_000)}</strong>
          </div>
          <div className="split-bar">
            <i style={{ width: `${split.kimPercent}%` }} />
            <b style={{ width: `${split.alexandrePercent}%` }} />
          </div>
          <div className="rent-people">
            <div>
              <span>
                <i className="mini-avatar kim">K</i>
                <b>
                  Kim<small>{split.kimPercent.toFixed(2)}%</small>
                </b>
              </span>
              <strong>{money(split.kimCents)}</strong>
            </div>
            <div>
              <span>
                <i className="mini-avatar alex">A</i>
                <b>
                  Alexandre<small>{split.alexandrePercent.toFixed(2)}%</small>
                </b>
              </span>
              <strong>{money(split.alexandreCents)}</strong>
            </div>
          </div>
          <button
            className="secondary-button"
            onClick={() => onNavigate("settings")}
          >
            <UsersRound size={16} /> Ajustar regra de divisão
          </button>
        </article>
      </section>
      <section className="lower-grid">
        <article className="panel upcoming-panel">
          <div className="panel-heading">
            <div>
              <span>PRÓXIMOS VENCIMENTOS</span>
              <h3>Dívidas e parcelas</h3>
            </div>
            <button className="text-link" onClick={() => onNavigate("debts")}>
              Ver todas
            </button>
          </div>
          <div className="upcoming-list">
            {pendingDebts.slice(0, 3).map((item) => (
              <div key={item.id}>
                <time>
                  <strong>{item.dueDate.slice(8)}</strong>
                  <span>
                    {new Intl.DateTimeFormat("pt-BR", {
                      month: "short",
                      timeZone: "UTC",
                    })
                      .format(new Date(`${item.dueDate}T12:00:00Z`))
                      .toUpperCase()}
                  </span>
                </time>
                <span className="bill-icon orange">
                  <HandCoins size={18} />
                </span>
                <p>
                  <strong>{item.description}</strong>
                  <span>
                    {ownerLabel(item.owner)} · {item.installmentCurrent}/
                    {item.installmentTotal}
                  </span>
                </p>
                <b>{money(item.installmentCents)}</b>
                <em className="pending">Pendente</em>
              </div>
            ))}
            {!pendingDebts.length && (
              <EmptyMini text="Nenhuma dívida pendente." />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span>RECORRÊNCIAS</span>
              <h3>Próximas cobranças</h3>
            </div>
            <button
              className="text-link"
              onClick={() => onNavigate("planning")}
            >
              Gerenciar
            </button>
          </div>
          <div className="mini-list">
            {activeRecurring.slice(0, 4).map((item) => (
              <div key={item.id}>
                <span className="bill-icon purple">
                  <Repeat2 size={17} />
                </span>
                <p>
                  <strong>{item.description}</strong>
                  <small>
                    {dateLabel(item.nextDate)} · {ownerLabel(item.owner)}
                  </small>
                </p>
                <b>{money(item.amountCents)}</b>
              </div>
            ))}
            {!activeRecurring.length && (
              <EmptyMini text="Nenhuma recorrência ativa." />
            )}
          </div>
          <button
            className="secondary-button"
            onClick={() => onAdd("recurrence")}
          >
            <Plus size={16} /> Nova recorrência
          </button>
        </article>
      </section>
    </>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  footer,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  footer: React.ReactNode;
}) {
  return (
    <article className="summary-card">
      <div className="card-title">
        <span>
          <Icon size={18} />
          {label}
        </span>
      </div>
      <h2>{value}</h2>
      <div className="progress-line">
        <i style={{ width: "100%" }} />
      </div>
      <div className="summary-detail">{footer}</div>
    </article>
  );
}

function Transactions({
  items,
  summary,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: Transaction[];
  summary: ReturnType<typeof monthlySummary>;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Transaction>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="section-stack">
      <div className="metric-row">
        <Metric
          icon={ArrowDownLeft}
          label="Entradas"
          value={money(summary.incomeCents)}
          tone="green"
        />
        <Metric
          icon={ArrowUpRight}
          label="Saídas"
          value={money(summary.expenseCents)}
          tone="orange"
        />
        <Metric
          icon={Banknote}
          label="Resultado"
          value={money(summary.resultCents)}
          tone="purple"
        />
      </div>
      <article className="panel data-panel">
        <div className="panel-heading">
          <div>
            <span>LANÇAMENTOS</span>
            <h3>Histórico do período</h3>
          </div>
          <button className="primary-button compact" onClick={onAdd}>
            <Plus size={16} /> Adicionar
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Responsável</th>
                <th>Categoria</th>
                <th>Status</th>
                <th className="right">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{dateLabel(item.transactionDate)}</td>
                  <td>
                    <div className="description-cell">
                      <i className={`transaction-icon ${item.kind}`}>
                        {item.kind === "income" ? (
                          <ArrowDownLeft size={15} />
                        ) : item.kind === "transfer" ? (
                          <Repeat2 size={15} />
                        ) : (
                          <ArrowUpRight size={15} />
                        )}
                      </i>
                      <span>
                        <strong>{item.description}</strong>
                        <small>
                          {item.source === "invoice"
                            ? "Fatura importada"
                            : item.source === "recurrence"
                              ? "Recorrência"
                              : "Lançamento"}
                          {item.installmentTotal
                            ? ` · ${item.installmentCurrent}/${item.installmentTotal}`
                            : ""}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{ownerBadge(item.owner)}</td>
                  <td>
                    <span className="category-pill">{item.category}</span>
                  </td>
                  <td>
                    <button
                      className={`status-button ${item.status}`}
                      onClick={() =>
                        onUpdate(item.id, {
                          status: item.status === "paid" ? "pending" : "paid",
                        })
                      }
                    >
                      <i />
                      {item.status === "paid"
                        ? "Pago"
                        : item.status === "scheduled"
                          ? "Agendado"
                          : "Pendente"}
                    </button>
                  </td>
                  <td className={`right amount ${item.kind}`}>
                    {item.kind === "expense"
                      ? "− "
                      : item.kind === "income"
                        ? "+ "
                        : "↔ "}
                    {money(item.amountCents)}
                  </td>
                  <td>
                    <button
                      className="row-delete"
                      aria-label={`Excluir ${item.description}`}
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && (
          <EmptyState
            icon={ReceiptText}
            title="Nenhum lançamento encontrado"
            text="Mude o filtro ou adicione uma entrada ou saída."
            action="Novo lançamento"
            onAction={onAdd}
          />
        )}
      </article>
    </section>
  );
}

function Planning({
  month,
  transactions,
  budgets,
  goals,
  recurrences,
  onAdd,
  onDeleteBudget,
  onUpdateGoal,
  onDeleteGoal,
  onUpdateRecurrence,
  onDeleteRecurrence,
  notify,
}: {
  month: string;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  recurrences: Recurrence[];
  onAdd: (type: ModalType) => void;
  onDeleteBudget: (id: string) => void;
  onUpdateGoal: (id: string, patch: Partial<Goal>) => void;
  onDeleteGoal: (id: string) => void;
  onUpdateRecurrence: (id: string, patch: Partial<Recurrence>) => void;
  onDeleteRecurrence: (id: string) => void;
  notify: (m: string) => void;
}) {
  const spent = expenseByCategory(transactions);
  function contribute(goal: Goal) {
    const raw = window.prompt(
      `Quanto deseja adicionar à meta “${goal.name}”?`,
      `0,00`,
    );
    if (!raw) return;
    const amount = inputCents(raw);
    if (amount <= 0) return;
    onUpdateGoal(goal.id, {
      currentCents: Math.min(goal.targetCents, goal.currentCents + amount),
      status:
        goal.currentCents + amount >= goal.targetCents ? "completed" : "active",
    });
    notify("Aporte registrado na meta.");
  }
  return (
    <section className="section-stack">
      <div className="two-column">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span>LIMITES DO MÊS</span>
              <h3>Orçamentos por categoria</h3>
            </div>
            <button
              className="primary-button compact"
              onClick={() => onAdd("budget")}
            >
              <Plus size={15} /> Definir limite
            </button>
          </div>
          <div className="budget-list">
            {budgets.map((budget) => {
              const actual =
                spent.find(([category]) => category === budget.category)?.[1] ??
                0;
              const pct = budget.limitCents
                ? Math.round((actual / budget.limitCents) * 100)
                : 0;
              return (
                <div key={budget.id}>
                  <div>
                    <span>
                      <i className="mini-avatar joint">
                        {ownerLabel(budget.owner).slice(0, 1)}
                      </i>
                      <b>
                        {budget.category}
                        <small>{ownerLabel(budget.owner)}</small>
                      </b>
                    </span>
                    <strong>
                      {money(actual)}{" "}
                      <small>de {money(budget.limitCents)}</small>
                    </strong>
                    <button
                      onClick={() => onDeleteBudget(budget.id)}
                      aria-label={`Excluir orçamento de ${budget.category}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <em className={pct > 100 ? "over" : ""}>
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </em>
                  <p>
                    {pct > 100
                      ? `${money(actual - budget.limitCents)} acima do limite`
                      : `${Math.max(0, 100 - pct)}% disponível`}
                  </p>
                </div>
              );
            })}
            {!budgets.length && (
              <EmptyState
                icon={Target}
                title="Nenhum orçamento definido"
                text={`Crie limites por categoria para ${monthLabel(month)}.`}
                action="Criar orçamento"
                onAction={() => onAdd("budget")}
              />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span>OBJETIVOS</span>
              <h3>Metas e reservas</h3>
            </div>
            <button
              className="primary-button compact"
              onClick={() => onAdd("goal")}
            >
              <Plus size={15} /> Nova meta
            </button>
          </div>
          <div className="goal-list">
            {goals.map((goal) => {
              const pct = goal.targetCents
                ? Math.round((goal.currentCents / goal.targetCents) * 100)
                : 0;
              return (
                <div className="goal-card" key={goal.id}>
                  <header>
                    <span className="bill-icon green">
                      <Target size={18} />
                    </span>
                    <p>
                      <strong>{goal.name}</strong>
                      <small>
                        {ownerLabel(goal.owner)} · até{" "}
                        {dateLabel(goal.targetDate)}
                      </small>
                    </p>
                    <button
                      onClick={() => onDeleteGoal(goal.id)}
                      aria-label={`Excluir meta ${goal.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </header>
                  <div>
                    <span>{money(goal.currentCents)}</span>
                    <b>{money(goal.targetCents)}</b>
                  </div>
                  <em>
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </em>
                  <footer>
                    <span>{pct}% concluído</span>
                    <button onClick={() => contribute(goal)}>
                      Adicionar valor
                    </button>
                  </footer>
                </div>
              );
            })}
            {!goals.length && (
              <EmptyState
                icon={PiggyBank}
                title="Nenhuma meta criada"
                text="Planejem uma reserva, viagem ou grande compra."
                action="Criar meta"
                onAction={() => onAdd("goal")}
              />
            )}
          </div>
        </article>
      </div>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <span>AUTOMAÇÃO</span>
            <h3>Entradas e despesas recorrentes</h3>
          </div>
          <button
            className="primary-button compact"
            onClick={() => onAdd("recurrence")}
          >
            <Plus size={15} /> Nova recorrência
          </button>
        </div>
        <div className="recurrence-grid">
          {recurrences.map((item) => (
            <div className="recurrence-card" key={item.id}>
              <span
                className={`bill-icon ${item.kind === "income" ? "green" : "purple"}`}
              >
                <Repeat2 size={18} />
              </span>
              <p>
                <strong>{item.description}</strong>
                <small>
                  {item.frequency === "monthly" ? "Mensal" : "Anual"} ·{" "}
                  {item.category} · {ownerLabel(item.owner)}
                </small>
              </p>
              <b>
                {money(item.amountCents)}
                <small>Próxima: {dateLabel(item.nextDate)}</small>
              </b>
              <button
                className={`toggle ${item.active ? "on" : ""}`}
                onClick={() =>
                  onUpdateRecurrence(item.id, { active: !item.active })
                }
                aria-label={
                  item.active ? "Desativar recorrência" : "Ativar recorrência"
                }
              >
                <i />
              </button>
              <button
                className="row-delete"
                onClick={() => onDeleteRecurrence(item.id)}
                aria-label={`Excluir ${item.description}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function Debts({
  items,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: Debt[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Debt>) => void;
  onDelete: (id: string) => void;
}) {
  const pending = items.filter((item) => item.status !== "paid");
  const remaining = pending.reduce(
    (sum, item) => sum + installmentRemaining(item),
    0,
  );
  const monthly = pending.reduce((sum, item) => sum + item.installmentCents, 0);
  return (
    <section className="section-stack">
      <div className="metric-row">
        <Metric
          icon={HandCoins}
          label="Saldo a pagar"
          value={money(remaining)}
          tone="orange"
        />
        <Metric
          icon={CalendarDays}
          label="Parcelas do mês"
          value={money(monthly)}
          tone="purple"
        />
        <Metric
          icon={Check}
          label="Compromissos ativos"
          value={String(pending.length)}
          tone="green"
        />
      </div>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <span>ACOMPANHAMENTO</span>
            <h3>Parcelas e pagamentos</h3>
          </div>
          <button className="primary-button compact" onClick={onAdd}>
            <Plus size={16} /> Nova dívida
          </button>
        </div>
        <div className="debt-grid">
          {items.map((item) => {
            const progress = Math.min(
              100,
              (item.installmentCurrent / item.installmentTotal) * 100,
            );
            return (
              <article className="debt-card" key={item.id}>
                <div className="debt-card-top">
                  <span className="bill-icon orange">
                    <HandCoins size={19} />
                  </span>
                  {ownerBadge(item.owner)}
                  <button
                    onClick={() => onDelete(item.id)}
                    aria-label={`Excluir ${item.description}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <h4>{item.description}</h4>
                <div className="debt-numbers">
                  <span>
                    Parcela atual<strong>{money(item.installmentCents)}</strong>
                  </span>
                  <span>
                    Saldo estimado
                    <strong>{money(installmentRemaining(item))}</strong>
                  </span>
                </div>
                <div className="debt-progress-label">
                  <span>
                    Parcela {item.installmentCurrent} de {item.installmentTotal}
                  </span>
                  <b>{Math.round(progress)}%</b>
                </div>
                <div className="debt-progress">
                  <i style={{ width: `${progress}%` }} />
                </div>
                <footer>
                  <span>Vence em {dateLabel(item.dueDate)}</span>
                  <button
                    className={item.status === "paid" ? "paid" : ""}
                    onClick={() =>
                      onUpdate(item.id, {
                        status: item.status === "paid" ? "pending" : "paid",
                      })
                    }
                  >
                    {item.status === "paid" ? (
                      <>
                        <Check size={14} /> Pago
                      </>
                    ) : (
                      "Marcar como pago"
                    )}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
        {!items.length && (
          <EmptyState
            icon={HandCoins}
            title="Nenhuma dívida registrada"
            text="Inclua parcelas individuais ou compartilhadas."
            action="Adicionar dívida"
            onAction={onAdd}
          />
        )}
      </article>
    </section>
  );
}

function Assets({
  items,
  onAdd,
  onDelete,
}: {
  items: Account[];
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const groups = [
    {
      types: ["checking", "savings", "cash"],
      label: "Dinheiro disponível",
      icon: Landmark,
      tone: "purple",
    },
    {
      types: ["investment"],
      label: "Investimentos",
      icon: WalletCards,
      tone: "green",
    },
    { types: ["pension"], label: "Previdência", icon: PiggyBank, tone: "blue" },
    {
      types: ["insurance"],
      label: "Seguros",
      icon: ShieldCheck,
      tone: "orange",
    },
    { types: ["other"], label: "Outros bens", icon: Banknote, tone: "purple" },
  ];
  const totals = accountTotals(items, "all");
  return (
    <section className="section-stack">
      <article className="wealth-hero">
        <div>
          <span>PATRIMÔNIO FINANCEIRO</span>
          <h2>{money(totals.netWorthCents)}</h2>
          <p>Capital segurado fica separado para não inflar o patrimônio.</p>
        </div>
        <div>
          <span>Capital segurado</span>
          <strong>{money(totals.insuredCents)}</strong>
          <ShieldCheck size={28} />
        </div>
      </article>
      <div className="asset-groups">
        {groups.map(({ types, label, icon: Icon, tone }) => {
          const matches = items.filter((item) => types.includes(item.type));
          const subtotal = matches.reduce(
            (sum, item) => sum + item.balanceCents,
            0,
          );
          return (
            <article className="panel asset-group" key={label}>
              <header>
                <span className={`metric-icon ${tone}`}>
                  <Icon size={19} />
                </span>
                <div>
                  <span>{label}</span>
                  <strong>{money(subtotal)}</strong>
                </div>
                <button onClick={onAdd} aria-label={`Adicionar em ${label}`}>
                  <Plus size={17} />
                </button>
              </header>
              {matches.map((item) => (
                <div className="asset-row" key={item.id}>
                  <span>
                    {ownerBadge(item.owner, false)}
                    <i>
                      <b>{item.name}</b>
                      <small>{item.institution}</small>
                    </i>
                  </span>
                  <strong>{money(item.balanceCents)}</strong>
                  <button
                    className="row-delete"
                    onClick={() => onDelete(item.id)}
                    aria-label={`Excluir ${item.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {!matches.length && (
                <p className="empty-mini">Nada cadastrado.</p>
              )}
            </article>
          );
        })}
      </div>
      <button className="floating-add" onClick={onAdd}>
        <Plus size={18} /> Adicionar conta ou patrimônio
      </button>
    </section>
  );
}

function Invoices({
  state,
  scope,
  month,
  cards,
  analysis,
  uploading,
  onAddCard,
  onDeleteCard,
  onImport,
  setUploading,
  onUpdateTransaction,
}: {
  state: FinanceState;
  scope: Scope;
  month: string;
  cards: CreditCardModel[];
  analysis: Analysis | null;
  uploading: boolean;
  onAddCard: () => void;
  onDeleteCard: (id: string) => void;
  onImport: (
    invoice: Invoice,
    transactions: Transaction[],
    analysis: Analysis,
  ) => void;
  setUploading: (value: boolean) => void;
  onUpdateTransaction: (id: string, patch: Partial<Transaction>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cardId, setCardId] = useState("");
  const imported = state.transactions.filter(
    (item) =>
      item.source === "invoice" &&
      item.transactionDate.startsWith(month) &&
      matchesScope(item.owner, scope),
  );
  const visibleInvoices = state.invoices.filter(
    (invoice) => invoice.period === month && matchesScope(invoice.owner, scope),
  );
  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("owner", scope === "all" ? "joint" : scope);
      form.append("period", month);
      form.append("cardId", cardId);
      const response = await fetch("/api/invoices", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        error?: string;
        invoice?: Invoice;
        transactions?: Transaction[];
        analysis?: Analysis;
      };
      if (
        !response.ok ||
        !result.invoice ||
        !result.transactions ||
        !result.analysis
      )
        throw new Error(result.error || "Não foi possível analisar a fatura.");
      onImport(result.invoice, result.transactions, result.analysis);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Não foi possível analisar a fatura.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <section className="section-stack">
      <div className="card-strip">
        <div>
          <span>Cartões cadastrados</span>
          <strong>{cards.length}</strong>
        </div>
        {cards.map((card) => (
          <article key={card.id}>
            <span>
              <CreditCard size={18} />
              {ownerLabel(card.owner)}
            </span>
            <strong>{card.name}</strong>
            <small>
              {card.institution} · fecha dia {card.closingDay} · vence dia{" "}
              {card.dueDay}
            </small>
            <b>Limite {money(card.limitCents)}</b>
            <button
              onClick={() => onDeleteCard(card.id)}
              aria-label={`Excluir cartão ${card.name}`}
            >
              <Trash2 size={13} />
            </button>
          </article>
        ))}
        <button className="add-card" onClick={onAddCard}>
          <Plus size={17} /> Cadastrar cartão
        </button>
      </div>
      <article
        className={`upload-panel ${uploading ? "loading" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void upload(file);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.csv,.txt,application/pdf,text/csv"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <span className="upload-icon">
          {uploading ? <Sparkles size={27} /> : <UploadCloud size={27} />}
        </span>
        <div>
          <h3>{uploading ? "Analisando compras…" : "Envie uma fatura"}</h3>
          <p>
            {uploading
              ? "Identificando datas, parcelas e categorias."
              : "Arraste PDF ou CSV. Nesta etapa local, o arquivo é processado e não permanece armazenado."}
          </p>
          {state.cards.length > 0 && (
            <label className="upload-card-select">
              Cartão{" "}
              <select
                value={cardId}
                onChange={(event) => setCardId(event.target.value)}
              >
                <option value="">Sem vincular</option>
                {state.cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} · {ownerLabel(card.owner)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          className="primary-button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={17} />
          {uploading ? "Processando" : "Escolher arquivo"}
        </button>
        <small>PDF, CSV ou TXT · máximo 10 MB</small>
      </article>
      {analysis && (
        <article className="analysis-card">
          <div className="analysis-success">
            <FileCheck2 size={24} />
            <div>
              <strong>Fatura organizada</strong>
              <span>
                {analysis.itemCount} compras · {money(analysis.totalCents)}
              </span>
            </div>
          </div>
          <div className="analysis-categories">
            {Object.entries(analysis.byCategory)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([name, value], index) => (
                <div key={name}>
                  <i style={{ background: categoryColors[index] }} />
                  <span>{name}</span>
                  <b>{money(value)}</b>
                </div>
              ))}
          </div>
        </article>
      )}
      <article className="panel data-panel">
        <div className="panel-heading">
          <div>
            <span>COMPRAS IMPORTADAS</span>
            <h3>Revise as categorias</h3>
          </div>
          <span className="pill">{imported.length} itens</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Compra</th>
                <th>Responsável</th>
                <th>Categoria</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {imported.map((item) => (
                <tr key={item.id}>
                  <td>{dateLabel(item.transactionDate)}</td>
                  <td>
                    <div className="description-cell">
                      <i className="transaction-icon expense">
                        <CreditCard size={15} />
                      </i>
                      <span>
                        <strong>{item.description}</strong>
                        <small>
                          {item.installmentTotal
                            ? `Parcela ${item.installmentCurrent}/${item.installmentTotal}`
                            : "Compra à vista"}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{ownerBadge(item.owner)}</td>
                  <td>
                    <select
                      className="category-select"
                      value={item.category}
                      onChange={(event) =>
                        onUpdateTransaction(item.id, {
                          category: event.target.value,
                        })
                      }
                    >
                      {state.categories
                        .filter((category) => category !== "Salário")
                        .map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                    </select>
                  </td>
                  <td className="right amount expense">
                    {money(item.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!imported.length && (
          <EmptyState
            icon={CreditCard}
            title="Nenhuma fatura analisada"
            text="Cadastre um cartão ou importe a primeira fatura."
            action="Escolher fatura"
            onAction={() => fileRef.current?.click()}
          />
        )}
      </article>
      {visibleInvoices.length > 0 && (
        <article className="panel invoice-history">
          <div className="panel-heading">
            <div>
              <span>ARQUIVOS PROCESSADOS</span>
              <h3>Histórico do período</h3>
            </div>
          </div>
          {visibleInvoices.map((invoice) => (
            <div key={invoice.id}>
              <span className="bill-icon purple">
                <FileCheck2 size={18} />
              </span>
              <p>
                <strong>{invoice.filename}</strong>
                <small>
                  {monthLabel(invoice.period)} · {invoice.itemCount} compras
                </small>
              </p>
              {ownerBadge(invoice.owner)}
              <b>{money(invoice.totalCents)}</b>
              <em className="review">Revisar</em>
            </div>
          ))}
        </article>
      )}
    </section>
  );
}

function SettingsView({
  state,
  onUpdatePerson,
  onUpdateSplit,
  onAddCategory,
  onReset,
}: {
  state: FinanceState;
  onUpdatePerson: (
    id: "kim" | "alexandre",
    patch: { monthlyIncomeCents?: number },
  ) => void;
  onUpdateSplit: (split: FinanceState["split"]) => void;
  onAddCategory: (category: string) => void;
  onReset: () => void;
}) {
  const split = customSplit(100_000, state.split, state.people);
  const [category, setCategory] = useState("");
  return (
    <section className="settings-grid">
      <article className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <span>PERFIS</span>
            <h3>Renda mensal de cada pessoa</h3>
          </div>
        </div>
        {state.people.map((person) => (
          <SalaryField
            key={person.id}
            name={person.name}
            id={person.id}
            value={person.monthlyIncomeCents}
            onSave={(cents) =>
              onUpdatePerson(person.id, { monthlyIncomeCents: cents })
            }
          />
        ))}
      </article>
      <article className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <span>DIVISÃO COMPARTILHADA</span>
            <h3>Regra padrão</h3>
          </div>
        </div>
        <div className="split-options">
          {(["proportional", "equal", "custom"] as const).map((method) => (
            <button
              key={method}
              className={state.split.method === method ? "selected" : ""}
              onClick={() => onUpdateSplit({ ...state.split, method })}
            >
              {method === "proportional"
                ? "Proporcional à renda"
                : method === "equal"
                  ? "Igual, 50 / 50"
                  : "Personalizada"}
              <small>
                {method === "proportional"
                  ? "Recalcula quando a renda muda"
                  : method === "equal"
                    ? "Cada um paga metade"
                    : "Defina os percentuais"}
              </small>
            </button>
          ))}
        </div>
        {state.split.method === "custom" && (
          <div className="custom-split">
            <label>
              Kim{" "}
              <input
                type="number"
                min="0"
                max="100"
                value={state.split.kimPercent}
                onChange={(event) => {
                  const kim = Math.min(
                    100,
                    Math.max(0, Number(event.target.value)),
                  );
                  onUpdateSplit({
                    ...state.split,
                    kimPercent: kim,
                    alexandrePercent: 100 - kim,
                  });
                }}
              />
              %
            </label>
            <label>
              Alexandre <input disabled value={state.split.alexandrePercent} />{" "}
              %
            </label>
          </div>
        )}
        <div className="split-example">
          <span>Exemplo sobre R$ 1.000</span>
          <strong>
            Kim {money(split.kimCents)} · Alexandre{" "}
            {money(split.alexandreCents)}
          </strong>
        </div>
      </article>
      <article className="panel settings-panel category-settings">
        <div className="panel-heading">
          <div>
            <span>ORGANIZAÇÃO</span>
            <h3>Categorias</h3>
          </div>
        </div>
        <div className="category-cloud">
          {state.categories.map((item, index) => (
            <span key={item}>
              <i
                style={{
                  background: categoryColors[index % categoryColors.length],
                }}
              />
              {item}
            </span>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (category.trim()) {
              onAddCategory(category.trim());
              setCategory("");
            }
          }}
        >
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Nova categoria"
          />
          <button className="secondary-button">
            <Plus size={15} /> Adicionar
          </button>
        </form>
      </article>
      <article className="panel settings-panel connection-panel">
        <div className="panel-heading">
          <div>
            <span>CONEXÃO</span>
            <h3>Ambiente do sistema</h3>
          </div>
          <span className="status-local">Funcional local</span>
        </div>
        <div className="connection-flow">
          <span>
            <strong>GitHub</strong>
            <small>Repositório definido</small>
          </span>
          <i>→</i>
          <span>
            <strong>Vercel</strong>
            <small>Próxima etapa</small>
          </span>
          <i>→</i>
          <span>
            <strong>Supabase</strong>
            <small>Próxima etapa</small>
          </span>
        </div>
        <p>
          As telas e regras estão ativas nesta sessão. Persistência, login e
          armazenamento de faturas entram na primeira integração com Supabase.
        </p>
        <button className="danger-button" onClick={onReset}>
          Restaurar dados locais
        </button>
      </article>
    </section>
  );
}

function SalaryField({
  name,
  id,
  value,
  onSave,
}: {
  name: string;
  id: "kim" | "alexandre";
  value: number;
  onSave: (cents: number) => void;
}) {
  const [draft, setDraft] = useState(
    (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
  );
  return (
    <label className="salary-field">
      <span>
        {ownerBadge(id, false)}
        <small>{name} · renda líquida mensal</small>
      </span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onSave(inputCents(draft))}
      />
    </label>
  );
}

type CreatedEntity =
  | { type: "transaction"; value: Transaction }
  | { type: "debt"; value: Debt }
  | { type: "account"; value: Account }
  | { type: "budget"; value: Budget }
  | { type: "goal"; value: Goal }
  | { type: "recurrence"; value: Recurrence }
  | { type: "card"; value: CreditCardModel };

function CreateModal({
  type,
  state,
  month,
  onClose,
  onCreate,
}: {
  type: ModalType;
  state: FinanceState;
  month: string;
  onClose: () => void;
  onCreate: (entity: CreatedEntity) => void;
}) {
  const nextYear = `${Number(month.slice(0, 4)) + 1}-${month.slice(5)}-01`;
  const [form, setForm] = useState<Record<string, string>>({
    owner: "joint",
    kind: "expense",
    category: "Outros",
    status: "paid",
    date: `${month}-01`,
    dueDate: `${month}-28`,
    current: "1",
    totalInstallments: "1",
    accountType: "checking",
    frequency: "monthly",
    nextDate: `${month}-01`,
    targetDate: nextYear,
    closingDay: "20",
    dueDay: "28",
    includeInNetWorth: "yes",
  });
  function field(name: string) {
    return {
      value: form[name] || "",
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
      ) => setForm({ ...form, [name]: event.target.value }),
    };
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const owner = form.owner as Owner;
    if (type === "transaction")
      onCreate({
        type,
        value: {
          id: nextId("tx"),
          owner,
          kind: form.kind as Transaction["kind"],
          description: form.description,
          category: form.category,
          amountCents: inputCents(form.amount),
          transactionDate: form.date,
          status: form.status as Transaction["status"],
          source: "manual",
          accountId: form.accountId || null,
          cardId: form.cardId || null,
          note: form.note || "",
        },
      });
    if (type === "debt")
      onCreate({
        type,
        value: {
          id: nextId("debt"),
          owner,
          description: form.description,
          totalCents: inputCents(form.total),
          installmentCents: inputCents(form.installment || form.total),
          installmentCurrent: Number(form.current),
          installmentTotal: Number(form.totalInstallments),
          dueDate: form.dueDate,
          status: "pending",
          category: form.category,
        },
      });
    if (type === "account")
      onCreate({
        type,
        value: {
          id: nextId("account"),
          owner,
          name: form.name,
          institution: form.institution,
          type: form.accountType as Account["type"],
          balanceCents: inputCents(form.balance),
          includeInNetWorth: form.includeInNetWorth === "yes",
        },
      });
    if (type === "budget")
      onCreate({
        type,
        value: {
          id: nextId("budget"),
          owner,
          category: form.category,
          month,
          limitCents: inputCents(form.limit),
        },
      });
    if (type === "goal")
      onCreate({
        type,
        value: {
          id: nextId("goal"),
          owner,
          name: form.name,
          targetCents: inputCents(form.target),
          currentCents: inputCents(form.currentValue),
          targetDate: form.targetDate,
          status: "active",
        },
      });
    if (type === "recurrence")
      onCreate({
        type,
        value: {
          id: nextId("rec"),
          owner,
          description: form.description,
          category: form.category,
          amountCents: inputCents(form.amount),
          kind: form.kind as "income" | "expense",
          frequency: form.frequency as "monthly" | "annual",
          nextDate: form.nextDate,
          active: true,
        },
      });
    if (type === "card")
      onCreate({
        type,
        value: {
          id: nextId("card"),
          owner,
          name: form.name,
          institution: form.institution,
          closingDay: Number(form.closingDay),
          dueDay: Number(form.dueDay),
          limitCents: inputCents(form.limit),
        },
      });
  }
  const title = {
    transaction: "Novo lançamento",
    debt: "Nova dívida",
    account: "Nova conta ou patrimônio",
    budget: "Novo orçamento",
    goal: "Nova meta",
    recurrence: "Nova recorrência",
    card: "Novo cartão",
  }[type];
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <header>
          <div>
            <span>ADICIONAR</span>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        <div className="form-grid">
          <OwnerField {...field("owner")} />
          {type === "transaction" && (
            <>
              <label>
                Tipo
                <select {...field("kind")}>
                  <option value="expense">Saída</option>
                  <option value="income">Entrada</option>
                  <option value="transfer">Transferência</option>
                </select>
              </label>
              <label>
                Status
                <select {...field("status")}>
                  <option value="paid">Pago / recebido</option>
                  <option value="pending">Pendente</option>
                  <option value="scheduled">Agendado</option>
                </select>
              </label>
              <label className="full">
                Descrição
                <input
                  required
                  placeholder="Ex.: Supermercado"
                  {...field("description")}
                />
              </label>
              <MoneyField label="Valor" field={field("amount")} />
              <label>
                Data
                <input required type="date" {...field("date")} />
              </label>
              <CategoryField
                categories={state.categories}
                field={field("category")}
              />
              {state.accounts.length > 0 && (
                <label>
                  Conta
                  <select {...field("accountId")}>
                    <option value="">Sem vincular</option>
                    {state.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {ownerLabel(account.owner)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {state.cards.length > 0 && (
                <label>
                  Cartão
                  <select {...field("cardId")}>
                    <option value="">Sem vincular</option>
                    {state.cards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name} · {ownerLabel(card.owner)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="full">
                Observação
                <input placeholder="Opcional" {...field("note")} />
              </label>
            </>
          )}
          {type === "debt" && (
            <>
              <label className="full">
                Descrição
                <input
                  required
                  placeholder="Ex.: Financiamento"
                  {...field("description")}
                />
              </label>
              <MoneyField label="Valor total" field={field("total")} />
              <MoneyField
                label="Valor da parcela"
                field={field("installment")}
              />
              <label>
                Parcela atual
                <input required type="number" min="1" {...field("current")} />
              </label>
              <label>
                Total de parcelas
                <input
                  required
                  type="number"
                  min="1"
                  {...field("totalInstallments")}
                />
              </label>
              <label>
                Próximo vencimento
                <input required type="date" {...field("dueDate")} />
              </label>
              <CategoryField
                categories={state.categories}
                field={field("category")}
                compact
              />
            </>
          )}
          {type === "account" && (
            <>
              <label>
                Tipo
                <select {...field("accountType")}>
                  <option value="checking">Conta corrente</option>
                  <option value="savings">Poupança / reserva</option>
                  <option value="investment">Investimento</option>
                  <option value="pension">Previdência</option>
                  <option value="insurance">Seguro</option>
                  <option value="cash">Dinheiro</option>
                  <option value="other">Outro bem</option>
                </select>
              </label>
              <MoneyField label="Saldo ou capital" field={field("balance")} />
              <label className="full">
                Nome
                <input
                  required
                  placeholder="Ex.: Reserva de emergência"
                  {...field("name")}
                />
              </label>
              <label>
                Instituição
                <input
                  required
                  placeholder="Banco ou seguradora"
                  {...field("institution")}
                />
              </label>
              <label>
                Somar ao patrimônio?
                <select {...field("includeInNetWorth")}>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </select>
              </label>
            </>
          )}
          {type === "budget" && (
            <>
              <CategoryField
                categories={state.categories}
                field={field("category")}
              />
              <MoneyField label="Limite mensal" field={field("limit")} />
            </>
          )}
          {type === "goal" && (
            <>
              <label className="full">
                Nome da meta
                <input
                  required
                  placeholder="Ex.: Reserva de emergência"
                  {...field("name")}
                />
              </label>
              <MoneyField label="Valor-alvo" field={field("target")} />
              <MoneyField
                label="Valor já guardado"
                field={field("currentValue")}
              />
              <label className="full">
                Data desejada
                <input required type="date" {...field("targetDate")} />
              </label>
            </>
          )}
          {type === "recurrence" && (
            <>
              <label>
                Tipo
                <select {...field("kind")}>
                  <option value="expense">Saída</option>
                  <option value="income">Entrada</option>
                </select>
              </label>
              <label>
                Frequência
                <select {...field("frequency")}>
                  <option value="monthly">Mensal</option>
                  <option value="annual">Anual</option>
                </select>
              </label>
              <label className="full">
                Descrição
                <input
                  required
                  placeholder="Ex.: Streaming"
                  {...field("description")}
                />
              </label>
              <MoneyField label="Valor" field={field("amount")} />
              <label>
                Próxima data
                <input required type="date" {...field("nextDate")} />
              </label>
              <CategoryField
                categories={state.categories}
                field={field("category")}
              />
            </>
          )}
          {type === "card" && (
            <>
              <label className="full">
                Nome do cartão
                <input
                  required
                  placeholder="Ex.: Cartão principal"
                  {...field("name")}
                />
              </label>
              <label>
                Instituição
                <input required placeholder="Banco" {...field("institution")} />
              </label>
              <MoneyField label="Limite" field={field("limit")} />
              <label>
                Dia de fechamento
                <input
                  required
                  type="number"
                  min="1"
                  max="31"
                  {...field("closingDay")}
                />
              </label>
              <label>
                Dia de vencimento
                <input
                  required
                  type="number"
                  min="1"
                  max="31"
                  {...field("dueDay")}
                />
              </label>
            </>
          )}
        </div>
        <footer>
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button">
            Salvar
          </button>
        </footer>
      </form>
    </div>
  );
}

function OwnerField(props: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="full">
      Responsável
      <select {...props}>
        <option value="joint">Compartilhado</option>
        <option value="kim">Kim</option>
        <option value="alexandre">Alexandre</option>
      </select>
    </label>
  );
}
function MoneyField({
  label,
  field,
}: {
  label: string;
  field: {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  };
}) {
  return (
    <label>
      {label}
      <input required inputMode="decimal" placeholder="0,00" {...field} />
    </label>
  );
}
function CategoryField({
  categories,
  field,
  compact = false,
}: {
  categories: string[];
  field: {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  };
  compact?: boolean;
}) {
  return (
    <label className={compact ? "" : "full"}>
      Categoria
      <select {...field}>
        {categories.map((category) => (
          <option key={category}>{category}</option>
        ))}
      </select>
    </label>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon ${tone}`}>
        <Icon size={19} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
function EmptyMini({ text }: { text: string }) {
  return <p className="empty-mini">{text}</p>;
}
function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={25} />
      </span>
      <h4>{title}</h4>
      <p>{text}</p>
      <button className="secondary-button" onClick={onAction}>
        <Plus size={16} />
        {action}
      </button>
    </div>
  );
}
