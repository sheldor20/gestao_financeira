-- Let household members explicitly classify an imported movement as recurring.
-- The rule is stored separately from the source transaction so it survives a
-- document deletion and is also applied to later movements from the same merchant.

alter table public.recurrences
  add column if not exists merchant_key text;

comment on column public.recurrences.merchant_key is
  'Normalized merchant used to apply a user recurrence preference to matching transactions.';

create unique index if not exists recurrences_household_merchant_rule_idx
  on public.recurrences (
    household_id,
    owner_scope,
    coalesce(owner_member_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    merchant_key
  )
  where merchant_key is not null and merchant_key <> '';

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
  ),
  recurrence_rules as (
    select
      owner_scope,
      owner_member_id,
      kind,
      merchant_key,
      is_active
    from public.recurrences
    where household_id = household_id_input
      and merchant_key is not null
      and merchant_key <> ''
  ),
  classification as (
    select
      candidate.id,
      classified_months.streak,
      recurrence_rules.is_active as recurrence_override
    from public.transactions as candidate
    left join classified_months
      on candidate.kind = 'expense'
      and classified_months.owner_scope = candidate.owner_scope
      and classified_months.owner_member_id is not distinct from candidate.owner_member_id
      and classified_months.merchant_key = candidate.merchant_key
      and classified_months.month_start = date_trunc('month', candidate.transaction_date)::date
    left join recurrence_rules
      on recurrence_rules.owner_scope = candidate.owner_scope
      and recurrence_rules.owner_member_id is not distinct from candidate.owner_member_id
      and recurrence_rules.kind = candidate.kind
      and recurrence_rules.merchant_key = candidate.merchant_key
    where candidate.household_id = household_id_input
      and candidate.kind in ('income', 'expense')
  )
  update public.transactions as transaction
  set is_fixed_recurring = coalesce(
        classification.recurrence_override,
        classification.streak >= 3,
        false
      ),
      recurrence_streak = case
        when classification.recurrence_override is true
          then greatest(coalesce(classification.streak, 0), 1)
        else coalesce(classification.streak, 0)
      end,
      updated_by = auth.uid()
  from classification
  where transaction.id = classification.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.set_transaction_recurrence(
  transaction_id_input uuid,
  is_recurring_input boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_transaction public.transactions%rowtype;
  target_merchant_key text;
  recurrence_id uuid;
  affected_count integer;
begin
  if is_recurring_input is null then
    raise exception 'Informe se a movimentação é recorrente.';
  end if;

  select *
  into target_transaction
  from public.transactions
  where id = transaction_id_input
    and public.is_household_member(household_id);

  if not found then
    raise exception 'Movimentação não encontrada ou sem acesso.';
  end if;

  if target_transaction.kind not in ('income', 'expense') then
    raise exception 'Somente entradas e saídas podem ser recorrentes.';
  end if;

  target_merchant_key := coalesce(
    nullif(trim(target_transaction.merchant_key), ''),
    nullif(
      left(
        lower(regexp_replace(trim(target_transaction.description), '\s+', ' ', 'g')),
        80
      ),
      ''
    )
  );

  if target_merchant_key is null then
    raise exception 'Não foi possível identificar a movimentação.';
  end if;

  if target_transaction.merchant_key is null
     or trim(target_transaction.merchant_key) = '' then
    update public.transactions
    set merchant_key = target_merchant_key,
        updated_by = auth.uid()
    where id = target_transaction.id;
  end if;

  select id
  into recurrence_id
  from public.recurrences
  where household_id = target_transaction.household_id
    and owner_scope = target_transaction.owner_scope
    and owner_member_id is not distinct from target_transaction.owner_member_id
    and kind = target_transaction.kind
    and merchant_key = target_merchant_key
  limit 1;

  if recurrence_id is null then
    insert into public.recurrences (
      household_id,
      owner_scope,
      owner_member_id,
      description,
      category_id,
      amount_cents,
      kind,
      frequency,
      next_date,
      is_active,
      merchant_key
    ) values (
      target_transaction.household_id,
      target_transaction.owner_scope,
      target_transaction.owner_member_id,
      target_transaction.description,
      target_transaction.category_id,
      target_transaction.amount_cents,
      target_transaction.kind,
      'monthly',
      (target_transaction.transaction_date + interval '1 month')::date,
      is_recurring_input,
      target_merchant_key
    );
  else
    update public.recurrences
    set description = target_transaction.description,
        category_id = target_transaction.category_id,
        amount_cents = target_transaction.amount_cents,
        frequency = 'monthly',
        next_date = (target_transaction.transaction_date + interval '1 month')::date,
        is_active = is_recurring_input,
        updated_by = auth.uid()
    where id = recurrence_id;
  end if;

  perform public.reclassify_fixed_expenses(target_transaction.household_id);

  select count(*)::integer
  into affected_count
  from public.transactions
  where household_id = target_transaction.household_id
    and owner_scope = target_transaction.owner_scope
    and owner_member_id is not distinct from target_transaction.owner_member_id
    and kind = target_transaction.kind
    and merchant_key = target_merchant_key;

  return affected_count;
end;
$$;

revoke all on function public.set_transaction_recurrence(uuid, boolean) from public;
grant execute on function public.set_transaction_recurrence(uuid, boolean) to authenticated;
