-- Önce Supabase Authentication > Users > Add user ile bir kullanıcı oluşturun.
-- Aşağıdaki e-postayı o kullanıcının e-postasıyla değiştirin; sonra çalıştırın.
do $$
declare
 admin_email text := 'ADMIN_EPOSTANIZI_YAZIN';
 admin_id uuid;
begin
 select id into admin_id from auth.users where lower(email)=lower(admin_email);
 if admin_id is null then raise exception 'Önce Authentication bölümünde bu e-posta ile kullanıcı oluşturun.'; end if;
 insert into public.gh_admins(user_id) values(admin_id) on conflict do nothing;
end $$;
