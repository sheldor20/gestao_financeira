-- Initial schema for Dois.
-- This migration creates structure, security policies and indexes only.
-- It intentionally inserts no household, user or financial data.

create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 1 and 120),
  avatar_url text,
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  default_split_method text not null default 'proportional'
    check (default_split_method in ('proportional', 'equal', 'custom')),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('invited', 'active', 'inactive')),
  monthly_income_cents bigint not null default 0 check (monthly_income_cents >= 0),
  color text,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (id, household_id)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  institution text,
  account_type text not null check (
    account_type in ('checking', 'savings', 'investment', 'pension', 'insurance', 'cash', 'other')
  ),
  balance_cents bigint not null default 0,
  include_in_net_worth boolean not null default true,
  is_active boolean not null default true,
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
  unique (id, household_id)
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  institution text,
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  limit_cents bigint not null default 0 check (limit_cents >= 0),
  is_active boolean not null default true,
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
  unique (id, household_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  kind text not null default 'both' check (kind in ('income', 'expense', 'both')),
  color text,
  icon text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, name),
  unique (id, household_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  description text not null check (char_length(trim(description)) between 1 and 240),
  category_id uuid,
  amount_cents bigint not null check (amount_cents >= 0),
  transaction_date date not null,
  status text not null default 'pending' check (status in ('paid', 'pending', 'scheduled')),
  source text not null default 'manual' check (source in ('manual', 'email', 'invoice', 'recurrence')),
  account_id uuid,
  credit_card_id uuid,
  installment_current integer check (installment_current is null or installment_current > 0),
  installment_total integer check (installment_total is null or installment_total > 0),
  note text,
  external_fingerprint text,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  foreign key (category_id, household_id)
    references public.categories(id, household_id),
  foreign key (account_id, household_id)
    references public.accounts(id, household_id),
  foreign key (credit_card_id, household_id)
    references public.credit_cards(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  check (
    (installment_current is null and installment_total is null)
    or (
      installment_current is not null
      and installment_total is not null
      and installment_current <= installment_total
    )
  ),
  unique (id, household_id),
  unique (household_id, external_fingerprint)
);

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null,
  member_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 0),
  percentage numeric(7, 4) check (percentage is null or percentage between 0 and 100),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (transaction_id, household_id)
    references public.transactions(id, household_id) on delete cascade,
  foreign key (member_id, household_id)
    references public.household_members(id, household_id),
  unique (transaction_id, member_id)
);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 240),
  category_id uuid,
  total_cents bigint not null check (total_cents >= 0),
  installment_cents bigint not null check (installment_cents >= 0),
  installment_current integer not null check (installment_current > 0),
  installment_total integer not null check (installment_total > 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  foreign key (category_id, household_id)
    references public.categories(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  check (installment_current <= installment_total),
  unique (id, household_id)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  limit_cents bigint not null check (limit_cents >= 0),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  foreign key (category_id, household_id)
    references public.categories(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  unique (household_id, owner_scope, owner_member_id, category_id, month)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 160),
  target_cents bigint not null check (target_cents >= 0),
  current_cents bigint not null default 0 check (current_cents >= 0),
  target_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
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
  unique (id, household_id)
);

create table public.recurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  description text not null check (char_length(trim(description)) between 1 and 240),
  category_id uuid,
  amount_cents bigint not null check (amount_cents >= 0),
  kind text not null check (kind in ('income', 'expense')),
  frequency text not null check (frequency in ('monthly', 'annual')),
  next_date date not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  foreign key (category_id, household_id)
    references public.categories(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  unique (id, household_id)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  credit_card_id uuid,
  owner_scope text not null check (owner_scope in ('individual', 'joint')),
  owner_member_id uuid,
  filename text not null,
  period date not null check (extract(day from period) = 1),
  total_cents bigint not null default 0 check (total_cents >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  status text not null default 'review' check (status in ('review', 'reviewed')),
  storage_path text,
  content_checksum text,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (credit_card_id, household_id)
    references public.credit_cards(id, household_id),
  foreign key (owner_member_id, household_id)
    references public.household_members(id, household_id),
  check (
    (owner_scope = 'joint' and owner_member_id is null)
    or (owner_scope = 'individual' and owner_member_id is not null)
  ),
  unique (id, household_id),
  unique (household_id, content_checksum)
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invoice_id uuid not null,
  transaction_id uuid,
  purchase_date date not null,
  description text not null check (char_length(trim(description)) between 1 and 240),
  amount_cents bigint not null check (amount_cents >= 0),
  category_id uuid,
  installment_current integer check (installment_current is null or installment_current > 0),
  installment_total integer check (installment_total is null or installment_total > 0),
  raw_payload jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, household_id)
    references public.invoices(id, household_id) on delete cascade,
  foreign key (transaction_id, household_id)
    references public.transactions(id, household_id),
  foreign key (category_id, household_id)
    references public.categories(id, household_id),
  check (
    (installment_current is null and installment_total is null)
    or (
      installment_current is not null
      and installment_total is not null
      and installment_current <= installment_total
    )
  )
);

create index household_members_user_idx on public.household_members (user_id, status);
create index transactions_household_date_idx on public.transactions (household_id, transaction_date desc);
create index transactions_household_owner_idx on public.transactions (household_id, owner_scope, owner_member_id);
create index transactions_household_status_idx on public.transactions (household_id, status);
create index debts_household_due_idx on public.debts (household_id, due_date, status);
create index budgets_household_month_idx on public.budgets (household_id, month);
create index recurrences_household_next_idx on public.recurrences (household_id, next_date) where is_active;
create index invoices_household_period_idx on public.invoices (household_id, period desc);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, purchase_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'households', 'household_members', 'accounts', 'credit_cards', 'categories',
    'transactions', 'transaction_splits', 'debts', 'budgets', 'goals',
    'recurrences', 'invoices', 'invoice_items'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.can_manage_household(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = auth.uid()
      and role = 'owner'
      and status = 'active'
  );
$$;

create or replace function public.is_household_creator(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.households
    where id = target_household_id
      and created_by = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.can_manage_household(uuid) from public;
revoke all on function public.is_household_creator(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.can_manage_household(uuid) to authenticated;
grant execute on function public.is_household_creator(uuid) to authenticated;

alter table public.profiles enable row level security;

create policy "profiles can be read by their user"
on public.profiles for select to authenticated
using (user_id = auth.uid());

create policy "profiles can be created by their user"
on public.profiles for insert to authenticated
with check (user_id = auth.uid());

create policy "profiles can be updated by their user"
on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter table public.households enable row level security;

create policy "households can be read by members"
on public.households for select to authenticated
using (public.is_household_member(id));

create policy "households can be created by authenticated users"
on public.households for insert to authenticated
with check (created_by = auth.uid());

create policy "households can be updated by owners"
on public.households for update to authenticated
using (public.can_manage_household(id))
with check (public.can_manage_household(id));

create policy "households can be deleted by owners"
on public.households for delete to authenticated
using (public.can_manage_household(id));

alter table public.household_members enable row level security;

create policy "household members can be read by members"
on public.household_members for select to authenticated
using (public.is_household_member(household_id));

create policy "household members can be created by owners"
on public.household_members for insert to authenticated
with check (
  public.can_manage_household(household_id)
  or (
    user_id = auth.uid()
    and role = 'owner'
    and public.is_household_creator(household_id)
  )
);

create policy "household members can be updated by owners"
on public.household_members for update to authenticated
using (public.can_manage_household(household_id))
with check (public.can_manage_household(household_id));

create policy "household members can be deleted by owners"
on public.household_members for delete to authenticated
using (public.can_manage_household(household_id));

create or replace function public.enable_household_rls(target_table regclass)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute format('alter table %s enable row level security', target_table);
  execute format(
    'create policy "household members can read" on %s for select to authenticated '
    'using (public.is_household_member(household_id))',
    target_table
  );
  execute format(
    'create policy "household members can create" on %s for insert to authenticated '
    'with check (public.is_household_member(household_id) and created_by = auth.uid())',
    target_table
  );
  execute format(
    'create policy "household members can update" on %s for update to authenticated '
    'using (public.is_household_member(household_id)) '
    'with check (public.is_household_member(household_id))',
    target_table
  );
  execute format(
    'create policy "household members can delete" on %s for delete to authenticated '
    'using (public.is_household_member(household_id))',
    target_table
  );
end;
$$;

select public.enable_household_rls('public.accounts');
select public.enable_household_rls('public.credit_cards');
select public.enable_household_rls('public.categories');
select public.enable_household_rls('public.transactions');
select public.enable_household_rls('public.transaction_splits');
select public.enable_household_rls('public.debts');
select public.enable_household_rls('public.budgets');
select public.enable_household_rls('public.goals');
select public.enable_household_rls('public.recurrences');
select public.enable_household_rls('public.invoices');
select public.enable_household_rls('public.invoice_items');

drop function public.enable_household_rls(regclass);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
