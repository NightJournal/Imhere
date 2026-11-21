-- Additive migration: run in the Supabase SQL editor as the project owner.
-- Does not change existing circle/group policies or make check_ins public.
begin;
create table if not exists public.trip_view_links (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  trip_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
alter table public.trip_view_links enable row level security;
revoke all on public.trip_view_links from public, anon, authenticated;
grant select, delete on public.trip_view_links to authenticated;
drop policy if exists "owners manage view links" on public.trip_view_links;
create policy "owners manage view links" on public.trip_view_links
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create or replace function public.create_trip_view_link(valid_days integer default 7)
returns public.trip_view_links language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); trip uuid; result public.trip_view_links;
begin
  if owner is null then raise exception 'Sign in to create a view link'; end if;
  if valid_days is null or valid_days < 1 or valid_days > 30 then raise exception 'Choose 1 to 30 days'; end if;
  -- Lock per owner so concurrent requests cannot bypass the active-link cap.
  select current_trip_id into trip from public.profiles where id = owner for update;
  if trip is null then raise exception 'Start a trip before creating a view link'; end if;
  if (select count(*) from public.trip_view_links where owner_id = owner and expires_at > now()) >= 20 then
    raise exception 'Cancel an existing view link before creating another';
  end if;
  insert into public.trip_view_links(owner_id, trip_id, expires_at)
    values (owner, trip, now() + valid_days * interval '1 day') returning * into result;
  return result;
end $$;
revoke all on function public.create_trip_view_link(integer) from public, anon;
grant execute on function public.create_trip_view_link(integer) to authenticated;

create or replace function public.get_shared_trip(view_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'display_name', p.display_name,
    'expires_at', l.expires_at,
    'check_ins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'place_name', c.place_name, 'country_code', c.country_code,
        'latitude', round(c.latitude::numeric, 2), 'longitude', round(c.longitude::numeric, 2),
        'created_at', c.created_at
      ) order by c.created_at desc)
      from public.check_ins c where c.user_id = l.owner_id and c.trip_id = l.trip_id
    ), '[]'::jsonb)
  )
  from public.trip_view_links l join public.profiles p on p.id = l.owner_id
  where l.token = view_token and l.expires_at > now();
$$;
revoke all on function public.get_shared_trip(uuid) from public;
grant execute on function public.get_shared_trip(uuid) to anon, authenticated;
comment on function public.get_shared_trip(uuid) is 'Bearer-link read-only projection. No photos, messages, plans, live positions, account IDs, email or other trips.';
notify pgrst, 'reload schema';
commit;
