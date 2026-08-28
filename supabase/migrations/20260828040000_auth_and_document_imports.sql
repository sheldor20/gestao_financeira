-- Secure onboarding and document-first financial imports.
-- This migration contains infrastructure only and inserts no personal data.

alter table public.household_members
  add column person_key text
  check (person_key is null or person_key in ('kim', 'alexandre'));

create unique index household_members_person_key_unique
  on public.household_members (household_id, person_key)
  where person_key is not null and status = 'active';

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  document_type text not null check (
    document_type in (
      'bank_statement',
      'credit_card_invoice',
      'investment_statement',
      'insurance_statement',
      'pension_statement',
      'other'
    )
  ),
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  content_checksum text not null,
  institution text,
  period_start date,
  period_end date,
  status text not null default 'uploaded' check (
    status in ('uploaded', 'processing', 'review', 'applied', 'failed')
  ),
  extraction_model text,
  extraction_mode text check (extraction_mode is null or extraction_mode in ('ai', 'deterministic')),
  extracted_item_count integer not null default 0 check (extracted_item_count >= 0),
  raw_extraction jsonb,
  error_message text,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  unique (household_id, content_checksum),
  unique (id, household_id)
);

alter table public.transactions
  drop constraint if exists transactions_source_check;

alter table public.transactions
  add constraint transactions_source_check check (
    source in (
      'manual',
      'email',
      'invoice',
      'recurrence',
      'bank_statement',
      'card_invoice',
      'document_ai'
    )
  ),
  add column category_label text not null default 'Outros',
  add column merchant_key text,
  add column is_fixed_recurring boolean not null default false,
  add column recurrence_streak integer not null default 0 check (recurrence_streak >= 0),
  add column ai_confidence numeric(5, 4) check (ai_confidence is null or ai_confidence between 0 and 1),
  add column source_document_id uuid,
  add column debt_id uuid,
  add column goal_id uuid,
  add foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id),
  add foreign key (debt_id, household_id)
    references public.debts(id, household_id),
  add foreign key (goal_id, household_id)
    references public.goals(id, household_id);

alter table public.accounts
  add column source_document_id uuid,
  add column balance_date date,
  add foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id);

alter table public.goals
  add column target_account_id uuid,
  add column monthly_target_cents bigint not null default 0 check (monthly_target_cents >= 0),
  add foreign key (target_account_id, household_id)
    references public.accounts(id, household_id);

alter table public.invoices
  add column source_document_id uuid,
  add foreign key (source_document_id, household_id)
    references public.financial_documents(id, household_id);

create index financial_documents_household_created_idx
  on public.financial_documents (household_id, created_at desc);
create index financial_documents_household_status_idx
  on public.financial_documents (household_id, status);
create index transactions_document_idx
  on public.transactions (source_document_id);
create index transactions_merchant_month_idx
  on public.transactions (household_id, merchant_key, transaction_date)
  where kind = 'expense';
create index transactions_debt_idx
  on public.transactions (debt_id)
  where debt_id is not null;
create index transactions_goal_idx
  on public.transactions (goal_id)
  where goal_id is not null;

create trigger household_invites_set_updated_at
before update on public.household_invites
for each row execute function public.set_updated_at();

create trigger financial_documents_set_updated_at
before update on public.financial_documents
for each row execute function public.set_updated_at();

alter table public.household_invites enable row level security;
alter table public.financial_documents enable row level security;

create policy "owners can read household invites"
on public.household_invites for select to authenticated
using (public.can_manage_household(household_id));

create policy "owners can create household invites"
on public.household_invites for insert to authenticated
with check (
  public.can_manage_household(household_id)
  and created_by = auth.uid()
);

create policy "owners can delete household invites"
on public.household_invites for delete to authenticated
using (public.can_manage_household(household_id));

create policy "members can read financial documents"
on public.financial_documents for select to authenticated
using (public.is_household_member(household_id));

create policy "members can create financial documents"
on public.financial_documents for insert to authenticated
with check (
  public.is_household_member(household_id)
  and created_by = auth.uid()
);

create policy "members can update financial documents"
on public.financial_documents for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members can delete financial documents"
on public.financial_documents for delete to authenticated
using (public.is_household_member(household_id));

create or replace function public.enforce_household_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_members integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select count(*)
  into active_members
  from public.household_members
  where household_id = new.household_id
    and status = 'active'
    and id <> new.id;

  if active_members >= 2 then
    raise exception 'Esta família já possui duas pessoas ativas.';
  end if;

  return new;
end;
$$;

create trigger household_members_limit_two
before insert or update of status on public.household_members
for each row execute function public.enforce_household_member_limit();

create or replace function public.bootstrap_finance_household(
  person_key_input text,
  display_name_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;
  if person_key_input not in ('kim', 'alexandre') then
    raise exception 'Pessoa inválida.';
  end if;
  if char_length(trim(display_name_input)) not between 1 and 120 then
    raise exception 'Informe um nome válido.';
  end if;
  if exists (
    select 1 from public.household_members
    where user_id = current_user_id and status = 'active'
  ) then
    raise exception 'Este usuário já participa de uma família.';
  end if;

  insert into public.profiles (user_id, full_name, updated_by)
  values (current_user_id, trim(display_name_input), current_user_id)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        updated_by = current_user_id;

  insert into public.households (name, created_by, updated_by)
  values ('Kim & Alexandre', current_user_id, current_user_id)
  returning id into new_household_id;

  insert into public.household_members (
    household_id,
    user_id,
    display_name,
    person_key,
    role,
    status,
    created_by,
    updated_by
  ) values (
    new_household_id,
    current_user_id,
    trim(display_name_input),
    person_key_input,
    'owner',
    'active',
    current_user_id,
    current_user_id
  );

  return new_household_id;
end;
$$;

create or replace function public.create_household_invite(
  household_id_input uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  invite_code text;
begin
  if not public.can_manage_household(household_id_input) then
    raise exception 'Somente o responsável pode criar convites.';
  end if;
  if (
    select count(*) from public.household_members
    where household_id = household_id_input and status = 'active'
  ) >= 2 then
    raise exception 'A família já possui duas pessoas.';
  end if;

  invite_code := upper(encode(gen_random_bytes(6), 'hex'));

  delete from public.household_invites
  where household_id = household_id_input
    and used_at is null;

  insert into public.household_invites (
    household_id,
    code_hash,
    created_by,
    updated_by
  ) values (
    household_id_input,
    digest(invite_code, 'sha256'),
    current_user_id,
    current_user_id
  );

  return invite_code;
end;
$$;

create or replace function public.join_finance_household(
  invite_code_input text,
  person_key_input text,
  display_name_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  invite_record public.household_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;
  if person_key_input not in ('kim', 'alexandre') then
    raise exception 'Pessoa inválida.';
  end if;
  if char_length(trim(display_name_input)) not between 1 and 120 then
    raise exception 'Informe um nome válido.';
  end if;
  if exists (
    select 1 from public.household_members
    where user_id = current_user_id and status = 'active'
  ) then
    raise exception 'Este usuário já participa de uma família.';
  end if;

  select *
  into invite_record
  from public.household_invites
  where code_hash = digest(upper(trim(invite_code_input)), 'sha256')
    and used_at is null
    and expires_at > now()
  for update;

  if invite_record.id is null then
    raise exception 'Convite inválido ou expirado.';
  end if;
  if exists (
    select 1 from public.household_members
    where household_id = invite_record.household_id
      and person_key = person_key_input
      and status = 'active'
  ) then
    raise exception 'Essa pessoa já está cadastrada na família.';
  end if;

  insert into public.profiles (user_id, full_name, updated_by)
  values (current_user_id, trim(display_name_input), current_user_id)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        updated_by = current_user_id;

  insert into public.household_members (
    household_id,
    user_id,
    display_name,
    person_key,
    role,
    status,
    created_by,
    updated_by
  ) values (
    invite_record.household_id,
    current_user_id,
    trim(display_name_input),
    person_key_input,
    'member',
    'active',
    current_user_id,
    current_user_id
  );

  update public.household_invites
  set used_at = now(),
      used_by = current_user_id,
      updated_by = current_user_id
  where id = invite_record.id;

  return invite_record.household_id;
end;
$$;

create or replace function public.reclassify_fixed_expenses(
  household_id_input uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if not public.is_household_member(household_id_input) then
    raise exception 'Acesso negado.';
  end if;

  with expense_months as (
    select distinct
      owner_scope,
      owner_member_id,
      merchant_key,
      date_trunc('month', transaction_date)::date as month_start
    from public.transactions
    where household_id = household_id_input
      and kind = 'expense'
      and merchant_key is not null
      and merchant_key <> ''
  ),
  numbered as (
    select
      expense_months.*,
      (
        extract(year from month_start)::integer * 12
        + extract(month from month_start)::integer
        - row_number() over (
          partition by owner_scope, owner_member_id, merchant_key
          order by month_start
        )::integer
      ) as segment_key
    from expense_months
  ),
  classified_months as (
    select
      owner_scope,
      owner_member_id,
      merchant_key,
      month_start,
      count(*) over (
        partition by owner_scope, owner_member_id, merchant_key, segment_key
      )::integer as streak
    from numbered
  )
  update public.transactions as transaction
  set is_fixed_recurring = coalesce(classification.streak >= 3, false),
      recurrence_streak = coalesce(classification.streak, 0),
      updated_by = auth.uid()
  from (
    select
      candidate.id,
      classified_months.streak
    from public.transactions as candidate
    left join classified_months
      on classified_months.owner_scope = candidate.owner_scope
      and classified_months.owner_member_id is not distinct from candidate.owner_member_id
      and classified_months.merchant_key = candidate.merchant_key
      and classified_months.month_start = date_trunc('month', candidate.transaction_date)::date
    where candidate.household_id = household_id_input
      and candidate.kind = 'expense'
  ) as classification
  where transaction.id = classification.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.bootstrap_finance_household(text, text) from public;
revoke all on function public.create_household_invite(uuid) from public;
revoke all on function public.join_finance_household(text, text, text) from public;
revoke all on function public.reclassify_fixed_expenses(uuid) from public;
grant execute on function public.bootstrap_finance_household(text, text) to authenticated;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.join_finance_household(text, text, text) to authenticated;
grant execute on function public.reclassify_fixed_expenses(uuid) to authenticated;

grant select, insert, update, delete on public.household_invites to authenticated;
grant select, insert, update, delete on public.financial_documents to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'financial-documents',
  'financial-documents',
  false,
  15728640,
  array['application/pdf', 'text/csv', 'text/plain']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "members can read their financial files"
on storage.objects for select to authenticated
using (
  bucket_id = 'financial-documents'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

create policy "members can upload their financial files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'financial-documents'
  and owner_id = auth.uid()::text
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

create policy "members can delete their financial files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'financial-documents'
  and owner_id = auth.uid()::text
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);
