begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('31111111-1111-4111-8111-111111111111', 'phase3-a@example.test'),
  ('32222222-2222-4222-8222-222222222222', 'phase3-b@example.test');

set local role authenticated;
set local "request.jwt.claim.sub" = '31111111-1111-4111-8111-111111111111';
select lives_ok(
  $$select public.create_draft_email_batch('A draft', '[{"recipient":"a@example.test","subject":"Hello","body":"Line one\nLine two"}]'::jsonb)$$,
  'authenticated owner can create a draft with plain-text body'
);
select is((select count(*) from public.email_batches where owner_id = auth.uid()), 1::bigint, 'draft belongs to authenticated owner');
select is((select count(*) from public.scheduled_emails where owner_id = auth.uid() and scheduled_at is null), 1::bigint, 'draft messages are not scheduled');
select is((select body from public.scheduled_emails where owner_id = auth.uid()), E'Line one\nLine two', 'full plain-text body is preserved');
select is((select count(*) from public.email_batches where owner_id = '32222222-2222-4222-8222-222222222222'), 0::bigint, 'other owner draft is inaccessible');
select throws_ok(
  $$select public.create_draft_email_batch('Too many', (select jsonb_agg(jsonb_build_object('recipient', 'a@example.test', 'subject', 'Hello', 'body', 'body')) from generate_series(1, 201)))$$,
  '22023', 'a draft must contain 1 through 200 messages', 'database enforces the 200-message maximum'
);
select throws_ok(
  $$select public.create_draft_email_batch('Invalid address', '[{"recipient":"not-an-address","subject":"Hello","body":"body"}]'::jsonb)$$,
  '22023', 'one or more email records are invalid', 'database RPC also rejects malformed email addresses'
);
select is(public.consume_app_rate_limit('attachment'), true, 'authenticated owner receives an attachment quota');
select is(
  (select count(*) from generate_series(1, 9) request where public.consume_app_rate_limit('attachment')),
  9::bigint, 'per-owner rate limit allows the configured requests'
);
select is(public.consume_app_rate_limit('attachment'), false, 'per-owner rate limit rejects excess requests');
select ok(not has_table_privilege('authenticated', 'private.api_rate_limits', 'SELECT'), 'users cannot inspect private rate limit state');

select * from finish();
rollback;
