-- Allow the designated partner to own financial data before their first login.

alter table public.household_members
  drop constraint if exists household_members_user_id_fkey;

alter table public.household_members
  alter column user_id drop not null;

alter table public.household_members
  add constraint household_members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

insert into public.household_members (
  household_id,
  user_id,
  display_name,
  person_key,
  role,
  status,
  created_by,
  updated_by
)
select
  kim_member.household_id,
  null,
  'Alexandre',
  'alexandre',
  'member',
  'invited',
  kim_member.user_id,
  kim_member.user_id
from public.household_members as kim_member
where kim_member.status = 'active'
  and kim_member.person_key = 'kim'
  and not exists (
    select 1
    from public.household_members as existing_alexandre
    where existing_alexandre.household_id = kim_member.household_id
      and existing_alexandre.person_key = 'alexandre'
  );

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
  assigned_person text := public.finance_person_for_current_user();
  assigned_name text;
  existing_household_id uuid;
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;

  assigned_name := case assigned_person when 'kim' then 'Kim' else 'Alexandre' end;
  if person_key_input <> assigned_person then
    raise exception 'A identidade deste acesso é %.', assigned_name;
  end if;
  if assigned_person <> 'kim' then
    raise exception 'Somente Kim pode criar o espaço do casal.';
  end if;

  select household_id
  into existing_household_id
  from public.household_members
  where user_id = current_user_id
    and status = 'active'
  limit 1;

  if existing_household_id is not null then
    insert into public.household_members (
      household_id, user_id, display_name, person_key, role, status,
      created_by, updated_by
    )
    select
      existing_household_id, null, 'Alexandre', 'alexandre', 'member',
      'invited', current_user_id, current_user_id
    where not exists (
      select 1
      from public.household_members
      where household_id = existing_household_id
        and person_key = 'alexandre'
    );
    return existing_household_id;
  end if;

  insert into public.profiles (user_id, full_name, updated_by)
  values (current_user_id, assigned_name, current_user_id)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        updated_by = current_user_id;

  insert into public.households (name, created_by, updated_by)
  values ('Kim & Alexandre', current_user_id, current_user_id)
  returning id into new_household_id;

  insert into public.household_members (
    household_id, user_id, display_name, person_key, role, status,
    created_by, updated_by
  ) values (
    new_household_id, current_user_id, assigned_name, assigned_person,
    'owner', 'active', current_user_id, current_user_id
  );

  insert into public.household_members (
    household_id, user_id, display_name, person_key, role, status,
    created_by, updated_by
  ) values (
    new_household_id, null, 'Alexandre', 'alexandre', 'member', 'invited',
    current_user_id, current_user_id
  );

  return new_household_id;
end;
$$;

create or replace function public.join_designated_finance_household(
  display_name_input text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  assigned_person text := public.finance_person_for_current_user();
  existing_household_id uuid;
  target_household_id uuid;
  claimed_member_id uuid;
begin
  if current_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;
  if assigned_person <> 'alexandre' then
    raise exception 'Somente Alexandre pode usar esta entrada.';
  end if;

  select household_id
  into existing_household_id
  from public.household_members
  where user_id = current_user_id
    and status = 'active'
  limit 1;

  if existing_household_id is not null then
    return existing_household_id;
  end if;

  select member.household_id
  into target_household_id
  from public.household_members as member
  join auth.users as finance_user on finance_user.id = member.user_id
  where member.status = 'active'
    and member.person_key = 'kim'
    and lower(finance_user.email) = 'eliakim.minichiello@gmail.com'
  order by member.created_at
  limit 1;

  if target_household_id is null then
    raise exception 'Kim ainda não configurou o espaço do casal.';
  end if;

  insert into public.profiles (user_id, full_name, updated_by)
  values (current_user_id, 'Alexandre', current_user_id)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        updated_by = current_user_id;

  update public.household_members
  set user_id = current_user_id,
      display_name = 'Alexandre',
      role = 'member',
      status = 'active',
      updated_by = current_user_id
  where household_id = target_household_id
    and person_key = 'alexandre'
    and user_id is null
  returning id into claimed_member_id;

  if claimed_member_id is null then
    insert into public.household_members (
      household_id, user_id, display_name, person_key, role, status,
      created_by, updated_by
    ) values (
      target_household_id, current_user_id, 'Alexandre', 'alexandre',
      'member', 'active', current_user_id, current_user_id
    )
    on conflict (household_id, user_id) do update
    set display_name = excluded.display_name,
        person_key = excluded.person_key,
        role = excluded.role,
        status = excluded.status,
        updated_by = excluded.updated_by;
  end if;

  return target_household_id;
end;
$$;

revoke all on function public.bootstrap_finance_household(text, text) from public;
revoke all on function public.join_designated_finance_household(text) from public;
grant execute on function public.bootstrap_finance_household(text, text) to authenticated;
grant execute on function public.join_designated_finance_household(text) to authenticated;
