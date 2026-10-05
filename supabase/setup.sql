-- GAHİRE: Yalnızca yeni, ayrı Gahire projesinde bir kez çalıştırın.
-- Başlangıçta randevu alımı kapalıdır. Saat ve süreleri panelden doğrulayıp açın.
begin;
create table public.gh_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.gh_settings (
 id boolean primary key default true check(id), booking_enabled boolean not null default false,
 notice_minutes int not null default 60 check(notice_minutes between 0 and 1440),
 horizon_days int not null default 60 check(horizon_days between 1 and 90)
);
insert into public.gh_settings default values;
create table public.gh_hours(day int primary key check(day between 0 and 6), opens time not null, closes time not null, closed boolean not null default false, check(opens<closes));
insert into public.gh_hours select d,'10:00'::time,'19:00'::time,d=0 from generate_series(0,6) d;
create table public.gh_services (
 id text primary key, name text not null check(length(name) between 2 and 80),
 duration_minutes int not null check(duration_minutes between 15 and 240 and duration_minutes%15=0),
 price numeric(10,2) check(price>=0), active boolean not null default true, sort_order int not null default 0
);
insert into public.gh_services values
 ('cilt','Cilt Bakımı',60,null,true,1),('kas','Kaş Tasarımı',30,null,true,2),
 ('kirpik','Kirpik Lifting',60,null,true,3),('epilasyon','Epilasyon',60,null,true,4),
 ('manikur','Manikür & Pedikür',60,null,true,5),('sac','Saç Bakımı',60,null,true,6);
create table public.gh_closures(day date primary key, reason text not null default 'Salon kapalı' check(length(reason)<=120));
create table public.gh_appointments (
 id uuid primary key, service_id text not null references public.gh_services(id),
 service_name text not null, duration_minutes int not null, quoted_price numeric(10,2),
 customer_name text not null check(length(customer_name) between 2 and 80),
 phone text not null check(phone ~ '^90[5][0-9]{9}$'),
 starts_at timestamptz not null, ends_at timestamptz not null, note text not null default '' check(length(note)<=500),
 status text not null default 'bekliyor' check(status in ('bekliyor','onaylandi','iptal','tamamlandi','gelmedi')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_at>starts_at),
 constraint gh_no_overlap exclude using gist (tstzrange(starts_at,ends_at,'[)') with &&) where (status in ('bekliyor','onaylandi'))
);
create index gh_appointments_date on public.gh_appointments(starts_at desc);
create index gh_appointments_phone on public.gh_appointments(phone,created_at desc);
create index gh_appointments_pending on public.gh_appointments(created_at) where status='bekliyor';
alter table public.gh_admins enable row level security;
alter table public.gh_settings enable row level security;
alter table public.gh_hours enable row level security;
alter table public.gh_services enable row level security;
alter table public.gh_closures enable row level security;
alter table public.gh_appointments enable row level security;
revoke all on public.gh_admins,public.gh_settings,public.gh_hours,public.gh_services,public.gh_closures,public.gh_appointments from anon,authenticated;
grant select on public.gh_admins to authenticated;
create policy gh_admin_self on public.gh_admins for select to authenticated using(user_id=(select auth.uid()));
grant select on public.gh_services,public.gh_settings,public.gh_hours,public.gh_closures to anon,authenticated;
create policy gh_services_read on public.gh_services for select to anon,authenticated using(true);
create policy gh_settings_read on public.gh_settings for select to anon,authenticated using(true);
create policy gh_hours_read on public.gh_hours for select to anon,authenticated using(true);
create policy gh_closures_read on public.gh_closures for select to anon,authenticated using(true);
grant update on public.gh_services,public.gh_settings,public.gh_hours to authenticated;
grant insert,delete on public.gh_closures to authenticated;
create policy gh_services_admin on public.gh_services for update to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid()))) with check(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_settings_admin on public.gh_settings for update to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid()))) with check(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_hours_admin on public.gh_hours for update to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid()))) with check(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_closures_add on public.gh_closures for insert to authenticated with check(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_closures_remove on public.gh_closures for delete to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
grant select on public.gh_appointments to authenticated;
grant update(status) on public.gh_appointments to authenticated;
create policy gh_appointments_admin_read on public.gh_appointments for select to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
create policy gh_appointments_admin_update on public.gh_appointments for update to authenticated using(exists(select 1 from public.gh_admins where user_id=(select auth.uid()))) with check(exists(select 1 from public.gh_admins where user_id=(select auth.uid())));
grant all on public.gh_admins,public.gh_settings,public.gh_hours,public.gh_services,public.gh_closures,public.gh_appointments to service_role;

-- Tüm fonksiyonlar INVOKER. Gizli anahtar sadece Edge Function içinde kullanılır.
create function public.gh_slots(p_service text,p_day date)
returns table(starts_at timestamptz,ends_at timestamptz,available boolean)
language plpgsql stable security invoker set search_path='' as $$
declare s public.gh_services; cfg public.gh_settings; h public.gh_hours;
begin
 select * into cfg from public.gh_settings where id;
 select * into s from public.gh_services where id=p_service and active;
 if s.id is null or p_day is null then raise exception 'GH_INPUT'; end if;
 if not cfg.booking_enabled or p_day<(now() at time zone 'Europe/Istanbul')::date or p_day>(now() at time zone 'Europe/Istanbul')::date+cfg.horizon_days then return; end if;
 select * into h from public.gh_hours where day=extract(dow from p_day);
 if h.closed or h.day is null or exists(select 1 from public.gh_closures where day=p_day) then return; end if;
 return query select t,t+make_interval(mins=>s.duration_minutes),not exists(
  select 1 from public.gh_appointments a where a.status in ('bekliyor','onaylandi') and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(t,t+make_interval(mins=>s.duration_minutes),'[)')
 ) from generate_series((p_day+h.opens) at time zone 'Europe/Istanbul',((p_day+h.closes) at time zone 'Europe/Istanbul')-make_interval(mins=>s.duration_minutes),interval '15 minutes') t
 where t>=now()+make_interval(mins=>cfg.notice_minutes);
end $$;
revoke all on function public.gh_slots(text,date) from public,anon,authenticated;
grant execute on function public.gh_slots(text,date) to service_role;

create function public.gh_book(p_id uuid,p_service text,p_start timestamptz,p_name text,p_phone text,p_note text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.gh_services; a public.gh_appointments; cfg public.gh_settings;
begin
 perform pg_advisory_xact_lock(71643291);
 if p_id is null or p_start is null or p_service is null or p_name is null or p_phone is null or p_note is null or length(trim(p_name)) not between 2 and 80 or p_phone !~ '^905[0-9]{9}$' or length(p_note)>500 then raise exception 'GH_INPUT'; end if;
 select * into a from public.gh_appointments where id=p_id;
 if found then
  if a.service_id<>p_service or a.starts_at<>p_start or a.phone<>p_phone or a.customer_name<>trim(p_name) or a.note<>trim(p_note) then raise exception 'GH_RETRY'; end if;
  return jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at,'service_name',a.service_name);
 end if;
 select * into cfg from public.gh_settings where id for share;
 if not cfg.booking_enabled then raise exception 'GH_CLOSED'; end if;
 perform 1 from public.gh_hours where day=extract(dow from p_start at time zone 'Europe/Istanbul') for share;
 select * into s from public.gh_services where id=p_service and active for share;
 if s.id is null then raise exception 'GH_INPUT'; end if;
 if not exists(select 1 from public.gh_slots(p_service,(p_start at time zone 'Europe/Istanbul')::date) sl where sl.starts_at=p_start and sl.available) then raise exception 'GH_SLOT'; end if;
 if (select count(*) from public.gh_appointments where phone=p_phone and created_at>now()-interval '1 hour')>=3 or
 (select count(*) from public.gh_appointments where phone=p_phone and starts_at>now() and status in ('bekliyor','onaylandi'))>=3 then raise exception 'GH_LIMIT'; end if;
 insert into public.gh_appointments(id,service_id,service_name,duration_minutes,quoted_price,customer_name,phone,starts_at,ends_at,note)
 values(p_id,s.id,s.name,s.duration_minutes,s.price,trim(p_name),p_phone,p_start,p_start+make_interval(mins=>s.duration_minutes),trim(p_note)) returning * into a;
 return jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at,'service_name',a.service_name);
exception when exclusion_violation then raise exception 'GH_SLOT';
end $$;
revoke all on function public.gh_book(uuid,text,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.gh_book(uuid,text,timestamptz,text,text,text) to service_role;

create function public.gh_status_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status=old.status then return new; end if;
 if not ((old.status='bekliyor' and new.status in ('onaylandi','iptal')) or (old.status='onaylandi' and new.status in ('iptal','tamamlandi','gelmedi'))) then raise exception 'GH_STATE'; end if;
 if new.status='onaylandi' and old.starts_at<=now() then raise exception 'GH_PAST'; end if;
 if new.status in ('tamamlandi','gelmedi') and old.ends_at>now() then raise exception 'GH_FUTURE'; end if;
 new.updated_at=now(); return new;
end $$;
revoke all on function public.gh_status_guard() from public,anon,authenticated;
create trigger gh_status_guard before update on public.gh_appointments for each row execute function public.gh_status_guard();
create function public.gh_closure_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(71643291);
 if exists(select 1 from public.gh_appointments where (starts_at at time zone 'Europe/Istanbul')::date=new.day and status in ('bekliyor','onaylandi')) then raise exception 'GH_HAS_BOOKINGS'; end if;
 return new;
end $$;
revoke all on function public.gh_closure_guard() from public,anon,authenticated;
create trigger gh_closure_guard before insert on public.gh_closures for each row execute function public.gh_closure_guard();
commit;
