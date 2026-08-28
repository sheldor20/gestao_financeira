-- Apply extracted financial data in one database transaction and keep retryable failures clean.

create or replace function public.apply_financial_document_import(
  household_id_input uuid,
  document_id_input uuid,
  transaction_rows_input jsonb,
  balance_rows_input jsonb,
  invoice_input jsonb,
  document_result_input jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  balance_row record;
  updated_accounts integer := 0;
  imported_transactions integer := 0;
begin
  if not public.is_household_member(household_id_input) then
    raise exception 'Acesso negado.';
  end if;

  if not exists (
    select 1
    from public.financial_documents
    where id = document_id_input
      and household_id = household_id_input
      and status = 'processing'
  ) then
    raise exception 'Documento não está disponível para aplicação.';
  end if;

  insert into public.transactions (
    household_id,
    owner_scope,
    owner_member_id,
    kind,
    description,
    category_label,
    amount_cents,
    transaction_date,
    status,
    source,
    account_id,
    credit_card_id,
    installment_current,
    installment_total,
    merchant_key,
    ai_confidence,
    source_document_id,
    debt_id,
    goal_id,
    external_fingerprint
  )
  select
    household_id_input,
    item.owner_scope,
    item.owner_member_id,
    item.kind,
    item.description,
    item.category_label,
    item.amount_cents,
    item.transaction_date,
    item.status,
    item.source,
    item.account_id,
    item.credit_card_id,
    item.installment_current,
    item.installment_total,
    item.merchant_key,
    item.ai_confidence,
    document_id_input,
    item.debt_id,
    item.goal_id,
    item.external_fingerprint
  from jsonb_to_recordset(coalesce(transaction_rows_input, '[]'::jsonb)) as item (
    owner_scope text,
    owner_member_id uuid,
    kind text,
    description text,
    category_label text,
    amount_cents bigint,
    transaction_date date,
    status text,
    source text,
    account_id uuid,
    credit_card_id uuid,
    installment_current integer,
    installment_total integer,
    merchant_key text,
    ai_confidence numeric,
    debt_id uuid,
    goal_id uuid,
    external_fingerprint text
  );

  get diagnostics imported_transactions = row_count;

  for balance_row in
    select *
    from jsonb_to_recordset(coalesce(balance_rows_input, '[]'::jsonb)) as balance (
      account_id uuid,
      owner_scope text,
      owner_member_id uuid,
      name text,
      institution text,
      account_type text,
      balance_cents bigint,
      balance_date date,
      include_in_net_worth boolean
    )
  loop
    if balance_row.account_id is not null then
      update public.accounts
      set balance_cents = balance_row.balance_cents,
          balance_date = balance_row.balance_date,
          institution = balance_row.institution,
          source_document_id = document_id_input,
          updated_by = auth.uid()
      where id = balance_row.account_id
        and household_id = household_id_input;

      if not found then
        raise exception 'Conta de destino não encontrada.';
      end if;
    else
      insert into public.accounts (
        household_id,
        owner_scope,
        owner_member_id,
        name,
        institution,
        account_type,
        balance_cents,
        balance_date,
        include_in_net_worth,
        source_document_id
      ) values (
        household_id_input,
        balance_row.owner_scope,
        balance_row.owner_member_id,
        balance_row.name,
        balance_row.institution,
        balance_row.account_type,
        balance_row.balance_cents,
        balance_row.balance_date,
        balance_row.include_in_net_worth,
        document_id_input
      );
    end if;

    updated_accounts := updated_accounts + 1;
  end loop;

  if invoice_input is not null and invoice_input <> 'null'::jsonb then
    insert into public.invoices (
      household_id,
      credit_card_id,
      owner_scope,
      owner_member_id,
      filename,
      period,
      total_cents,
      item_count,
      status,
      content_checksum,
      source_document_id
    ) values (
      household_id_input,
      nullif(invoice_input ->> 'credit_card_id', '')::uuid,
      invoice_input ->> 'owner_scope',
      nullif(invoice_input ->> 'owner_member_id', '')::uuid,
      invoice_input ->> 'filename',
      (invoice_input ->> 'period')::date,
      (invoice_input ->> 'total_cents')::bigint,
      (invoice_input ->> 'item_count')::integer,
      invoice_input ->> 'status',
      invoice_input ->> 'content_checksum',
      document_id_input
    );
  end if;

  perform public.reclassify_fixed_expenses(household_id_input);

  update public.financial_documents
  set institution = document_result_input ->> 'institution',
      period_start = nullif(document_result_input ->> 'period_start', '')::date,
      period_end = nullif(document_result_input ->> 'period_end', '')::date,
      status = 'applied',
      extraction_model = document_result_input ->> 'extraction_model',
      extraction_mode = document_result_input ->> 'extraction_mode',
      extracted_item_count = (document_result_input ->> 'extracted_item_count')::integer,
      raw_extraction = document_result_input -> 'raw_extraction',
      error_message = null,
      updated_by = auth.uid()
  where id = document_id_input
    and household_id = household_id_input;

  if not found then
    raise exception 'Não foi possível concluir o documento.';
  end if;

  return jsonb_build_object(
    'imported', imported_transactions,
    'updated_accounts', updated_accounts
  );
end;
$$;

revoke all on function public.apply_financial_document_import(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public;
grant execute on function public.apply_financial_document_import(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to authenticated;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel'
]
where id = 'financial-documents';
