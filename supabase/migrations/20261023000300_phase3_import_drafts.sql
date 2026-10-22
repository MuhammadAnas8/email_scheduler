-- Draft messages are not scheduled until Phase 4 adds queue confirmation.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.api_rate_limits (
  owner_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('import', 'draft', 'attachment')),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (owner_id, action)
);
revoke all on table private.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_app_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_owner_id uuid := auth.uid();
  v_limit integer;
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from statement_timestamp()) / 60) * 60);
  v_count integer;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_limit := case p_action when 'import' then 30 when 'draft' then 10 when 'attachment' then 10 else null end;
  if v_limit is null then raise exception 'invalid rate limit action' using errcode = '22023'; end if;

  insert into private.api_rate_limits (owner_id, action, window_start, request_count)
  values (v_owner_id, p_action, v_window_start, 1)
  on conflict (owner_id, action) do update
    set window_start = excluded.window_start,
        request_count = case
          when private.api_rate_limits.window_start < excluded.window_start then 1
          else private.api_rate_limits.request_count + 1
        end
  returning request_count into v_count;
  return v_count <= v_limit;
end;
$$;
revoke all on function public.consume_app_rate_limit(text) from public, anon;
grant execute on function public.consume_app_rate_limit(text) to authenticated;

alter table public.scheduled_emails alter column scheduled_at drop not null;
alter table public.scheduled_emails drop constraint scheduled_emails_body_check;
alter table public.scheduled_emails add constraint scheduled_emails_body_check
  check (length(btrim(body)) > 0);

-- Authenticated clients must not be able to bypass the server-side PDF validator.
drop policy "CV attachments: owner upload" on storage.objects;
drop policy if exists "CV attachments: owner replace" on storage.objects;

create or replace function public.create_draft_email_batch(p_name text, p_messages jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_batch_id uuid;
  v_message_count integer;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'invalid batch name' using errcode = '22023';
  end if;
  if jsonb_typeof(p_messages) is distinct from 'array' then
    raise exception 'messages must be an array' using errcode = '22023';
  end if;
  v_message_count := jsonb_array_length(p_messages);
  if v_message_count not between 1 and 200 then
    raise exception 'a draft must contain 1 through 200 messages' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_messages) as record(recipient text, subject text, body text)
    where record.recipient is null
      or record.subject is null
      or record.body is null
      or record.recipient !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?(\.[A-Z0-9]([A-Z0-9-]*[A-Z0-9])?)+$'
      or length(record.subject) not between 1 and 998
      or record.subject <> btrim(record.subject)
      or length(record.body) > 10000
      or length(btrim(record.body)) = 0
  ) then
    raise exception 'one or more email records are invalid' using errcode = '22023';
  end if;
  if not public.consume_app_rate_limit('draft') then
    raise exception 'draft rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.email_batches (owner_id, name, status)
  values (v_owner_id, btrim(p_name), 'draft')
  returning id into v_batch_id;

  insert into public.scheduled_emails (owner_id, batch_id, recipient, subject, body, status, scheduled_at)
  select v_owner_id, v_batch_id, record.recipient, record.subject, record.body, 'pending', null
  from jsonb_to_recordset(p_messages) as record(recipient text, subject text, body text);

  if (select count(*) from public.scheduled_emails where owner_id = v_owner_id and batch_id = v_batch_id) <> v_message_count then
    raise exception 'each message must include recipient, subject, and body' using errcode = '22023';
  end if;
  return v_batch_id;
end;
$$;

revoke all on function public.create_draft_email_batch(text, jsonb) from public, anon;
grant execute on function public.create_draft_email_batch(text, jsonb) to authenticated;

comment on function public.create_draft_email_batch(text, jsonb) is
  'Atomically creates an authenticated owner’s draft batch and its messages; does not schedule or send.';
