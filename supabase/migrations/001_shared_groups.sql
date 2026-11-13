-- Allsquare shared groups. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a new project.
--
-- The money rules stay in the app; the database stores the same inputs as before
-- (expenses, payments, repeats) and decides WHO may see or change them:
-- you can only see and change groups you're a member of.

-- ---------- Tables ----------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  currency text not null default 'CAD',
  default_split jsonb,
  item_memory jsonb not null default '{}'::jsonb,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- A member is a name in a group. user_id is empty until that person joins (a "placeholder").
create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  user_id uuid references auth.users (id) on delete set null,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- Expenses, payments and repeats keep the app's own JSON shape in `data`.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  data jsonb not null,
  recurring_id uuid,
  occurs_on date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A repeating expense can only be added once per due date, even if two phones open the app at once.
  unique (recurring_id, occurs_on)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  data jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- A scanned receipt waiting for everyone to tap their items.
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  data jsonb not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  expense_id uuid references public.expenses (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One row = "this person had this item". Each phone adds and removes its own taps.
create table public.claims (
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  unit_id text not null,
  member_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (receipt_id, unit_id, member_id)
);

-- Emails sent by the app, so nobody gets more than one of each kind a day.
create table public.notifications (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  kind text not null,
  sent_by uuid default auth.uid(),
  sent_at timestamptz not null default now()
);

create index on public.members (user_id);
create index on public.members (group_id);
create index on public.expenses (group_id);
create index on public.settlements (group_id);
create index on public.recurring (group_id);
create index on public.receipts (group_id);
create index on public.notifications (member_id, kind, sent_at);

-- ---------- Who is in which group ----------

create function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where group_id = gid and user_id = auth.uid());
$$;

create function public.created_group(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where id = gid and created_by = auth.uid());
$$;

create function public.receipt_group(rid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from receipts where id = rid;
$$;

-- Nobody can attach someone else's account to a name, or move a name to another group.
-- Joining goes through join_group(), which sets the flag below.
create function public.guard_member_update() returns trigger
language plpgsql as $$
begin
  if new.group_id <> old.group_id then
    raise exception 'members cannot move between groups';
  end if;
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('allsquare.joining', true), '') <> 'on'
     and not (new.user_id is null and old.user_id = auth.uid()) then
    raise exception 'only join_group can link an account to a name';
  end if;
  return new;
end $$;

create trigger members_guard before update on public.members
for each row execute function public.guard_member_update();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger expenses_touch before update on public.expenses
for each row execute function public.touch_updated_at();

-- ---------- Access rules (Row Level Security) ----------

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;
alter table public.recurring enable row level security;
alter table public.receipts enable row level security;
alter table public.claims enable row level security;
alter table public.notifications enable row level security;

create policy "members see their groups" on public.groups
  for select to authenticated using (is_member(id) or created_by = auth.uid());
create policy "anyone signed in can start a group" on public.groups
  for insert to authenticated with check (created_by = auth.uid());
create policy "members edit their groups" on public.groups
  for update to authenticated using (is_member(id)) with check (is_member(id));
create policy "only the creator deletes a group" on public.groups
  for delete to authenticated using (created_by = auth.uid());

create policy "see people in your groups" on public.members
  for select to authenticated using (is_member(group_id) or created_group(group_id));
create policy "add people to your groups" on public.members
  for insert to authenticated
  with check ((is_member(group_id) or created_group(group_id)) and (user_id is null or user_id = auth.uid()));
create policy "edit people in your groups" on public.members
  for update to authenticated using (is_member(group_id)) with check (is_member(group_id));
create policy "remove placeholder people" on public.members
  for delete to authenticated using (is_member(group_id) and user_id is null);

create policy "group data: read" on public.expenses for select to authenticated using (is_member(group_id));
create policy "group data: add" on public.expenses for insert to authenticated with check (is_member(group_id));
create policy "group data: edit" on public.expenses for update to authenticated using (is_member(group_id)) with check (is_member(group_id));
create policy "group data: delete" on public.expenses for delete to authenticated using (is_member(group_id));

create policy "group data: read" on public.settlements for select to authenticated using (is_member(group_id));
create policy "group data: add" on public.settlements for insert to authenticated with check (is_member(group_id));
create policy "group data: delete" on public.settlements for delete to authenticated using (is_member(group_id));

create policy "group data: read" on public.recurring for select to authenticated using (is_member(group_id));
create policy "group data: add" on public.recurring for insert to authenticated with check (is_member(group_id));
create policy "group data: edit" on public.recurring for update to authenticated using (is_member(group_id)) with check (is_member(group_id));
create policy "group data: delete" on public.recurring for delete to authenticated using (is_member(group_id));

create policy "group data: read" on public.receipts for select to authenticated using (is_member(group_id));
create policy "group data: add" on public.receipts for insert to authenticated with check (is_member(group_id));
create policy "group data: edit" on public.receipts for update to authenticated using (is_member(group_id)) with check (is_member(group_id));
create policy "group data: delete" on public.receipts for delete to authenticated using (is_member(group_id));

-- Claims: any member can tap for anyone in the same group (the scanner can help), never across groups.
create policy "claims: read" on public.claims for select to authenticated using (is_member(receipt_group(receipt_id)));
create policy "claims: add" on public.claims for insert to authenticated
  with check (is_member(receipt_group(receipt_id))
              and exists (select 1 from members m where m.id = member_id and m.group_id = receipt_group(receipt_id)));
create policy "claims: remove" on public.claims for delete to authenticated using (is_member(receipt_group(receipt_id)));

create policy "notifications: read" on public.notifications for select to authenticated using (is_member(group_id));
create policy "notifications: add" on public.notifications for insert to authenticated with check (is_member(group_id));

-- ---------- Joining by invite link ----------

-- Shows the group name and its names before joining. Needs only the code from the link.
create function public.invite_preview(code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'group_id', g.id,
    'name', g.name,
    'already_member', exists (select 1 from members x where x.group_id = g.id and x.user_id = auth.uid()),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'taken', m.user_id is not null) order by m.created_at)
                         from members m where m.group_id = g.id), '[]'::jsonb))
  from groups g where g.invite_code = code and auth.uid() is not null;
$$;

-- Join as an existing name (a placeholder) or as a new person. Returns the group id.
create function public.join_group(code text, member uuid default null, new_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  select id into gid from groups where invite_code = code;
  if gid is null then raise exception 'this invite link is not valid'; end if;
  if exists (select 1 from members where group_id = gid and user_id = me) then return gid; end if;

  perform set_config('allsquare.joining', 'on', true);
  if member is not null then
    update members set user_id = me, email = coalesce(email, nullif(auth.email(), ''))
      where id = member and group_id = gid and user_id is null;
    if not found then raise exception 'that name is already taken'; end if;
  else
    if coalesce(trim(new_name), '') = '' then raise exception 'enter your name'; end if;
    insert into members (group_id, name, user_id, email) values (gid, trim(new_name), me, nullif(auth.email(), ''));
  end if;
  return gid;
end $$;

-- A new link stops the old one from working (if it was shared too widely).
create function public.reset_invite(gid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text := replace(gen_random_uuid()::text, '-', '');
begin
  if not is_member(gid) then raise exception 'not a member'; end if;
  update groups set invite_code = code where id = gid;
  return code;
end $$;

revoke all on function public.join_group(text, uuid, text) from public, anon;
grant execute on function public.join_group(text, uuid, text) to authenticated;
revoke all on function public.invite_preview(text) from public, anon;
grant execute on function public.invite_preview(text) to authenticated;
revoke all on function public.reset_invite(uuid) from public, anon;
grant execute on function public.reset_invite(uuid) to authenticated;

-- ---------- Live updates ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.groups, public.members, public.expenses,
      public.settlements, public.recurring, public.receipts, public.claims;
  end if;
end $$;
