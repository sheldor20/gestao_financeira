-- Apply every financing found in a document, regardless of the type selected
-- in the import form. Assets are only created from explicit asset data.

drop trigger if exists financial_documents_sync_financed_asset
on public.financial_documents;

create or replace function public.apply_financial_document_import(
  household_id_input uuid,
  document_id_input uuid,
  transaction_rows_input jsonb,
  balance_rows_input jsonb,
  invoice_input jsonb,
  financing_input jsonb,
  document_result_input jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  balance_row record;
  financing_item jsonb;
  financing_items jsonb;
  installment_row record;
  financing_debt_id uuid;
  financing_debt_ids uuid[] := array[]::uuid[];
  updated_accounts integer := 0;
  imported_transactions integer := 0;
  updated_financings integer := 0;
  updated_installments integer := 0;
begin
  if not public.is_household_member(household_id_input) then
    raise exception 'Acesso negado.';
  end if;

  if not exists (
    select 1 from public.financial_documents
    where id = document_id_input
      and household_id = household_id_input
      and status = 'processing'
  ) then
    raise exception 'Documento não está disponível para aplicação.';
  end if;

  insert into public.transactions (
    household_id, owner_scope, owner_member_id, kind, description,
    category_label, amount_cents, transaction_date, status, source,
    account_id, credit_card_id, installment_current, installment_total,
    merchant_key, ai_confidence, source_document_id, debt_id, goal_id,
    external_fingerprint
  )
  select
    household_id_input, item.owner_scope, item.owner_member_id, item.kind,
    item.description, item.category_label, item.amount_cents,
    item.transaction_date, item.status, item.source, item.account_id,
    item.credit_card_id, item.installment_current, item.installment_total,
    item.merchant_key, item.ai_confidence, document_id_input, item.debt_id,
    item.goal_id, item.external_fingerprint
  from jsonb_to_recordset(coalesce(transaction_rows_input, '[]'::jsonb)) as item (
    owner_scope text, owner_member_id uuid, kind text, description text,
    category_label text, amount_cents bigint, transaction_date date,
    status text, source text, account_id uuid, credit_card_id uuid,
    installment_current integer, installment_total integer, merchant_key text,
    ai_confidence numeric, debt_id uuid, goal_id uuid, external_fingerprint text
  );

  get diagnostics imported_transactions = row_count;

  for balance_row in
    select * from jsonb_to_recordset(coalesce(balance_rows_input, '[]'::jsonb)) as balance (
      account_id uuid, owner_scope text, owner_member_id uuid, name text,
      institution text, account_type text, balance_cents bigint,
      balance_date date, include_in_net_worth boolean
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
        household_id, owner_scope, owner_member_id, name, institution,
        account_type, balance_cents, balance_date, include_in_net_worth,
        source_document_id
      ) values (
        household_id_input, balance_row.owner_scope, balance_row.owner_member_id,
        balance_row.name, balance_row.institution, balance_row.account_type,
        balance_row.balance_cents, balance_row.balance_date,
        balance_row.include_in_net_worth, document_id_input
      );
    end if;
    updated_accounts := updated_accounts + 1;
  end loop;

  if invoice_input is not null and invoice_input <> 'null'::jsonb then
    insert into public.invoices (
      household_id, credit_card_id, owner_scope, owner_member_id, filename,
      period, total_cents, item_count, status, content_checksum, source_document_id
    ) values (
      household_id_input, nullif(invoice_input ->> 'credit_card_id', '')::uuid,
      invoice_input ->> 'owner_scope',
      nullif(invoice_input ->> 'owner_member_id', '')::uuid,
      invoice_input ->> 'filename', (invoice_input ->> 'period')::date,
      (invoice_input ->> 'total_cents')::bigint,
      (invoice_input ->> 'item_count')::integer, invoice_input ->> 'status',
      invoice_input ->> 'content_checksum', document_id_input
    );
  end if;

  financing_items := case
    when financing_input is null or financing_input = 'null'::jsonb
      then '[]'::jsonb
    when jsonb_typeof(financing_input) = 'array'
      then financing_input
    else jsonb_build_array(financing_input)
  end;

  for financing_item in
    select value from jsonb_array_elements(financing_items)
  loop
    insert into public.debts (
      household_id, owner_scope, owner_member_id, description, total_cents,
      installment_cents, installment_current, installment_total, due_date,
      status, debt_type, contract_key, contract_reference, institution,
      outstanding_cents, interest_rate_annual, last_statement_date,
      last_amortization_cents, source_document_id
    ) values (
      household_id_input, financing_item ->> 'owner_scope',
      nullif(financing_item ->> 'owner_member_id', '')::uuid,
      financing_item ->> 'description',
      (financing_item ->> 'total_cents')::bigint,
      (financing_item ->> 'installment_cents')::bigint,
      (financing_item ->> 'installment_current')::integer,
      (financing_item ->> 'installment_total')::integer,
      (financing_item ->> 'due_date')::date,
      case
        when (financing_item ->> 'outstanding_cents')::bigint = 0 then 'paid'
        when (financing_item ->> 'due_date')::date < current_date then 'overdue'
        else 'pending'
      end,
      'financing', financing_item ->> 'contract_key',
      nullif(financing_item ->> 'contract_reference', ''),
      nullif(financing_item ->> 'institution', ''),
      (financing_item ->> 'outstanding_cents')::bigint,
      nullif(financing_item ->> 'interest_rate_annual', '')::numeric,
      (financing_item ->> 'statement_date')::date,
      (financing_item ->> 'amortization_cents')::bigint,
      document_id_input
    )
    on conflict (household_id, contract_key) where contract_key is not null
    do update set
      owner_scope = excluded.owner_scope,
      owner_member_id = excluded.owner_member_id,
      description = excluded.description,
      total_cents = greatest(public.debts.total_cents, excluded.total_cents),
      installment_cents = excluded.installment_cents,
      installment_current = excluded.installment_current,
      installment_total = excluded.installment_total,
      due_date = excluded.due_date,
      status = excluded.status,
      contract_reference = excluded.contract_reference,
      institution = excluded.institution,
      outstanding_cents = excluded.outstanding_cents,
      interest_rate_annual = excluded.interest_rate_annual,
      last_statement_date = excluded.last_statement_date,
      last_amortization_cents = excluded.last_amortization_cents,
      source_document_id = document_id_input,
      updated_by = auth.uid()
    returning id into financing_debt_id;

    financing_debt_ids := array_append(financing_debt_ids, financing_debt_id);
    updated_financings := updated_financings + 1;

    insert into public.debt_snapshots (
      household_id, debt_id, source_document_id, statement_date,
      outstanding_cents, installment_cents, installment_current,
      installment_total, amortization_cents, interest_rate_annual
    ) values (
      household_id_input, financing_debt_id, document_id_input,
      (financing_item ->> 'statement_date')::date,
      (financing_item ->> 'outstanding_cents')::bigint,
      (financing_item ->> 'installment_cents')::bigint,
      (financing_item ->> 'installment_current')::integer,
      (financing_item ->> 'installment_total')::integer,
      (financing_item ->> 'amortization_cents')::bigint,
      nullif(financing_item ->> 'interest_rate_annual', '')::numeric
    );

    update public.debt_installments
    set status = 'superseded', updated_by = auth.uid()
    where household_id = household_id_input
      and debt_id = financing_debt_id
      and status in ('pending', 'overdue', 'partially_paid');

    for installment_row in
      select * from jsonb_to_recordset(
        coalesce(financing_item -> 'installments', '[]'::jsonb)
      ) as installment (
        installment_number integer, due_date date, amount_cents bigint,
        principal_cents bigint, interest_cents bigint, fees_cents bigint,
        remaining_balance_cents bigint, status text
      )
    loop
      insert into public.debt_installments (
        household_id, debt_id, source_document_id, installment_number,
        due_date, amount_cents, principal_cents, interest_cents, fees_cents,
        remaining_balance_cents, status
      ) values (
        household_id_input, financing_debt_id, document_id_input,
        installment_row.installment_number, installment_row.due_date,
        installment_row.amount_cents, installment_row.principal_cents,
        installment_row.interest_cents, installment_row.fees_cents,
        installment_row.remaining_balance_cents, installment_row.status
      );
      updated_installments := updated_installments + 1;
    end loop;

    if financing_item -> 'asset' is not null
      and financing_item -> 'asset' <> 'null'::jsonb then
      insert into public.assets (
        household_id, owner_scope, owner_member_id, name, asset_type,
        total_value_cents, valuation_date, value_source, institution,
        debt_id, source_document_id
      ) values (
        household_id_input, financing_item ->> 'owner_scope',
        nullif(financing_item ->> 'owner_member_id', '')::uuid,
        financing_item -> 'asset' ->> 'name',
        financing_item -> 'asset' ->> 'asset_type',
        (financing_item -> 'asset' ->> 'total_value_cents')::bigint,
        (financing_item -> 'asset' ->> 'valuation_date')::date,
        financing_item -> 'asset' ->> 'value_source',
        nullif(financing_item ->> 'institution', ''),
        financing_debt_id, document_id_input
      )
      on conflict (household_id, debt_id) where debt_id is not null
      do update set
        owner_scope = excluded.owner_scope,
        owner_member_id = excluded.owner_member_id,
        name = excluded.name,
        asset_type = excluded.asset_type,
        total_value_cents = excluded.total_value_cents,
        valuation_date = excluded.valuation_date,
        value_source = excluded.value_source,
        institution = excluded.institution,
        source_document_id = excluded.source_document_id,
        is_active = true,
        updated_by = auth.uid();
    end if;
  end loop;

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
    'updated_accounts', updated_accounts,
    'financing_debt_id', financing_debt_id,
    'financing_debt_ids', to_jsonb(financing_debt_ids),
    'updated_financings', updated_financings,
    'updated_installments', updated_installments
  );
end;
$$;

revoke all on function public.apply_financial_document_import(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) from public;
grant execute on function public.apply_financial_document_import(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
