-- Phase 5: encrypted Google credentials and idempotent manual test sends.
alter table public.connected_accounts drop constraint connected_accounts_owner_unique;
create unique index connected_accounts_one_active_per_owner_idx
  on public.connected_accounts(owner_id) where status = 'connected';

alter table private.api_rate_limits drop constraint api_rate_limits_action_check;
alter table private.api_rate_limits add constraint api_rate_limits_action_check
  check (action in ('import', 'draft', 'attachment', 'gmail_test'));
create or replace function public.consume_app_rate_limit(p_action text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_owner_id uuid := auth.uid();
  v_limit integer;
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from statement_timestamp()) / 60) * 60);
  v_count integer;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_limit := case p_action when 'import' then 30 when 'draft' then 10 when 'attachment' then 10 when 'gmail_test' then 3 else null end;
  if v_limit is null then raise exception 'invalid rate limit action' using errcode = '22023'; end if;
  insert into private.api_rate_limits(owner_id, action, window_start, request_count)
  values (v_owner_id, p_action, v_window_start, 1)
  on conflict (owner_id, action) do update set
    window_start = excluded.window_start,
    request_count = case when private.api_rate_limits.window_start < excluded.window_start then 1
      else private.api_rate_limits.request_count + 1 end
  returning request_count into v_count;
  return v_count <= v_limit;
end;
$$;
revoke all on function public.consume_app_rate_limit(text) from public, anon;
grant execute on function public.consume_app_rate_limit(text) to authenticated;

create table private.connected_account_tokens (
  owner_id uuid not null,
  connected_account_id uuid not null,
  ciphertext bytea not null check (octet_length(ciphertext) > 0),
  nonce bytea not null check (octet_length(nonce) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, connected_account_id),
  foreign key (owner_id, connected_account_id)
    references public.connected_accounts(owner_id, id) on delete cascade
);
alter table private.connected_account_tokens enable row level security;
revoke all on table private.connected_account_tokens from public, anon, authenticated;
revoke all on table private.connected_account_tokens from service_role;

create table private.gmail_test_sends (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  status text not null check (status in ('sending', 'sent', 'failed', 'uncertain')),
  provider_message_id text,
  error_code text check (error_code is null or error_code in ('reauthorization_required', 'refresh_unavailable', 'provider_forbidden', 'rate_limited', 'provider_unavailable', 'send_failed', 'outcome_uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, request_id),
  check (provider_message_id is null or length(provider_message_id) <= 200)
);
alter table private.gmail_test_sends enable row level security;
revoke all on table private.gmail_test_sends from public, anon, authenticated;
revoke all on table private.gmail_test_sends from service_role;

create table private.google_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.google_oauth_states enable row level security;
revoke all on table private.google_oauth_states from public, anon, authenticated;
revoke all on table private.google_oauth_states from service_role;

create or replace function public.upsert_google_connection(
  p_owner_id uuid, p_account_id uuid, p_provider_subject text, p_email text,
  p_ciphertext bytea, p_nonce bytea, p_auth_tag bytea, p_key_version smallint
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_account public.connected_accounts%rowtype; v_has_new_token boolean := p_ciphertext is not null;
begin
  if p_owner_id is null or p_account_id is null or btrim(coalesce(p_provider_subject, '')) = '' or btrim(coalesce(p_email, '')) = '' then
    raise exception 'invalid connection metadata' using errcode = '22023';
  end if;
  if v_has_new_token and (p_nonce is null or octet_length(p_nonce) <> 12 or p_auth_tag is null or octet_length(p_auth_tag) <> 16 or p_key_version <> 1) then
    raise exception 'invalid encrypted token material' using errcode = '22023';
  end if;
  if exists (select 1 from public.connected_accounts a where a.owner_id = p_owner_id and a.status = 'connected' and a.provider_subject <> p_provider_subject) then
    raise exception 'active account must be disconnected first' using errcode = 'P0001';
  end if;
  select * into v_account from public.connected_accounts a where a.provider = 'google' and a.provider_subject = p_provider_subject for update;
  if found then
    if v_account.owner_id <> p_owner_id then raise exception 'Google identity is already connected' using errcode = '23505'; end if;
    if v_account.id <> p_account_id then raise exception 'connection changed; retry authorization' using errcode = '40001'; end if;
    update public.connected_accounts set email = p_email, status = 'connected', disconnected_at = null,
      connected_at = case when v_account.status = 'connected' then v_account.connected_at else now() end,
      updated_at = now() where id = p_account_id and owner_id = p_owner_id;
  else
    insert into public.connected_accounts(id, owner_id, provider, provider_subject, email, status, connected_at, disconnected_at)
      values (p_account_id, p_owner_id, 'google', p_provider_subject, p_email, 'connected', now(), null);
  end if;
  if v_has_new_token then
    insert into private.connected_account_tokens(owner_id, connected_account_id, ciphertext, nonce, auth_tag, key_version)
      values (p_owner_id, p_account_id, p_ciphertext, p_nonce, p_auth_tag, p_key_version)
      on conflict(owner_id, connected_account_id) do update set ciphertext = excluded.ciphertext,
        nonce = excluded.nonce, auth_tag = excluded.auth_tag, key_version = excluded.key_version, updated_at = now();
  elsif not exists (select 1 from private.connected_account_tokens t where t.owner_id = p_owner_id and t.connected_account_id = p_account_id) then
    raise exception 'a refresh token is required' using errcode = '22023';
  end if;
  return p_account_id;
end; $$;

create or replace function public.read_google_refresh_token(p_owner_id uuid, p_account_id uuid)
returns table(ciphertext bytea, nonce bytea, auth_tag bytea, key_version smallint)
language sql security definer set search_path = pg_catalog, public, private
as $$ select t.ciphertext, t.nonce, t.auth_tag, t.key_version from private.connected_account_tokens t
  join public.connected_accounts a on a.owner_id=t.owner_id and a.id=t.connected_account_id
  where t.owner_id=p_owner_id and t.connected_account_id=p_account_id and a.status='connected' $$;

create or replace function public.replace_google_refresh_token(
  p_owner_id uuid, p_account_id uuid, p_ciphertext bytea, p_nonce bytea, p_auth_tag bytea, p_key_version smallint
) returns boolean language plpgsql security definer set search_path = pg_catalog, public, private
as $$
begin
  if p_ciphertext is null or octet_length(p_ciphertext)=0 or p_nonce is null or octet_length(p_nonce)<>12
    or p_auth_tag is null or octet_length(p_auth_tag)<>16 or p_key_version<>1 then
    raise exception 'invalid encrypted token material' using errcode='22023'; end if;
  update private.connected_account_tokens set ciphertext=p_ciphertext,nonce=p_nonce,auth_tag=p_auth_tag,key_version=p_key_version,updated_at=now()
    where owner_id=p_owner_id and connected_account_id=p_account_id
      and exists(select 1 from public.connected_accounts a where a.owner_id=p_owner_id and a.id=p_account_id and a.status='connected');
  return found;
end; $$;

create or replace function public.register_google_oauth_state(p_owner_id uuid, p_state_hash text, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = pg_catalog, private
as $$
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() or p_expires_at > now() + interval '11 minutes' then
    raise exception 'invalid OAuth state registration' using errcode='22023'; end if;
  delete from private.google_oauth_states where expires_at < now() - interval '1 day';
  insert into private.google_oauth_states(state_hash,owner_id,expires_at) values(p_state_hash,p_owner_id,p_expires_at);
  return true;
end; $$;

create or replace function public.consume_google_oauth_state(p_owner_id uuid, p_state_hash text)
returns boolean language plpgsql security definer set search_path = pg_catalog, private
as $$
begin
  update private.google_oauth_states set used_at=now()
    where owner_id=p_owner_id and state_hash=p_state_hash and used_at is null and expires_at > now();
  return found;
end; $$;

create or replace function public.delete_google_refresh_token(p_owner_id uuid, p_account_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v_count integer;
begin
  delete from private.connected_account_tokens where owner_id=p_owner_id and connected_account_id=p_account_id;
  get diagnostics v_count = row_count;
  update public.connected_accounts set status='disconnected', disconnected_at=now(), updated_at=now()
    where owner_id=p_owner_id and id=p_account_id;
  return v_count > 0;
end; $$;

create or replace function public.set_google_connection_status(p_owner_id uuid, p_account_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('revoked','error') then raise exception 'invalid connection status' using errcode='22023'; end if;
  if p_status='revoked' then
    delete from private.connected_account_tokens where owner_id=p_owner_id and connected_account_id=p_account_id;
  end if;
  update public.connected_accounts set status=p_status, disconnected_at=now(), updated_at=now()
    where owner_id=p_owner_id and id=p_account_id;
  return found;
end; $$;

create or replace function public.claim_gmail_test_send(p_owner_id uuid, p_request_id uuid)
returns table(status text, provider_message_id text, error_code text, claimed boolean)
language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_send private.gmail_test_sends%rowtype;
begin
  insert into private.gmail_test_sends(owner_id,request_id,status) values(p_owner_id,p_request_id,'sending')
    on conflict(owner_id,request_id) do nothing;
  if found then return query select 'sending'::text, null::text, null::text, true; return; end if;
  select * into v_send from private.gmail_test_sends s where s.owner_id=p_owner_id and s.request_id=p_request_id for update;
  if v_send.status='sending' and v_send.updated_at < now() - interval '2 minutes' then
    update private.gmail_test_sends set status='uncertain',error_code='outcome_uncertain',updated_at=now()
      where owner_id=p_owner_id and request_id=p_request_id returning * into v_send;
  end if;
  return query select v_send.status,v_send.provider_message_id,v_send.error_code,false;
end; $$;

create or replace function public.finish_gmail_test_send(
  p_owner_id uuid, p_request_id uuid, p_status text, p_provider_message_id text, p_error_code text
) returns text language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_status text;
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'invalid send result' using errcode='22023'; end if;
  if p_error_code is not null and p_error_code not in ('reauthorization_required','refresh_unavailable','provider_forbidden','rate_limited','provider_unavailable','send_failed','outcome_uncertain') then
    raise exception 'invalid send error category' using errcode='22023'; end if;
  update private.gmail_test_sends set status=p_status,provider_message_id=p_provider_message_id,error_code=p_error_code,updated_at=now()
    where owner_id=p_owner_id and request_id=p_request_id and status='sending' returning status into v_status;
  if v_status is null then select s.status into v_status from private.gmail_test_sends s where owner_id=p_owner_id and request_id=p_request_id; end if;
  return v_status;
end; $$;

revoke all on function public.upsert_google_connection(uuid,uuid,text,text,bytea,bytea,bytea,smallint) from public,anon,authenticated;
revoke all on function public.read_google_refresh_token(uuid,uuid) from public,anon,authenticated;
revoke all on function public.replace_google_refresh_token(uuid,uuid,bytea,bytea,bytea,smallint) from public,anon,authenticated;
revoke all on function public.register_google_oauth_state(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.consume_google_oauth_state(uuid,text) from public,anon,authenticated;
revoke all on function public.delete_google_refresh_token(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_google_connection_status(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_gmail_test_send(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_gmail_test_send(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.upsert_google_connection(uuid,uuid,text,text,bytea,bytea,bytea,smallint) to service_role;
grant execute on function public.read_google_refresh_token(uuid,uuid) to service_role;
grant execute on function public.replace_google_refresh_token(uuid,uuid,bytea,bytea,bytea,smallint) to service_role;
grant execute on function public.register_google_oauth_state(uuid,text,timestamptz) to service_role;
grant execute on function public.consume_google_oauth_state(uuid,text) to service_role;
grant execute on function public.delete_google_refresh_token(uuid,uuid) to service_role;
grant execute on function public.set_google_connection_status(uuid,uuid,text) to service_role;
grant execute on function public.claim_gmail_test_send(uuid,uuid) to service_role;
grant execute on function public.finish_gmail_test_send(uuid,uuid,text,text,text) to service_role;
