"use client";

import { useState } from "react";
import type {
  Account,
  Budget,
  CreditCard,
  Debt,
  FinanceState,
  Goal,
  Invoice,
  Person,
  Recurrence,
  SplitSettings,
  Transaction,
} from "./finance-domain";
import { initialFinanceState } from "./mock-finance";

export function useFinanceStore() {
  const [state, setState] = useState<FinanceState>(initialFinanceState);

  return {
    state,
    addTransaction: (item: Transaction) =>
      setState((current) => ({
        ...current,
        transactions: [item, ...current.transactions],
      })),
    updateTransaction: (id: string, patch: Partial<Transaction>) =>
      setState((current) => ({
        ...current,
        transactions: current.transactions.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    deleteTransaction: (id: string) =>
      setState((current) => ({
        ...current,
        transactions: current.transactions.filter((item) => item.id !== id),
      })),
    addDebt: (item: Debt) =>
      setState((current) => ({ ...current, debts: [item, ...current.debts] })),
    updateDebt: (id: string, patch: Partial<Debt>) =>
      setState((current) => ({
        ...current,
        debts: current.debts.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    deleteDebt: (id: string) =>
      setState((current) => ({
        ...current,
        debts: current.debts.filter((item) => item.id !== id),
      })),
    addAccount: (item: Account) =>
      setState((current) => ({
        ...current,
        accounts: [item, ...current.accounts],
      })),
    updateAccount: (id: string, patch: Partial<Account>) =>
      setState((current) => ({
        ...current,
        accounts: current.accounts.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    deleteAccount: (id: string) =>
      setState((current) => ({
        ...current,
        accounts: current.accounts.filter((item) => item.id !== id),
      })),
    addCard: (item: CreditCard) =>
      setState((current) => ({ ...current, cards: [item, ...current.cards] })),
    deleteCard: (id: string) =>
      setState((current) => ({
        ...current,
        cards: current.cards.filter((item) => item.id !== id),
      })),
    addBudget: (item: Budget) =>
      setState((current) => ({
        ...current,
        budgets: [
          item,
          ...current.budgets.filter(
            (budget) =>
              !(
                budget.month === item.month &&
                budget.owner === item.owner &&
                budget.category === item.category
              ),
          ),
        ],
      })),
    deleteBudget: (id: string) =>
      setState((current) => ({
        ...current,
        budgets: current.budgets.filter((item) => item.id !== id),
      })),
    addGoal: (item: Goal) =>
      setState((current) => ({ ...current, goals: [item, ...current.goals] })),
    updateGoal: (id: string, patch: Partial<Goal>) =>
      setState((current) => ({
        ...current,
        goals: current.goals.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    deleteGoal: (id: string) =>
      setState((current) => ({
        ...current,
        goals: current.goals.filter((item) => item.id !== id),
      })),
    addRecurrence: (item: Recurrence) =>
      setState((current) => ({
        ...current,
        recurrences: [item, ...current.recurrences],
      })),
    updateRecurrence: (id: string, patch: Partial<Recurrence>) =>
      setState((current) => ({
        ...current,
        recurrences: current.recurrences.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      })),
    deleteRecurrence: (id: string) =>
      setState((current) => ({
        ...current,
        recurrences: current.recurrences.filter((item) => item.id !== id),
      })),
    addInvoice: (invoice: Invoice, transactions: Transaction[]) =>
      setState((current) => ({
        ...current,
        invoices: [invoice, ...current.invoices],
        transactions: [...transactions, ...current.transactions],
      })),
    updatePerson: (id: Person["id"], patch: Partial<Person>) =>
      setState((current) => ({
        ...current,
        people: current.people.map((person) =>
          person.id === id ? { ...person, ...patch } : person,
        ),
      })),
    updateSplit: (split: SplitSettings) =>
      setState((current) => ({ ...current, split })),
    addCategory: (category: string) =>
      setState((current) =>
        current.categories.includes(category)
          ? current
          : { ...current, categories: [...current.categories, category] },
      ),
    resetDemo: () => setState(initialFinanceState),
  };
}
