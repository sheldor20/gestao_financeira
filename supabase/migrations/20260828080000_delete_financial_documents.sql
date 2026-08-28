-- Delete an imported document and every financial charge created from it.
-- The database cleanup is atomic; the application removes the private file first.

create or replace function public.delete_financial_document(
  household_id_input uuid,
  document_id_input uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  document_record record;
  debt_record record;
  latest_snapshot record;
  latest_installment record;
  deleted_transactions integer := 0;
  deleted_invoices integer := 0;
  deleted_installments integer := 0;
  deleted_snapshots integer := 0;
  deleted_debts integer := 0;
  detached_accounts integer := 0;
begin
  if not public.is_household_member(household_id_input) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select id, storage_path
  into document_record
  from public.financial_documents
  where id = document_id_input
    and household_id = household_id_input
  for update;

  if not found then
    raise exception 'Documento não encontrado.' using errcode = 'P0002';
  end if;

  -- Invoice items are removed by their invoice cascade before transactions,
  -- avoiding references from legacy invoice items to imported transactions.
  delete from public.invoices
  where household_id = household_id_input
    and source_document_id = document_id_input;
  get diagnostics deleted_invoices = row_count;

  delete from public.transactions
  where household_id = household_id_input
    and source_document_id = document_id_input;
  get diagnostics deleted_transactions = row_count;

  delete from public.debt_installments
  where household_id = household_id_input
    and source_document_id = document_id_input;
  get diagnostics deleted_installments = row_count;

  delete from public.debt_snapshots
  where household_id = household_id_input
    and source_document_id = document_id_input;
  get diagnostics deleted_snapshots = row_count;

  -- If this was the newest financing statement, restore the previous snapshot.
  -- If it was the only statement, remove the imported debt and preserve unrelated
  -- transactions by detaching their optional debt link.
  for debt_record in
    select id
    from public.debts
    where household_id = household_id_input
      and source_document_id = document_id_input
    for update
  loop
    select
      source_document_id,
      statement_date,
      outstanding_cents,
      installment_cents,
      installment_current,
      installment_total,
      amortization_cents,
      interest_rate_annual
    into latest_snapshot
    from public.debt_snapshots
    where household_id = household_id_input
      and debt_id = debt_record.id
    order by statement_date desc, created_at desc
    limit 1;

    if found then
      update public.debt_installments
      set status = case
            when due_date < current_date then 'overdue'
            else 'pending'
          end,
          updated_by = auth.uid()
      where household_id = household_id_input
        and debt_id = debt_record.id
        and source_document_id = latest_snapshot.source_document_id
        and status = 'superseded';

      select installment_number, due_date, amount_cents
      into latest_installment
      from public.debt_installments
      where household_id = household_id_input
        and debt_id = debt_record.id
        and source_document_id = latest_snapshot.source_document_id
        and status in ('pending', 'overdue', 'partially_paid')
      order by due_date, installment_number
      limit 1;

      update public.debts
      set installment_cents = latest_snapshot.installment_cents,
          installment_current = latest_snapshot.installment_current,
          installment_total = latest_snapshot.installment_total,
          due_date = coalesce(latest_installment.due_date, due_date),
          status = case
            when latest_snapshot.outstanding_cents = 0 then 'paid'
            when latest_installment.due_date < current_date then 'overdue'
            else 'pending'
          end,
          outstanding_cents = latest_snapshot.outstanding_cents,
          interest_rate_annual = latest_snapshot.interest_rate_annual,
          last_statement_date = latest_snapshot.statement_date,
          last_amortization_cents = latest_snapshot.amortization_cents,
          source_document_id = latest_snapshot.source_document_id,
          updated_by = auth.uid()
      where id = debt_record.id
        and household_id = household_id_input;
    else
      update public.transactions
      set debt_id = null,
          updated_by = auth.uid()
      where household_id = household_id_input
        and debt_id = debt_record.id;

      delete from public.debts
      where id = debt_record.id
        and household_id = household_id_input;
      deleted_debts := deleted_debts + 1;
    end if;
  end loop;

  -- Accounts may be long-lived and referenced by goals or later movements. Keep
  -- them, but remove the deleted document as their current evidence source.
  update public.accounts
  set source_document_id = null,
      updated_by = auth.uid()
  where household_id = household_id_input
    and source_document_id = document_id_input;
  get diagnostics detached_accounts = row_count;

  delete from public.financial_documents
  where id = document_id_input
    and household_id = household_id_input;

  perform public.reclassify_fixed_expenses(household_id_input);

  return jsonb_build_object(
    'storage_path', document_record.storage_path,
    'deleted_transactions', deleted_transactions,
    'deleted_invoices', deleted_invoices,
    'deleted_installments', deleted_installments,
    'deleted_snapshots', deleted_snapshots,
    'deleted_debts', deleted_debts,
    'detached_accounts', detached_accounts
  );
end;
$$;

revoke all on function public.delete_financial_document(uuid, uuid) from public;
grant execute on function public.delete_financial_document(uuid, uuid) to authenticated;

-- Database documents are shared by the household, so either active member must
-- also be able to remove the corresponding private object.
drop policy if exists "members can delete their financial files" on storage.objects;
create policy "members can delete their financial files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'financial-documents'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);
