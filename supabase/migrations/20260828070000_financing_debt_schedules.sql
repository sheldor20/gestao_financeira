-- Turn financing PDFs into versioned debts and upcoming installment schedules.
-- This migration creates structure only and inserts no personal financial data.

alter table public.financial_documents
  drop constraint if exists financial_documents_document_type_check;

alter table public.financial_documents
  add constraint financial_documents_document_type_check check (
    document_type in (
      'bank_statement',
      'credit_card_invoice',
      'financing_statement',
      'investment_statement',
      'insurance_statement',
      'pension_statement',
      'other'
    )
  );

alter table public.debts
  add column debt_type text not null default 'other'
    check (debt_type in ('other', 'financing')),
  add column contract_key text,
  add column contract_reference text,
  add column institution text,
  add column outstanding_cents bigint check (outstanding_cents is null or outstanding_cents >= 0),
  add column interest_rate_annual numeric(9, 6)
    check (interest_rate_annual is null or interest_rate_annual >= 0),
  add column last_statement_date date,
  add column last_amortization_cents bigint not null default 0
    check (last_amortization_cents >= 0),
  add column source_document_id uuid,
  add foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id);

create unique index debts_household_contract_unique
  on public.debts (household_id, contract_key)
  where contract_key is not null;

create table public.debt_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  debt_id uuid not null,
  source_document_id uuid not null,
  statement_date date not null,
  outstanding_cents bigint not null check (outstanding_cents >= 0),
  installment_cents bigint not null check (installment_cents >= 0),
  installment_current integer not null check (installment_current > 0),
  installment_total integer not null check (installment_total > 0),
  amortization_cents bigint not null default 0 check (amortization_cents >= 0),
  interest_rate_annual numeric(9, 6)
    check (interest_rate_annual is null or interest_rate_annual >= 0),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (debt_id, household_id)
    references public.debts(id, household_id) on delete cascade,
  foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id) on delete cascade,
  unique (debt_id, source_document_id),
  unique (id, household_id)
);

create table public.debt_installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  debt_id uuid not null,
  source_document_id uuid not null,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  principal_cents bigint check (principal_cents is null or principal_cents >= 0),
  interest_cents bigint check (interest_cents is null or interest_cents >= 0),
  fees_cents bigint check (fees_cents is null or fees_cents >= 0),
  remaining_balance_cents bigint
    check (remaining_balance_cents is null or remaining_balance_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'overdue', 'partially_paid', 'superseded')),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (debt_id, household_id)
    references public.debts(id, household_id) on delete cascade,
  foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id) on delete cascade,
  unique (debt_id, source_document_id, installment_number, due_date),
  unique (id, household_id)
);

create index debt_snapshots_debt_date_idx
  on public.debt_snapshots (debt_id, statement_date desc);
create index debt_installments_debt_due_idx
  on public.debt_installments (debt_id, due_date)
  where status <> 'superseded';

create trigger debt_snapshots_set_updated_at
before update on public.debt_snapshots
for each row execute function public.set_updated_at();

create trigger debt_installments_set_updated_at
before update on public.debt_installments
for each row execute function public.set_updated_at();

alter table public.debt_snapshots enable row level security;
alter table public.debt_installments enable row level security;

create policy "household members can read debt snapshots"
on public.debt_snapshots for select to authenticated
using (public.is_household_member(household_id));
create policy "household members can create debt snapshots"
on public.debt_snapshots for insert to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "household members can update debt snapshots"
on public.debt_snapshots for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));
create policy "household members can delete debt snapshots"
on public.debt_snapshots for delete to authenticated
using (public.is_household_member(household_id));

create policy "household members can read debt installments"
on public.debt_installments for select to authenticated
using (public.is_household_member(household_id));
create policy "household members can create debt installments"
on public.debt_installments for insert to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "household members can update debt installments"
on public.debt_installments for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));
create policy "household members can delete debt installments"
on public.debt_installments for delete to authenticated
using (public.is_household_member(household_id));

grant select, insert, update, delete on public.debt_snapshots to authenticated;
grant select, insert, update, delete on public.debt_installments to authenticated;

drop function if exists public.apply_financial_document_import(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
);

create function public.apply_financial_document_import(
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
  installment_row record;
  financing_debt_id uuid;
  updated_accounts integer := 0;
  imported_transactions integer := 0;
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
      where id = balance_row.account_id and household_id = household_id_input;
      if not found then raise exception 'Conta de destino não encontrada.'; end if;
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

  if financing_input is not null and financing_input <> 'null'::jsonb then
    insert into public.debts (
      household_id, owner_scope, owner_member_id, description, total_cents,
      installment_cents, installment_current, installment_total, due_date,
      status, debt_type, contract_key, contract_reference, institution,
      outstanding_cents, interest_rate_annual, last_statement_date,
      last_amortization_cents, source_document_id
    ) values (
      household_id_input, financing_input ->> 'owner_scope',
      nullif(financing_input ->> 'owner_member_id', '')::uuid,
      financing_input ->> 'description',
      (financing_input ->> 'total_cents')::bigint,
      (financing_input ->> 'installment_cents')::bigint,
      (financing_input ->> 'installment_current')::integer,
      (financing_input ->> 'installment_total')::integer,
      (financing_input ->> 'due_date')::date,
      case when (financing_input ->> 'outstanding_cents')::bigint = 0 then 'paid' else 'pending' end,
      'financing', financing_input ->> 'contract_key',
      nullif(financing_input ->> 'contract_reference', ''),
      nullif(financing_input ->> 'institution', ''),
      (financing_input ->> 'outstanding_cents')::bigint,
      nullif(financing_input ->> 'interest_rate_annual', '')::numeric,
      (financing_input ->> 'statement_date')::date,
      (financing_input ->> 'amortization_cents')::bigint,
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

    insert into public.debt_snapshots (
      household_id, debt_id, source_document_id, statement_date,
      outstanding_cents, installment_cents, installment_current,
      installment_total, amortization_cents, interest_rate_annual
    ) values (
      household_id_input, financing_debt_id, document_id_input,
      (financing_input ->> 'statement_date')::date,
      (financing_input ->> 'outstanding_cents')::bigint,
      (financing_input ->> 'installment_cents')::bigint,
      (financing_input ->> 'installment_current')::integer,
      (financing_input ->> 'installment_total')::integer,
      (financing_input ->> 'amortization_cents')::bigint,
      nullif(financing_input ->> 'interest_rate_annual', '')::numeric
    );

    update public.debt_installments
    set status = 'superseded', updated_by = auth.uid()
    where household_id = household_id_input
      and debt_id = financing_debt_id
      and status in ('pending', 'overdue', 'partially_paid');

    for installment_row in
      select * from jsonb_to_recordset(
        coalesce(financing_input -> 'installments', '[]'::jsonb)
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
  where id = document_id_input and household_id = household_id_input;
  if not found then raise exception 'Não foi possível concluir o documento.'; end if;

  return jsonb_build_object(
    'imported', imported_transactions,
    'updated_accounts', updated_accounts,
    'financing_debt_id', financing_debt_id,
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
