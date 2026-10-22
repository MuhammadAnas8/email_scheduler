begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(52);

select has_table('public', 'email_batches', 'email_batches exists');
select has_table('public', 'scheduled_emails', 'scheduled_emails exists');
select has_table('public', 'email_attempts', 'email_attempts exists');
select has_table('public', 'connected_accounts', 'connected_accounts exists');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'phase2-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'phase2-b@example.test');

insert into public.connected_accounts (id, owner_id, provider_subject, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'google-subject-a', 'a@gmail.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'google-subject-b', 'b@gmail.test');

insert into public.email_batches (id, owner_id, connected_account_id, name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'User A batch', 'draft'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'User B batch', 'cancelled');

insert into public.scheduled_emails (id, owner_id, batch_id, position, recipient, subject, body, scheduled_at, status) values
  ('aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 1, 'a-recipient@example.test', 'A subject', 'A body', now(), 'pending'),
  ('bbbbbbbb-eeee-4eee-8eee-eeeeeeeeeee2', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', 1, 'b-recipient@example.test', 'B subject', 'B body', now(), 'sent');

insert into public.email_attempts (owner_id, scheduled_email_id, attempt_number, started_at, ended_at, outcome) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1', 1, now() - interval '2 seconds', now() - interval '1 second', 'retrying'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-eeee-4eee-8eee-eeeeeeeeeee2', 1, now() - interval '2 seconds', now() - interval '1 second', 'sent');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.email_batches), 1::bigint, 'user A sees only A batches');
select is((select count(*) from public.scheduled_emails), 1::bigint, 'user A sees only A messages');
select is((select count(*) from public.email_attempts), 1::bigint, 'user A sees only A attempts');
select is((select count(*) from public.connected_accounts), 1::bigint, 'user A sees only A accounts');
select is((select count(*) from public.email_batches where owner_id = '22222222-2222-4222-8222-222222222222'), 0::bigint, 'user A cannot read B batches');
select is((select count(*) from public.scheduled_emails where owner_id = '22222222-2222-4222-8222-222222222222'), 0::bigint, 'user A cannot read B messages');
select is((select count(*) from public.email_attempts where owner_id = '22222222-2222-4222-8222-222222222222'), 0::bigint, 'user A cannot read B attempts');
select is((select count(*) from public.connected_accounts where owner_id = '22222222-2222-4222-8222-222222222222'), 0::bigint, 'user A cannot read B accounts');

select lives_ok(
  $$insert into public.email_batches (id, owner_id, name) values ('cccccccc-0000-4000-8000-000000000003', auth.uid(), 'User A draft')$$,
  'user A may insert an owned draft batch'
);
select throws_ok(
  $$update public.email_batches set name = 'User A draft edited' where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '42501', null, 'authenticated clients must use lifecycle RPCs for batch updates'
);
select throws_ok(
  $$insert into public.email_batches (owner_id, name) values ('22222222-2222-4222-8222-222222222222', 'Spoofed batch')$$,
  '42501', null, 'user A cannot insert a batch for user B'
);
select throws_ok(
  $$update public.email_batches set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '42501', null, 'user A cannot change an existing owner_id'
);
select throws_ok(
  $$update public.email_batches set status = 'scheduled' where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '42501', null, 'user A cannot advance a draft batch in this phase'
);
select throws_ok(
  $$insert into public.scheduled_emails (owner_id, batch_id, recipient, subject, body, scheduled_at) values (auth.uid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'new@example.test', 'subject', 'body', now())$$,
  '42501', null, 'authenticated clients cannot insert messages directly'
);
select throws_ok(
  $$insert into public.email_attempts (owner_id, scheduled_email_id, attempt_number, started_at, outcome) values (auth.uid(), 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1', 2, now(), 'sent')$$,
  '42501', null, 'authenticated clients cannot insert attempts directly'
);
select throws_ok(
  $$insert into public.connected_accounts (owner_id, provider_subject, email) values (auth.uid(), 'spoofed-subject', 'new@gmail.test')$$,
  '42501', null, 'authenticated clients cannot insert connected account metadata'
);
select lives_ok(
  $$delete from public.email_batches where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  'user A may delete an owned batch'
);

set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';
select is((select count(*) from public.email_batches), 1::bigint, 'user B sees only B batches');
select is((select count(*) from public.scheduled_emails), 1::bigint, 'user B sees only B messages');
select is((select count(*) from public.email_attempts), 1::bigint, 'user B sees only B attempts');
select is((select count(*) from public.connected_accounts), 1::bigint, 'user B sees only B accounts');
select is((select count(*) from public.email_batches where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'user B cannot read A batches');
select is((select count(*) from public.scheduled_emails where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'user B cannot read A messages');
select is((select count(*) from public.email_attempts where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'user B cannot read A attempts');
select is((select count(*) from public.connected_accounts where owner_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'user B cannot read A accounts');

reset role;

set constraints email_batches_connected_account_owner_fkey immediate;
select throws_ok(
  $$insert into public.email_batches (owner_id, connected_account_id, name) values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cross account')$$,
  '23503', null, 'batch cannot reference another owner account'
);
set constraints email_batches_connected_account_owner_fkey deferred;
select throws_ok(
  $$insert into public.scheduled_emails (owner_id, batch_id, position, recipient, subject, body, scheduled_at) values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-000000000002', 1, 'x@example.test', 'subject', 'body', now())$$,
  '23503', null, 'message cannot reference another owner batch'
);
select throws_ok(
  $$insert into public.email_attempts (owner_id, scheduled_email_id, attempt_number, started_at, outcome) values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-eeee-4eee-8eee-eeeeeeeeeee2', 2, now(), 'sent')$$,
  '23503', null, 'attempt cannot reference another owner message'
);

select throws_ok(
  $$insert into public.email_batches (owner_id, name, interval_seconds) values ('11111111-1111-4111-8111-111111111111', 'Out of range', 11)$$,
  '23514', null, 'batch interval is restricted to 5 through 10 seconds'
);
select throws_ok(
  $$insert into public.email_batches (owner_id, name, attachment_path) values ('11111111-1111-4111-8111-111111111111', 'Bad path', 'other/owner/cv.pdf')$$,
  '23514', null, 'attachment path must match its batch owner and ID'
);
select throws_ok(
  $$insert into public.email_attempts (owner_id, scheduled_email_id, attempt_number, started_at, outcome) values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1', -1, now(), 'sent')$$,
  '23514', null, 'attempt numbers must be positive'
);
select throws_ok(
  $$insert into public.email_attempts (owner_id, scheduled_email_id, attempt_number, started_at, ended_at, outcome) values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1', 3, now(), now() - interval '1 second', 'failed')$$,
  '23514', null, 'attempt end time cannot precede its start time'
);
select throws_ok(
  $$insert into public.email_batches (owner_id, name, status) values ('11111111-1111-4111-8111-111111111111', 'Bad state', 'sending')$$,
  '23514', null, 'batch status must be from the shared status set'
);
select throws_ok(
  $$insert into public.scheduled_emails (owner_id, batch_id, position, recipient, subject, body, scheduled_at, status) values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 2, 'x@example.test', 'subject', 'body', now(), 'draft')$$,
  '23514', null, 'message status must be from the shared status set'
);

select throws_ok(
  $$update public.email_batches set status = 'running' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', null, 'draft batch cannot transition directly to running'
);
select throws_ok(
  $$update public.email_batches set status = 'scheduled' where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '23514', null, 'cancelled batch is terminal'
);
select throws_ok(
  $$update public.scheduled_emails set status = 'sent' where id = 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1'$$,
  '23514', null, 'pending message cannot skip directly to sent'
);
select throws_ok(
  $$update public.scheduled_emails set status = 'failed' where id = 'bbbbbbbb-eeee-4eee-8eee-eeeeeeeeeee2'$$,
  '23514', null, 'sent message is terminal'
);
select throws_ok(
  $$update public.connected_accounts set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501', null, 'connected account owner_id is immutable'
);
select throws_ok(
  $$update public.scheduled_emails set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1'$$,
  '42501', null, 'message owner_id is immutable'
);
select throws_ok(
  $$update public.email_attempts set owner_id = '22222222-2222-4222-8222-222222222222' where scheduled_email_id = 'aaaaaaaa-eeee-4eee-8eee-eeeeeeeeeee1'$$,
  '42501', null, 'attempt owner_id is immutable'
);

select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('CV attachments: owner read', 'CV attachments: owner upload', 'CV attachments: owner delete')),
  2::bigint,
  'private CV storage has owner read and delete policies; uploads use the validated server route'
);
select ok(
  has_table_privilege('authenticated', 'public.email_batches', 'SELECT')
  and has_table_privilege('authenticated', 'public.email_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.email_batches', 'UPDATE')
  and has_table_privilege('authenticated', 'public.email_batches', 'DELETE'),
  'authenticated role has only the intended batch table operations'
);
select ok(
  not has_table_privilege('authenticated', 'public.scheduled_emails', 'INSERT')
  and not has_table_privilege('authenticated', 'public.scheduled_emails', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.scheduled_emails', 'DELETE')
  and not has_table_privilege('authenticated', 'public.email_attempts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.email_attempts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.email_attempts', 'DELETE')
  and not has_table_privilege('authenticated', 'public.connected_accounts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.connected_accounts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.connected_accounts', 'DELETE'),
  'authenticated role cannot directly write queue or account metadata'
);
select ok(
  not has_table_privilege('anon', 'public.email_batches', 'SELECT')
  and not has_table_privilege('anon', 'public.scheduled_emails', 'SELECT')
  and not has_table_privilege('anon', 'public.email_attempts', 'SELECT')
  and not has_table_privilege('anon', 'public.connected_accounts', 'SELECT'),
  'anon role has no table access'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('email_batches', 'scheduled_emails', 'email_attempts', 'connected_accounts') and c.relrowsecurity),
  4::bigint,
  'RLS is enabled on all four user-owned tables'
);

insert into auth.users (id, email)
values ('33333333-3333-4333-8333-333333333333', 'phase2-c@example.test');
insert into public.connected_accounts (id, owner_id, provider_subject, email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', 'google-subject-c', 'c@gmail.test');
insert into public.email_batches (id, owner_id, connected_account_id, name)
values ('cccccccc-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'User C batch');
select lives_ok(
  $$delete from auth.users where id = '33333333-3333-4333-8333-333333333333'$$,
  'deleting an owner cascades through batches and their connected account'
);
select is(
  (select (select count(*) from public.email_batches where owner_id = '33333333-3333-4333-8333-333333333333') + (select count(*) from public.connected_accounts where owner_id = '33333333-3333-4333-8333-333333333333')),
  0::bigint,
  'owner deletion leaves no batch or account rows'
);

select * from finish();
rollback;
