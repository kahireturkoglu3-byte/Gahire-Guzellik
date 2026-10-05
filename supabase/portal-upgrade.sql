-- Önce setup.sql, ardından bu dosya. Yalnızca Gahire projesinde bir kez çalıştırılır.
begin;
create table public.gh_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
 full_name text not null check(length(full_name) between 2 and 80),
 phone text not null check(phone ~ '^905[0-9]{9}$'),
 active boolean not null default true, must_change_password boolean not null default true,
 current_session_id uuid, created_at timestamptz not null default now()
);
create table public.gh_packages (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.gh_members(user_id),
 service_id text not null references public.gh_services(id), label text not null check(length(label) between 2 and 100),
 total_sessions int not null check(total_sessions between 1 and 100), next_due date, active boolean not null default true,
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
alter table public.gh_appointments add column customer_id uuid references public.gh_members(user_id);
alter table public.gh_appointments add column package_id uuid references public.gh_packages(id);
create index gh_appointments_customer on public.gh_appointments(customer_id,starts_at desc);
create index gh_packages_customer on public.gh_packages(customer_id);
create table public.gh_sessions (
 id uuid primary key, customer_id uuid not null references public.gh_members(user_id),
 service_id text not null references public.gh_services(id), service_name text not null,
 package_id uuid references public.gh_packages(id), appointment_id uuid unique references public.gh_appointments(id),
 performed_at timestamptz not null, note text not null default '' check(length(note)<=500),
 voided boolean not null default false, void_reason text,
 created_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
create index gh_sessions_customer on public.gh_sessions(customer_id,performed_at desc);
create index gh_sessions_package on public.gh_sessions(package_id) where not voided;
alter table public.gh_members enable row level security;
alter table public.gh_packages enable row level security;
alter table public.gh_sessions enable row level security;
revoke all on public.gh_members,public.gh_packages,public.gh_sessions from anon,authenticated;
grant select on public.gh_members,public.gh_packages,public.gh_sessions to authenticated;
grant all on public.gh_members,public.gh_packages,public.gh_sessions to service_role;
create policy gh_members_admin on public.gh_members for select to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_members_self on public.gh_members for select to authenticated using(user_id=(select auth.uid()) and active and current_session_id::text=(select auth.jwt()->>'session_id'));
create function public.gh_member_ready() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.gh_members where user_id=(select auth.uid()) and active and not must_change_password and current_session_id::text=(select auth.jwt()->>'session_id'));
$$;
revoke all on function public.gh_member_ready() from public,anon;
grant execute on function public.gh_member_ready() to authenticated;
create policy gh_packages_read on public.gh_packages for select to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid())) or (customer_id=(select auth.uid()) and (select public.gh_member_ready())));
create policy gh_sessions_read on public.gh_sessions for select to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid())) or (customer_id=(select auth.uid()) and (select public.gh_member_ready())));
create policy gh_appointments_member on public.gh_appointments for select to authenticated using(customer_id=(select auth.uid()) and (select public.gh_member_ready()));
create view public.gh_package_progress with(security_invoker=true) as
 select p.*,count(s.id)::int as completed_sessions,(p.total_sessions-count(s.id))::int as remaining_sessions
 from public.gh_packages p left join public.gh_sessions s on s.package_id=p.id and not s.voided group by p.id;
revoke all on public.gh_package_progress from anon,authenticated;
grant select on public.gh_package_progress to authenticated,service_role;

create function public.gh_book_member(p_user uuid,p_session uuid,p_id uuid,p_service text,p_start timestamptz,p_package uuid default null,p_note text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.gh_members; p public.gh_packages; a public.gh_appointments; result jsonb; used int; reserved int;
begin
 perform pg_advisory_xact_lock(71643291);
 select * into m from public.gh_members where user_id=p_user for share;
 if m.user_id is null or not m.active or m.must_change_password or m.current_session_id is distinct from p_session or p_session is null then raise exception 'GH_MEMBER'; end if;
 select * into a from public.gh_appointments where id=p_id;
 if found then
  if a.customer_id is distinct from p_user or a.package_id is distinct from p_package or a.service_id is distinct from p_service or a.starts_at is distinct from p_start or a.note is distinct from trim(p_note) then raise exception 'GH_RETRY'; end if;
  return jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at,'service_name',a.service_name);
 end if;
 if p_package is not null then
  select * into p from public.gh_packages where id=p_package for update;
  if p.id is null or p.customer_id<>p_user or p.service_id<>p_service or not p.active then raise exception 'GH_PACKAGE'; end if;
  select count(*) into used from public.gh_sessions where package_id=p.id and not voided;
  select count(*) into reserved from public.gh_appointments where package_id=p.id and status in ('bekliyor','onaylandi');
  if used+reserved>=p.total_sessions then raise exception 'GH_NO_SESSIONS'; end if;
 end if;
 result=public.gh_book(p_id,p_service,p_start,m.full_name,m.phone,p_note);
 update public.gh_appointments set customer_id=p_user,package_id=p_package,quoted_price=case when p_package is null then quoted_price else null end where id=p_id;
 return result;
end $$;
revoke all on function public.gh_book_member(uuid,uuid,uuid,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.gh_book_member(uuid,uuid,uuid,text,timestamptz,uuid,text) to service_role;

create function public.gh_record_session(p_admin uuid,p_id uuid,p_customer uuid,p_service text,p_package uuid,p_appointment uuid,p_when timestamptz,p_note text,p_due date)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pack public.gh_packages; app public.gh_appointments; oldlog public.gh_sessions; service public.gh_services;
begin
 perform pg_advisory_xact_lock(71643291);
 if not exists(select 1 from public.gh_admins where user_id=p_admin) then raise exception 'GH_AUTH'; end if;
 if p_id is null or p_customer is null or p_service is null or p_note is null or length(p_note)>500 or p_when is null or p_when>now() or p_when<now()-interval '10 years' then raise exception 'GH_INPUT'; end if;
 if p_due is not null and p_due<(p_when at time zone 'Europe/Istanbul')::date then raise exception 'GH_INPUT'; end if;
 select * into oldlog from public.gh_sessions where id=p_id;
 if found then
  if oldlog.customer_id is distinct from p_customer or oldlog.service_id is distinct from p_service or oldlog.package_id is distinct from p_package or oldlog.appointment_id is distinct from p_appointment or oldlog.note is distinct from p_note then raise exception 'GH_RETRY'; end if;
  return oldlog.id;
 end if;
 if not exists(select 1 from public.gh_members where user_id=p_customer) then raise exception 'GH_MEMBER'; end if;
 select * into service from public.gh_services where id=p_service;
 if service.id is null then raise exception 'GH_INPUT'; end if;
 if p_appointment is not null then
  select * into app from public.gh_appointments where id=p_appointment for update;
  if app.id is null or app.customer_id is distinct from p_customer or app.service_id<>p_service or app.package_id is distinct from p_package or app.status<>'onaylandi' or app.ends_at>now() then raise exception 'GH_APPOINTMENT'; end if;
 end if;
 if p_package is not null then
  select * into pack from public.gh_packages where id=p_package for update;
  if pack.id is null or pack.customer_id<>p_customer or pack.service_id<>p_service or not pack.active then raise exception 'GH_PACKAGE'; end if;
  if (select count(*) from public.gh_sessions where package_id=pack.id and not voided)>=pack.total_sessions then raise exception 'GH_NO_SESSIONS'; end if;
  -- Randevusuz manuel kayıt, önceden ayrılmış son seansı tüketemez.
  if p_appointment is null and ((select count(*) from public.gh_sessions where package_id=pack.id and not voided)+(select count(*) from public.gh_appointments where package_id=pack.id and status in ('bekliyor','onaylandi')))>=pack.total_sessions then raise exception 'GH_RESERVED'; end if;
 end if;
 insert into public.gh_sessions(id,customer_id,service_id,service_name,package_id,appointment_id,performed_at,note,created_by)
 values(p_id,p_customer,p_service,service.name,p_package,p_appointment,case when p_appointment is null then p_when else app.ends_at end,trim(p_note),p_admin);
 if p_package is not null then update public.gh_packages set next_due=p_due where id=p_package; end if;
 if p_appointment is not null then update public.gh_appointments set status='tamamlandi' where id=p_appointment; end if;
 return p_id;
end $$;
revoke all on function public.gh_record_session(uuid,uuid,uuid,text,uuid,uuid,timestamptz,text,date) from public,anon,authenticated;
grant execute on function public.gh_record_session(uuid,uuid,uuid,text,uuid,uuid,timestamptz,text,date) to service_role;
create function public.gh_completion_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status='tamamlandi' and old.status<>'tamamlandi' and new.customer_id is not null and not exists(select 1 from public.gh_sessions where appointment_id=new.id and not voided) then raise exception 'GH_USE_SESSION'; end if;
 return new;
end $$;
revoke all on function public.gh_completion_guard() from public,anon,authenticated;
create trigger gh_completion_guard before update on public.gh_appointments for each row execute function public.gh_completion_guard();
-- Hatalı seans kaydı silinmez; sebebiyle işaretlenir ve paket sayacından düşer.
create function public.gh_void_session(p_admin uuid,p_id uuid,p_reason text) returns uuid language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(71643291);
 if not exists(select 1 from public.gh_admins where user_id=p_admin) then raise exception 'GH_AUTH'; end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 300 then raise exception 'GH_INPUT'; end if;
 update public.gh_sessions set voided=true,void_reason=trim(p_reason) where id=p_id;
 if not found then raise exception 'GH_INPUT'; end if;
 return p_id;
end $$;
revoke all on function public.gh_void_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gh_void_session(uuid,uuid,text) to service_role;

commit;
