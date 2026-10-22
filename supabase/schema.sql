-- Blink & Glow HQ: database setup
-- Run once in Supabase: SQL Editor -> New query -> paste all of this -> Run.
-- Safe to run again; it skips or replaces what already exists.

-- One table holds every private record. "collection" is the section of the app
-- (contacts, appts, sales, payments, expenses, products, moves, content, ...),
-- "id" is the record's id, and "data" is the record itself.
create table if not exists public.records (
  collection  text        not null,
  id          text        not null,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid(),
  primary key (collection, id)
);
create index if not exists records_slots_idx on public.records ((data->>'date'), (data->>'staff')) where collection = 'slots';

create or replace function public.records_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- Double-booking guard. Whoever writes a booking slot (the team in the app, or a customer through
-- the public booking function below), the database refuses a slot that overlaps another slot for
-- the same stylist on the same day. Writers are serialised per day so two requests at the same
-- moment cannot both succeed.
create or replace function public.slots_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.collection = 'slots' then
    perform pg_advisory_xact_lock(hashtext('bgslots:' || coalesce(new.data->>'date', '')));
    if exists (
      select 1 from public.records r
      where r.collection = 'slots' and r.id <> new.id
        and r.data->>'date' = new.data->>'date'
        and r.data->>'staff' = new.data->>'staff'
        and (r.data->>'s')::int < (new.data->>'e')::int
        and (new.data->>'s')::int < (r.data->>'e')::int
    ) then
      raise exception 'slot_overlap' using errcode = '23P01', hint = 'That stylist is already booked at that time.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists slots_guard on public.records;
create trigger slots_guard before insert or update on public.records
  for each row execute function public.slots_guard();

-- Lock it down: only signed-in team members can read or change records.
alter table public.records enable row level security;
drop policy if exists "team can read"   on public.records;
drop policy if exists "team can add"    on public.records;
drop policy if exists "team can change" on public.records;
drop policy if exists "team can delete" on public.records;
create policy "team can read"   on public.records for select to authenticated using (true);
create policy "team can add"    on public.records for insert to authenticated with check (true);
create policy "team can change" on public.records for update to authenticated using (true) with check (true);
create policy "team can delete" on public.records for delete to authenticated using (true);
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- Live updates for the team.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public booking page. Customers are not signed in, so they never touch the table directly.
-- They can call exactly three functions, and each returns only what a customer may see.
-- ---------------------------------------------------------------------------------------------
create or replace function public.bg_tmin(t text) returns int language sql immutable as $$
  select split_part(t, ':', 1)::int * 60 + coalesce(nullif(split_part(t, ':', 2), '')::int, 0)
$$;

-- 1. Services, opening hours and rules the studio chose to publish (saved by the app as pubcfg/main).
create or replace function public.public_booking_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.records where collection = 'pubcfg' and id = 'main'), '{}'::jsonb)
$$;

-- 2. Which times are taken. Times and stylist only: no names, no phone numbers.
create or replace function public.public_busy(p_from text, p_to text)
returns table(date text, s int, e int, staff text)
language sql stable security definer set search_path = public as $$
  select r.data->>'date', (r.data->>'s')::int, (r.data->>'e')::int, r.data->>'staff'
  from public.records r
  where r.collection = 'slots' and r.data->>'date' between p_from and p_to
$$;

-- 3. Ask for a booking. Every rule is checked here on the server: the service and its length come
-- from the studio's own settings, never from the customer's browser.
create or replace function public.public_request_booking(
  p_service text, p_date text, p_start int, p_name text, p_phone text,
  p_notes text default '', p_source text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; svc jsonb; dur int; buf int; d date; tz text; nowl timestamp; day jsonb; o int; c int;
  b jsonb; st text; picked text; slot_id text; req_id text; digits text; pend int; src text; ts bigint;
begin
  cfg := public.public_booking_config();
  if cfg = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'not_configured'); end if;

  p_name := btrim(coalesce(p_name, ''));
  if char_length(p_name) < 2 or char_length(p_name) > 80 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if char_length(digits) < 9 or char_length(digits) > 15 then return jsonb_build_object('ok', false, 'error', 'invalid_phone'); end if;
  p_notes := left(coalesce(p_notes, ''), 500);

  select s into svc from jsonb_array_elements(coalesce(cfg->'services', '[]'::jsonb)) s where s->>'id' = p_service limit 1;
  if svc is null then return jsonb_build_object('ok', false, 'error', 'unknown_service'); end if;
  dur := (svc->>'dur')::int;
  buf := coalesce((cfg->>'buffer')::int, 0);

  begin d := p_date::date; exception when others then return jsonb_build_object('ok', false, 'error', 'bad_date'); end;
  tz := coalesce(cfg->>'tz', 'Africa/Nairobi');
  nowl := now() at time zone tz;
  if d < nowl::date or d > nowl::date + 60 then return jsonb_build_object('ok', false, 'error', 'bad_date'); end if;

  day := cfg->'hours'->(extract(dow from d)::int)::text;
  if day is null or jsonb_typeof(day) <> 'object' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  o := public.bg_tmin(day->>'o'); c := public.bg_tmin(day->>'c');
  if p_start is null or p_start < o or p_start + dur > c then return jsonb_build_object('ok', false, 'error', 'outside_hours'); end if;

  for b in select * from jsonb_array_elements(coalesce(cfg->'blocks', '[]'::jsonb)) loop
    if d between (b->>'from')::date and coalesce(nullif(b->>'to', '')::date, (b->>'from')::date) then
      return jsonb_build_object('ok', false, 'error', 'blocked');
    end if;
  end loop;
  for b in select * from jsonb_array_elements(coalesce(cfg->'breaks', '[]'::jsonb)) loop
    if p_start < public.bg_tmin(b->>'to') and public.bg_tmin(b->>'from') < p_start + dur then
      return jsonb_build_object('ok', false, 'error', 'break');
    end if;
  end loop;
  if (d::timestamp + make_interval(mins => p_start)) < nowl + make_interval(hours => coalesce((cfg->>'notice')::int, 0)) then
    return jsonb_build_object('ok', false, 'error', 'too_soon');
  end if;

  select count(*) into pend from public.records
   where collection = 'inbox' and data->>'status' = 'New'
     and regexp_replace(coalesce(data->>'phone', ''), '\D', '', 'g') = digits;
  if pend >= 3 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;

  perform pg_advisory_xact_lock(hashtext('bgslots:' || p_date));
  for st in select jsonb_array_elements_text(coalesce(cfg->'staff', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.records r
      where r.collection = 'slots' and r.data->>'date' = p_date and r.data->>'staff' = st
        and (r.data->>'s')::int < p_start + dur + buf and p_start < (r.data->>'e')::int
    ) then picked := st; exit; end if;
  end loop;
  if picked is null then return jsonb_build_object('ok', false, 'error', 'taken'); end if;

  ts := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  slot_id := 'x' || to_hex(ts) || substr(md5(random()::text), 1, 5);
  req_id  := 'x' || to_hex(ts) || substr(md5(random()::text), 1, 5);
  src := case when p_source is not null and cfg->'sources' ? p_source then p_source else '' end;

  insert into public.records(collection, id, data) values ('slots', slot_id,
    jsonb_build_object('id', slot_id, 'date', p_date, 's', p_start, 'e', p_start + dur + buf,
                       'staff', picked, 'st', 'Pending confirmation', 'ts', ts));
  insert into public.records(collection, id, data) values ('inbox', req_id,
    jsonb_build_object('id', req_id, 'name', p_name, 'phone', btrim(p_phone), 'serviceId', p_service,
                       'svcName', svc->>'name', 'price', coalesce((svc->>'price')::int, 0), 'date', p_date,
                       'start', p_start, 'dur', dur, 'staff', picked, 'source', src, 'notes', p_notes,
                       'status', 'New', 'apptId', slot_id, 'ts', ts));
  return jsonb_build_object('ok', true, 'staff', picked, 'dur', dur, 'slotId', slot_id);
end;
$$;

revoke all on function public.public_booking_config() from public;
revoke all on function public.public_busy(text, text) from public;
revoke all on function public.public_request_booking(text, text, int, text, text, text, text) from public;
grant execute on function public.public_booking_config() to anon, authenticated;
grant execute on function public.public_busy(text, text) to anon, authenticated;
grant execute on function public.public_request_booking(text, text, int, text, text, text, text) to anon, authenticated;
