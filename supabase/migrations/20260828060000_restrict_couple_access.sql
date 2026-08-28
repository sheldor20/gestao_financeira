-- Restrict the private portal to the two designated accounts and fix pgcrypto lookup.

create or replace function public.finance_person_for_current_user()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_email text;
begin
  select lower(trim(email))
  into current_email
  from auth.users
  where id = auth.uid();

  if current_email = 'eliakim.minichiello@gmail.com' then
    return 'kim';
  end if;
  if current_email = 'pantoja.smp@gmail.com' then
    return 'alexandre';
  end if;

  raise exception 'Conta não autorizada para este portal.';
end;
$$;

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
    assigned_name,
    assigned_person,
    'owner',
    'active',
    current_user_id,
    current_user_id
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
    target_household_id,
    current_user_id,
    'Alexandre',
    'alexandre',
    'member',
    'active',
    current_user_id,
    current_user_id
  );

  return target_household_id;
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

  invite_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));

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
    extensions.digest(invite_code, 'sha256'),
    current_user_id,
    current_user_id
  );

  return invite_code;
end;
$$;

update public.household_members as member
set person_key = 'kim',
    display_name = 'Kim',
    updated_by = member.user_id
from auth.users as finance_user
where finance_user.id = member.user_id
  and lower(finance_user.email) = 'eliakim.minichiello@gmail.com';

update public.household_members as member
set person_key = 'alexandre',
    display_name = 'Alexandre',
    updated_by = member.user_id
from auth.users as finance_user
where finance_user.id = member.user_id
  and lower(finance_user.email) = 'pantoja.smp@gmail.com';

insert into public.profiles (user_id, full_name, updated_by)
select finance_user.id, 'Alexandre', finance_user.id
from auth.users as finance_user
where lower(finance_user.email) = 'pantoja.smp@gmail.com'
on conflict (user_id) do update
set full_name = excluded.full_name,
    updated_by = excluded.user_id;

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
  alexandre_user.id,
  'Alexandre',
  'alexandre',
  'member',
  'active',
  kim_member.user_id,
  alexandre_user.id
from public.household_members as kim_member
join auth.users as kim_user on kim_user.id = kim_member.user_id
cross join auth.users as alexandre_user
where kim_member.status = 'active'
  and kim_member.person_key = 'kim'
  and lower(kim_user.email) = 'eliakim.minichiello@gmail.com'
  and lower(alexandre_user.email) = 'pantoja.smp@gmail.com'
on conflict (household_id, user_id) do update
set display_name = excluded.display_name,
    person_key = excluded.person_key,
    status = 'active',
    updated_by = excluded.updated_by;

revoke all on function public.finance_person_for_current_user() from public;
revoke all on function public.join_designated_finance_household(text) from public;
grant execute on function public.finance_person_for_current_user() to authenticated;
grant execute on function public.join_designated_finance_household(text) to authenticated;
