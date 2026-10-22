begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

select has_function('public', 'schedule_email_batch', array['uuid', 'timestamp with time zone', 'smallint'], 'schedule RPC exists');
select has_function('public', 'pause_email_batch', array['uuid'], 'pause RPC exists');
select has_function('public', 'resume_email_batch', array['uuid'], 'resume RPC exists');
select has_function('public', 'cancel_email_batch', array['uuid'], 'cancel RPC exists');
select has_function('public', 'skip_scheduled_email', array['uuid', 'uuid'], 'skip RPC exists');
select has_function('public', 'get_email_batch_counts', array[]::text[], 'count RPC exists');
select has_function('public', 'set_draft_attachment_path', array['uuid', 'text'], 'narrow draft attachment RPC exists');
select has_column('public', 'scheduled_emails', 'position', 'message position exists');

insert into auth.users (id, email) values
  ('44444444-4444-4444-8444-444444444444', 'phase4-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'phase4-b@example.test');

insert into public.email_batches (id, owner_id, name, status) values
  ('44444444-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Immediate batch', 'draft'),
  ('44444444-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'Future batch', 'draft'),
  ('44444444-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444', 'Bad interval 4', 'draft'),
  ('44444444-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 'Bad interval 11', 'draft'),
  ('44444444-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444', 'Past start', 'draft'),
  ('44444444-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444', 'Upper interval', 'draft'),
  ('55555555-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'Other owner batch', 'scheduled');

insert into public.scheduled_emails (id, owner_id, batch_id, position, recipient, subject, body, status, scheduled_at)
select ids.id, ids.owner_id, ids.batch_id, ids.position, ids.recipient, 'Subject', 'Body', 'pending', null
from (values
  ('44444444-eeee-4eee-8eee-eeeeeeeeee01'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000001'::uuid, 1, 'a1@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee02'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000001'::uuid, 2, 'a2@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee03'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000001'::uuid, 3, 'a3@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee04'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000002'::uuid, 1, 'future1@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee05'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000002'::uuid, 2, 'future2@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee06'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000003'::uuid, 1, 'low@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee07'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000004'::uuid, 1, 'high@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee08'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000005'::uuid, 1, 'past@example.test'),
  ('44444444-eeee-4eee-8eee-eeeeeeeeee09'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, '44444444-0000-4000-8000-000000000006'::uuid, 1, 'upper@example.test'),
  ('55555555-eeee-4eee-8eee-eeeeeeeeee01'::uuid, '55555555-5555-4555-8555-555555555555'::uuid, '55555555-0000-4000-8000-000000000001'::uuid, 1, 'b1@example.test')
) as ids(id, owner_id, batch_id, position, recipient);

create temporary table phase4_ordinality_fixture (id uuid);
grant insert, select on table phase4_ordinality_fixture to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '44444444-4444-4444-8444-444444444444';

insert into phase4_ordinality_fixture
select public.create_draft_email_batch('Ordinality test', '[{"recipient":"first@example.test","subject":"Subject","body":"Body"},{"recipient":"second@example.test","subject":"Subject","body":"Body"}]'::jsonb);
select is(
  (select array_agg(message.position order by message.position) from public.scheduled_emails as message
   where message.batch_id = (select id from phase4_ordinality_fixture)),
  array[1, 2]::integer[],
  'draft RPC stores message positions in import order'
);
select is(public.schedule_email_batch('44444444-0000-4000-8000-000000000001', null, 7::smallint), '44444444-0000-4000-8000-000000000001'::uuid, 'immediate scheduling returns the batch ID');
select is((select status from public.email_batches where id = '44444444-0000-4000-8000-000000000001'), 'scheduled', 'draft becomes scheduled');
select ok((select starts_at between statement_timestamp() - interval '5 seconds' and statement_timestamp() from public.email_batches where id = '44444444-0000-4000-8000-000000000001'), 'immediate start uses the database statement time');
select is((select interval_seconds from public.email_batches where id = '44444444-0000-4000-8000-000000000001'), 7::smallint, 'schedule persists the selected interval');
select is((select max(scheduled_at) - min(scheduled_at) from public.scheduled_emails where batch_id = '44444444-0000-4000-8000-000000000001'), interval '14 seconds', 'positions receive deterministic interval spacing');
select is((select bool_and(next_attempt_at = scheduled_at) from public.scheduled_emails where batch_id = '44444444-0000-4000-8000-000000000001'), true, 'worker-compatible next attempt times match scheduled times');
select is(public.schedule_email_batch('44444444-0000-4000-8000-000000000001', '2030-01-01 00:00:00+00', 10::smallint), '44444444-0000-4000-8000-000000000001'::uuid, 'repeated scheduling is idempotent');
select is((select interval_seconds from public.email_batches where id = '44444444-0000-4000-8000-000000000001'), 7::smallint, 'repeated schedule payload cannot alter the persisted schedule');
select lives_ok($$select public.schedule_email_batch('44444444-0000-4000-8000-000000000002', '2030-01-01 00:00:00+00', 5::smallint)$$, 'future scheduling accepts the lower interval boundary');
select is((select starts_at from public.email_batches where id = '44444444-0000-4000-8000-000000000002'), '2030-01-01 00:00:00+00'::timestamptz, 'future start persists in UTC');
select is((select max(scheduled_at) - min(scheduled_at) from public.scheduled_emails where batch_id = '44444444-0000-4000-8000-000000000002'), interval '5 seconds', 'future messages preserve position-based spacing');
select throws_ok($$select public.schedule_email_batch('44444444-0000-4000-8000-000000000003', null, 4::smallint)$$, '22023', null, 'interval below five seconds is rejected');
select throws_ok($$select public.schedule_email_batch('44444444-0000-4000-8000-000000000004', null, 11::smallint)$$, '22023', null, 'interval above ten seconds is rejected');
select throws_ok($$select public.schedule_email_batch('44444444-0000-4000-8000-000000000005', '2020-01-01 00:00:00+00', 5::smallint)$$, '22023', null, 'past start time is rejected');
select lives_ok($$select public.schedule_email_batch('44444444-0000-4000-8000-000000000006', '2030-01-01 00:00:00+00', 10::smallint)$$, 'future scheduling accepts the upper interval boundary');
select is(public.set_draft_attachment_path('44444444-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444/44444444-0000-4000-8000-000000000005/cv.pdf'), true, 'owner can attach a private PDF to a draft through the narrow RPC');
select throws_ok($$select public.set_draft_attachment_path('44444444-0000-4000-8000-000000000005', 'other-owner/file.pdf')$$, '22023', null, 'attachment RPC rejects paths outside the owner''s batch namespace');

select is(public.pause_email_batch('44444444-0000-4000-8000-000000000001'), 'paused', 'scheduled batch pauses');
select is(public.pause_email_batch('44444444-0000-4000-8000-000000000001'), 'paused', 'repeated pause is idempotent');
select is(public.resume_email_batch('44444444-0000-4000-8000-000000000001'), 'scheduled', 'paused batch resumes');
select is(public.resume_email_batch('44444444-0000-4000-8000-000000000001'), 'scheduled', 'repeated resume is idempotent');
select throws_ok($$select public.pause_email_batch('44444444-0000-4000-8000-000000000003')$$, '55000', null, 'draft batch cannot pause');
select is(public.skip_scheduled_email('44444444-0000-4000-8000-000000000001', '44444444-eeee-4eee-8eee-eeeeeeeeee01'), 'skipped', 'one pending message can be skipped');
select is(public.skip_scheduled_email('44444444-0000-4000-8000-000000000001', '44444444-eeee-4eee-8eee-eeeeeeeeee01'), 'skipped', 'repeated skip is idempotent');
select is(public.pause_email_batch('44444444-0000-4000-8000-000000000001'), 'paused', 'batch can be paused before cancellation');
select is(public.cancel_email_batch('44444444-0000-4000-8000-000000000001'), 'cancelled', 'paused batch cancels');
select is(public.cancel_email_batch('44444444-0000-4000-8000-000000000001'), 'cancelled', 'repeated cancel is idempotent');
select is((select status from public.scheduled_emails where id = '44444444-eeee-4eee-8eee-eeeeeeeeee01'), 'skipped', 'cancellation preserves skipped history');
select is((select count(*) from public.scheduled_emails where batch_id = '44444444-0000-4000-8000-000000000001' and status = 'cancelled'), 2::bigint, 'cancellation marks every remaining pending message cancelled');
select is((select total_count from public.get_email_batch_counts() where batch_id = '44444444-0000-4000-8000-000000000001'), 3::bigint, 'count RPC derives total from message rows');
select is((select pending_count from public.get_email_batch_counts() where batch_id = '44444444-0000-4000-8000-000000000001'), 0::bigint, 'count RPC reports no pending rows after cancellation');
select is((select skipped_count from public.get_email_batch_counts() where batch_id = '44444444-0000-4000-8000-000000000001'), 1::bigint, 'count RPC reports skipped rows');
select is((select cancelled_count from public.get_email_batch_counts() where batch_id = '44444444-0000-4000-8000-000000000001'), 2::bigint, 'count RPC reports cancelled rows');
select throws_ok($$select public.skip_scheduled_email('44444444-0000-4000-8000-000000000001', '44444444-eeee-4eee-8eee-eeeeeeeeee02')$$, '55000', null, 'cancelled message cannot be skipped');
select throws_ok($$update public.email_batches set status = 'running' where id = '44444444-0000-4000-8000-000000000002'$$, '42501', null, 'authenticated owner cannot directly transition a batch to running');
select throws_ok($$update public.scheduled_emails set status = 'sent' where id = '44444444-eeee-4eee-8eee-eeeeeeeeee04'$$, '42501', null, 'authenticated owner cannot directly mark a message sent');

select throws_ok($$select public.schedule_email_batch('55555555-0000-4000-8000-000000000001', null, 5::smallint)$$, 'P0002', null, 'owner cannot schedule another user batch');
select throws_ok($$select public.pause_email_batch('55555555-0000-4000-8000-000000000001')$$, 'P0002', null, 'owner cannot pause another user batch');
select throws_ok($$select public.resume_email_batch('55555555-0000-4000-8000-000000000001')$$, 'P0002', null, 'owner cannot resume another user batch');
select throws_ok($$select public.cancel_email_batch('55555555-0000-4000-8000-000000000001')$$, 'P0002', null, 'owner cannot cancel another user batch');
select throws_ok($$select public.skip_scheduled_email('55555555-0000-4000-8000-000000000001', '55555555-eeee-4eee-8eee-eeeeeeeeee01')$$, 'P0002', null, 'owner cannot skip another user message');
select throws_ok($$select public.set_draft_attachment_path('55555555-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444/55555555-0000-4000-8000-000000000001/cv.pdf')$$, 'P0002', null, 'owner cannot change another user''s attachment metadata');
select is((select count(*) from public.get_email_batch_counts() where batch_id = '55555555-0000-4000-8000-000000000001'), 0::bigint, 'count RPC hides another owner batch');
reset role;
select is((select status from public.email_batches where id = '55555555-0000-4000-8000-000000000001'), 'scheduled', 'foreign lifecycle requests leave other batch unchanged');
select is((select status from public.scheduled_emails where id = '55555555-eeee-4eee-8eee-eeeeeeeeee01'), 'pending', 'foreign skip leaves other message unchanged');

select * from finish();
rollback;
