create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'google',
  provider_subject text not null,
  email text not null,
  status text not null default 'connected',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connected_accounts_provider_check check (provider = 'google'),
  constraint connected_accounts_provider_subject_check check (btrim(provider_subject) <> ''),
  constraint connected_accounts_email_check check (btrim(email) <> ''),
  constraint connected_accounts_status_check check (status in ('connected', 'disconnected', 'revoked', 'error')),
  constraint connected_accounts_owner_unique unique (owner_id),
  constraint connected_accounts_provider_subject_unique unique (provider, provider_subject),
  constraint connected_accounts_owner_id_unique unique (owner_id, id)
);

create table public.email_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  connected_account_id uuid,
  name text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  interval_seconds smallint not null default 5,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint email_batches_name_check check (name = btrim(name) and name <> ''),
  constraint email_batches_status_check check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  constraint email_batches_interval_seconds_check check (interval_seconds between 5 and 10),
  constraint email_batches_attachment_path_check check (
    attachment_path is null
    or attachment_path = owner_id::text || '/' || id::text || '/cv.pdf'
  ),
  constraint email_batches_owner_id_unique unique (owner_id, id),
  constraint email_batches_connected_account_owner_fkey
    foreign key (owner_id, connected_account_id)
    references public.connected_accounts (owner_id, id)
    on delete no action
    deferrable initially deferred
);

create table public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  scheduled_at timestamptz not null,
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_emails_recipient_check check (recipient = btrim(recipient) and recipient <> ''),
  constraint scheduled_emails_subject_check check (subject = btrim(subject) and subject <> ''),
  constraint scheduled_emails_body_check check (body = btrim(body) and body <> ''),
  constraint scheduled_emails_status_check check (status in ('pending', 'sending', 'sent', 'retrying', 'failed', 'skipped', 'uncertain')),
  constraint scheduled_emails_attempt_count_check check (attempt_count >= 0),
  constraint scheduled_emails_lease_check check ((lease_token is null) = (lease_expires_at is null)),
  constraint scheduled_emails_last_error_check check (last_error is null or length(last_error) <= 500),
  constraint scheduled_emails_owner_id_unique unique (owner_id, id),
  constraint scheduled_emails_batch_owner_fkey
    foreign key (owner_id, batch_id)
    references public.email_batches (owner_id, id)
    on delete cascade
);

create table public.email_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  scheduled_email_id uuid not null,
  attempt_number integer not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  outcome text not null,
  sanitized_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  constraint email_attempts_attempt_number_check check (attempt_number > 0),
  constraint email_attempts_time_order_check check (ended_at is null or ended_at >= started_at),
  constraint email_attempts_outcome_check check (outcome in ('sent', 'retrying', 'failed', 'uncertain')),
  constraint email_attempts_sanitized_error_check check (sanitized_error is null or length(sanitized_error) <= 500),
  constraint email_attempts_owner_email_attempt_unique unique (owner_id, scheduled_email_id, attempt_number),
  constraint email_attempts_email_owner_fkey
    foreign key (owner_id, scheduled_email_id)
    references public.scheduled_emails (owner_id, id)
    on delete cascade
);

create index email_batches_owner_history_idx
  on public.email_batches (owner_id, created_at desc, id);
create index scheduled_emails_owner_history_idx
  on public.scheduled_emails (owner_id, created_at desc, id);
create index scheduled_emails_batch_order_idx
  on public.scheduled_emails (owner_id, batch_id, scheduled_at, id);
create index scheduled_emails_due_idx
  on public.scheduled_emails (next_attempt_at, scheduled_at, id)
  where status in ('pending', 'retrying');
create index email_attempts_owner_history_idx
  on public.email_attempts (owner_id, scheduled_email_id, attempt_number desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_owner_id_change()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable' using errcode = '42501';
  end if;
  return new;
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
    or (old.status = 'paused' and new.status in ('running', 'cancelled', 'failed')) then
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

  if (old.status = 'pending' and new.status in ('sending', 'skipped'))
    or (old.status = 'retrying' and new.status in ('sending', 'skipped', 'failed'))
    or (old.status = 'sending' and new.status in ('sent', 'retrying', 'failed', 'uncertain'))
    or (old.status = 'uncertain' and new.status in ('sent', 'failed')) then
    return new;
  end if;

  raise exception 'invalid message status transition: % -> %', old.status, new.status
    using errcode = '23514';
end;
$$;

create trigger connected_accounts_set_updated_at
  before update on public.connected_accounts
  for each row execute function public.set_updated_at();
create trigger email_batches_set_updated_at
  before update on public.email_batches
  for each row execute function public.set_updated_at();
create trigger scheduled_emails_set_updated_at
  before update on public.scheduled_emails
  for each row execute function public.set_updated_at();

create trigger connected_accounts_owner_immutable
  before update on public.connected_accounts
  for each row execute function public.prevent_owner_id_change();
create trigger email_batches_owner_immutable
  before update on public.email_batches
  for each row execute function public.prevent_owner_id_change();
create trigger scheduled_emails_owner_immutable
  before update on public.scheduled_emails
  for each row execute function public.prevent_owner_id_change();
create trigger email_attempts_owner_immutable
  before update on public.email_attempts
  for each row execute function public.prevent_owner_id_change();

create trigger email_batches_status_transition
  before update of status on public.email_batches
  for each row execute function public.guard_email_batch_status_transition();
create trigger scheduled_emails_status_transition
  before update of status on public.scheduled_emails
  for each row execute function public.guard_scheduled_email_status_transition();

comment on table public.connected_accounts is 'One Google account per application user. OAuth tokens are intentionally stored elsewhere in a later phase.';
comment on table public.email_batches is 'User-owned batches. Counters are derived from scheduled_emails in this phase.';
comment on table public.scheduled_emails is 'User-owned scheduled message records; clients receive read-only access in this phase.';
comment on table public.email_attempts is 'Durable per-message send attempt history with sanitized errors only.';
