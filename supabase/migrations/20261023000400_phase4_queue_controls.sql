-- Stable import order for scheduling and history. Existing rows are ranked
-- deterministically before the column becomes required.
alter table public.scheduled_emails add column position integer;

with ranked_messages as (
  select id, row_number() over (partition by owner_id, batch_id order by created_at, id) as row_position
  from public.scheduled_emails
)
update public.scheduled_emails as message
set position = ranked_messages.row_position
from ranked_messages
where message.id = ranked_messages.id;

alter table public.scheduled_emails alter column position set not null;
alter table public.scheduled_emails
  add constraint scheduled_emails_position_check check (position between 1 and 200),
  add constraint scheduled_emails_owner_batch_position_unique unique (owner_id, batch_id, position);

alter table public.scheduled_emails drop constraint scheduled_emails_status_check;
alter table public.scheduled_emails add constraint scheduled_emails_status_check
  check (status in ('pending', 'sending', 'sent', 'retrying', 'failed', 'skipped', 'uncertain', 'cancelled'));

-- Queue actions are the only code in this phase allowed to change lifecycle state.
revoke update on table public.email_batches from authenticated;
drop policy if exists "Users can update own draft batches" on public.email_batches;
revoke insert, update, delete on table public.scheduled_emails from anon, authenticated;

-- Preserve the Phase 3 PDF upload route without restoring broad batch UPDATE.
create or replace function public.set_draft_attachment_path(p_batch_id uuid, p_attachment_path text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_status text;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_batch_id is null or p_attachment_path is distinct from (v_owner_id::text || '/' || p_batch_id::text || '/cv.pdf') then
    raise exception 'invalid attachment path' using errcode = '22023';
  end if;

  select status into v_status from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if v_status <> 'draft' then raise exception 'attachments can only be added to drafts' using errcode = '55000'; end if;

  update public.email_batches set attachment_path = p_attachment_path
  where id = p_batch_id and owner_id = v_owner_id;
  return true;
end;
$$;

create or replace function public.guard_email_batch_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if (old.status = 'draft' and new.status in ('scheduled', 'cancelled'))
    or (old.status = 'scheduled' and new.status in ('running', 'paused', 'cancelled', 'failed'))
    or (old.status = 'running' and new.status in ('paused', 'completed', 'cancelled', 'failed'))
    or (old.status = 'paused' and new.status in ('scheduled', 'running', 'cancelled', 'failed')) then
    return new;
  end if;

  raise exception 'invalid batch status transition: % -> %', old.status, new.status
    using errcode = '23514';
end;
$$;

create or replace function public.guard_scheduled_email_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if (old.status = 'pending' and new.status in ('sending', 'skipped', 'cancelled'))
    or (old.status = 'retrying' and new.status in ('sending', 'skipped', 'failed'))
    or (old.status = 'sending' and new.status in ('sent', 'retrying', 'failed', 'uncertain'))
    or (old.status = 'uncertain' and new.status in ('sent', 'failed')) then
    return new;
  end if;

  raise exception 'invalid message status transition: % -> %', old.status, new.status
    using errcode = '23514';
end;
$$;

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

  insert into public.scheduled_emails (owner_id, batch_id, position, recipient, subject, body, status, scheduled_at)
  select v_owner_id, v_batch_id, item.ordinality::integer, record.recipient, record.subject, record.body, 'pending', null
  from jsonb_array_elements(p_messages) with ordinality as item(value, ordinality)
  cross join lateral jsonb_to_record(item.value) as record(recipient text, subject text, body text)
  order by item.ordinality;

  if (select count(*) from public.scheduled_emails where owner_id = v_owner_id and batch_id = v_batch_id) <> v_message_count then
    raise exception 'each message must include recipient, subject, and body' using errcode = '22023';
  end if;
  return v_batch_id;
end;
$$;

revoke all on function public.create_draft_email_batch(text, jsonb) from public, anon;
grant execute on function public.create_draft_email_batch(text, jsonb) to authenticated;
revoke all on function public.set_draft_attachment_path(uuid, text) from public, anon;
grant execute on function public.set_draft_attachment_path(uuid, text) to authenticated;

create or replace function public.schedule_email_batch(
  p_batch_id uuid,
  p_starts_at timestamptz,
  p_interval_seconds smallint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_batch public.email_batches%rowtype;
  v_message_count integer;
  v_starts_at timestamptz;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_batch_id is null or p_interval_seconds is null or p_interval_seconds not between 5 and 10 then
    raise exception 'invalid schedule input' using errcode = '22023';
  end if;

  select * into v_batch
  from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception 'batch not found' using errcode = 'P0002';
  end if;

  -- A timeout retry after scheduling (or after a later pause/cancel) never
  -- rewrites the original start or interval.
  if v_batch.status in ('scheduled', 'paused')
    or (v_batch.status = 'cancelled' and v_batch.starts_at is not null) then
    return v_batch.id;
  end if;
  if v_batch.status <> 'draft' then
    raise exception 'batch cannot be scheduled in its current state' using errcode = '55000';
  end if;
  if p_starts_at is not null and p_starts_at <= statement_timestamp() then
    raise exception 'start time must be in the future' using errcode = '22023';
  end if;

  perform message.id
  from public.scheduled_emails as message
  where message.owner_id = v_owner_id and message.batch_id = v_batch.id
  order by message.position
  for update;

  select count(*) into v_message_count
  from public.scheduled_emails as message
  where message.owner_id = v_owner_id and message.batch_id = v_batch.id and message.status = 'pending';
  if v_message_count not between 1 and 200
    or exists (
      select 1 from public.scheduled_emails as message
      where message.owner_id = v_owner_id and message.batch_id = v_batch.id and message.status <> 'pending'
    ) then
    raise exception 'draft must contain 1 through 200 pending messages' using errcode = '22023';
  end if;

  v_starts_at := coalesce(p_starts_at, statement_timestamp());
  update public.email_batches
  set status = 'scheduled', starts_at = v_starts_at, interval_seconds = p_interval_seconds
  where id = v_batch.id and owner_id = v_owner_id;

  update public.scheduled_emails as message
  set scheduled_at = v_starts_at + ((message.position - 1) * p_interval_seconds) * interval '1 second',
      next_attempt_at = v_starts_at + ((message.position - 1) * p_interval_seconds) * interval '1 second'
  where message.owner_id = v_owner_id and message.batch_id = v_batch.id;

  return v_batch.id;
end;
$$;

create or replace function public.pause_email_batch(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_status text;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_batch_id is null then raise exception 'invalid batch ID' using errcode = '22023'; end if;
  select status into v_status from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if v_status = 'paused' then return 'paused'; end if;
  if v_status <> 'scheduled' then raise exception 'batch cannot be paused in its current state' using errcode = '55000'; end if;
  update public.email_batches set status = 'paused' where id = p_batch_id and owner_id = v_owner_id;
  return 'paused';
end;
$$;

create or replace function public.resume_email_batch(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_status text;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_batch_id is null then raise exception 'invalid batch ID' using errcode = '22023'; end if;
  select status into v_status from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if v_status = 'scheduled' then return 'scheduled'; end if;
  if v_status <> 'paused' then raise exception 'batch cannot be resumed in its current state' using errcode = '55000'; end if;
  update public.email_batches set status = 'scheduled' where id = p_batch_id and owner_id = v_owner_id;
  return 'scheduled';
end;
$$;

create or replace function public.cancel_email_batch(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_status text;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_batch_id is null then raise exception 'invalid batch ID' using errcode = '22023'; end if;
  select status into v_status from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if v_status = 'cancelled' then return 'cancelled'; end if;
  if v_status not in ('scheduled', 'paused') then raise exception 'batch cannot be cancelled in its current state' using errcode = '55000'; end if;

  perform message.id
  from public.scheduled_emails as message
  where message.owner_id = v_owner_id and message.batch_id = p_batch_id
  order by message.position
  for update;

  update public.scheduled_emails
  set status = 'cancelled'
  where owner_id = v_owner_id and batch_id = p_batch_id and status = 'pending';
  update public.email_batches set status = 'cancelled' where id = p_batch_id and owner_id = v_owner_id;
  return 'cancelled';
end;
$$;

create or replace function public.skip_scheduled_email(p_batch_id uuid, p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_batch_status text;
  v_message_status text;
begin
  if v_owner_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_batch_id is null or p_message_id is null then raise exception 'invalid message ID' using errcode = '22023'; end if;

  select status into v_batch_status from public.email_batches
  where id = p_batch_id and owner_id = v_owner_id for update;
  if not found then raise exception 'batch not found' using errcode = 'P0002'; end if;

  select status into v_message_status from public.scheduled_emails
  where id = p_message_id and batch_id = p_batch_id and owner_id = v_owner_id
  for update;
  if not found then raise exception 'message not found' using errcode = 'P0002'; end if;
  if v_message_status = 'skipped' then return 'skipped'; end if;
  if v_batch_status not in ('scheduled', 'paused') or v_message_status <> 'pending' then
    raise exception 'message cannot be skipped in its current state' using errcode = '55000';
  end if;

  update public.scheduled_emails set status = 'skipped'
  where id = p_message_id and batch_id = p_batch_id and owner_id = v_owner_id;
  return 'skipped';
end;
$$;

create or replace function public.get_email_batch_counts()
returns table (
  batch_id uuid,
  total_count bigint,
  pending_count bigint,
  skipped_count bigint,
  cancelled_count bigint,
  sent_count bigint,
  failed_count bigint,
  uncertain_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    batch.id,
    count(message.id)::bigint,
    count(message.id) filter (where message.status = 'pending')::bigint,
    count(message.id) filter (where message.status = 'skipped')::bigint,
    count(message.id) filter (where message.status = 'cancelled')::bigint,
    count(message.id) filter (where message.status = 'sent')::bigint,
    count(message.id) filter (where message.status = 'failed')::bigint,
    count(message.id) filter (where message.status = 'uncertain')::bigint
  from public.email_batches as batch
  left join public.scheduled_emails as message
    on message.owner_id = batch.owner_id and message.batch_id = batch.id
  group by batch.id
  order by batch.id
$$;

revoke all on function public.schedule_email_batch(uuid, timestamptz, smallint) from public, anon;
revoke all on function public.pause_email_batch(uuid) from public, anon;
revoke all on function public.resume_email_batch(uuid) from public, anon;
revoke all on function public.cancel_email_batch(uuid) from public, anon;
revoke all on function public.skip_scheduled_email(uuid, uuid) from public, anon;
revoke all on function public.get_email_batch_counts() from public, anon;
grant execute on function public.schedule_email_batch(uuid, timestamptz, smallint) to authenticated;
grant execute on function public.pause_email_batch(uuid) to authenticated;
grant execute on function public.resume_email_batch(uuid) to authenticated;
grant execute on function public.cancel_email_batch(uuid) to authenticated;
grant execute on function public.skip_scheduled_email(uuid, uuid) to authenticated;
grant execute on function public.get_email_batch_counts() to authenticated;

comment on function public.schedule_email_batch(uuid, timestamptz, smallint) is
  'Atomically schedules an owned draft in import order; does not claim or send messages.';
comment on function public.set_draft_attachment_path(uuid, text) is
  'Sets the owner-matching private CV object path on an owned draft without granting direct batch updates.';
comment on function public.cancel_email_batch(uuid) is
  'Cancels an owned scheduled or paused batch and only its remaining pending messages.';
comment on function public.get_email_batch_counts() is
  'Returns owner-visible message counts derived from persisted rows; does not maintain counters.';
