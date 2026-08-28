-- Keep real assets separate from accounts, credit limits and financing debts.

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 240),
  asset_type text not null check (asset_type in ('real_estate', 'vehicle', 'other')),
  total_value_cents bigint not null check (total_value_cents >= 0),
  valuation_date date,
  value_source text not null default 'document' check (
    value_source in ('property_value', 'purchase_price', 'financed_amount', 'document')
  ),
  institution text,
  debt_id uuid,
  source_document_id uuid references public.financial_documents(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  foreign key (debt_id, household_id)
    references public.debts(id, household_id) on delete cascade,
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  unique (id, household_id)
);

create unique index assets_household_debt_unique
  on public.assets (household_id, debt_id)
  where debt_id is not null;
create index assets_household_active_idx
  on public.assets (household_id, is_active, asset_type);

create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

alter table public.assets enable row level security;

create policy "household members can read assets"
on public.assets for select to authenticated
using (public.is_household_member(household_id));
create policy "household members can create assets"
on public.assets for insert to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "household members can update assets"
on public.assets for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));
create policy "household members can delete assets"
on public.assets for delete to authenticated
using (public.is_household_member(household_id));

grant select, insert, update, delete on public.assets to authenticated;

create or replace function public.hide_non_asset_accounts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_name text := translate(
    lower(new.name),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );
begin
  if (
    (normalized_name like '%limite%' and normalized_name similar to '%(credito|cartao)%')
    or normalized_name similar to '%(saldo devedor|saldo financiado|compras parceladas|fatura do cartao|credito disponivel)%'
  ) then
    new.include_in_net_worth := false;
    new.is_active := false;
  end if;
  return new;
end;
$$;

create trigger accounts_hide_non_assets
before insert or update of name, include_in_net_worth, is_active on public.accounts
for each row execute function public.hide_non_asset_accounts();

update public.accounts
set include_in_net_worth = false,
    is_active = false,
    updated_by = auth.uid()
where (
  (translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like '%limite%'
    and translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') similar to '%(credito|cartao)%')
  or translate(lower(name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
    similar to '%(saldo devedor|saldo financiado|compras parceladas|fatura do cartao|credito disponivel)%'
);

create or replace function public.sync_financed_asset_from_document()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  financing_data jsonb;
  debt_record record;
  asset_value bigint;
  asset_name text;
  asset_value_source text;
begin
  if new.document_type <> 'financing_statement'
    or new.status <> 'applied'
    or new.raw_extraction is null then
    return new;
  end if;

  financing_data := new.raw_extraction -> 'financing';
  if financing_data is null or financing_data = 'null'::jsonb then
    return new;
  end if;

  select id, owner_scope, owner_member_id, total_cents, institution,
         last_statement_date, created_by
  into debt_record
  from public.debts
  where household_id = new.household_id
    and source_document_id = new.id
    and debt_type = 'financing'
  limit 1;

  if debt_record.id is null then return new; end if;

  asset_value := coalesce(
    nullif(financing_data ->> 'assetValueCents', '')::bigint,
    nullif(financing_data ->> 'originalAmountCents', '')::bigint,
    debt_record.total_cents
  );
  if asset_value <= 0 then return new; end if;

  asset_name := coalesce(
    nullif(trim(financing_data ->> 'assetDescription'), ''),
    'Apartamento financiado'
  );
  asset_value_source := coalesce(
    nullif(financing_data ->> 'assetValueSource', ''),
    'financed_amount'
  );
  if asset_value_source not in (
    'property_value', 'purchase_price', 'financed_amount', 'document'
  ) then
    asset_value_source := 'document';
  end if;

  insert into public.assets (
    household_id, owner_scope, owner_member_id, name, asset_type,
    total_value_cents, valuation_date, value_source, institution,
    debt_id, source_document_id
  ) values (
    new.household_id, debt_record.owner_scope, debt_record.owner_member_id,
    asset_name, 'real_estate', asset_value,
    coalesce(debt_record.last_statement_date, new.period_end, new.period_start),
    asset_value_source, debt_record.institution, debt_record.id, new.id
  )
  on conflict (household_id, debt_id) where debt_id is not null
  do update set
    owner_scope = excluded.owner_scope,
    owner_member_id = excluded.owner_member_id,
    name = excluded.name,
    total_value_cents = excluded.total_value_cents,
    valuation_date = excluded.valuation_date,
    value_source = excluded.value_source,
    institution = excluded.institution,
    source_document_id = excluded.source_document_id,
    is_active = true,
    updated_by = auth.uid();

  return new;
end;
$$;

create trigger financial_documents_sync_financed_asset
after update of status, raw_extraction on public.financial_documents
for each row execute function public.sync_financed_asset_from_document();

-- Backfill the financing PDF that may already have been imported. When the PDF
-- only contains the original financed amount, keep that origin explicit in UI.
insert into public.assets (
  household_id, owner_scope, owner_member_id, name, asset_type,
  total_value_cents, valuation_date, value_source, institution,
  debt_id, source_document_id, created_by, updated_by
)
select
  debt.household_id, debt.owner_scope, debt.owner_member_id,
  coalesce(
    nullif(trim(document.raw_extraction -> 'financing' ->> 'assetDescription'), ''),
    'Apartamento financiado'
  ),
  'real_estate',
  coalesce(
    nullif(document.raw_extraction -> 'financing' ->> 'assetValueCents', '')::bigint,
    nullif(document.raw_extraction -> 'financing' ->> 'originalAmountCents', '')::bigint,
    debt.total_cents
  ),
  debt.last_statement_date,
  coalesce(
    nullif(document.raw_extraction -> 'financing' ->> 'assetValueSource', ''),
    'financed_amount'
  ),
  debt.institution, debt.id, debt.source_document_id,
  debt.created_by, debt.updated_by
from public.debts as debt
left join public.financial_documents as document
  on document.id = debt.source_document_id
where debt.debt_type = 'financing'
  and debt.total_cents > 0
on conflict (household_id, debt_id) where debt_id is not null
do update set
  total_value_cents = excluded.total_value_cents,
  valuation_date = excluded.valuation_date,
  institution = excluded.institution,
  source_document_id = excluded.source_document_id,
  is_active = true,
  updated_by = excluded.updated_by;
