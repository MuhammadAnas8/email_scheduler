begin;
select plan(32);

select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot access private schema');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated cannot access private schema');
select ok(not has_table_privilege('anon', 'private.connected_account_tokens', 'select'), 'anon cannot read encrypted tokens');
select ok(not has_table_privilege('authenticated', 'private.connected_account_tokens', 'select'), 'authenticated cannot read encrypted tokens');
select ok(not has_table_privilege('authenticated', 'private.gmail_test_sends', 'select'), 'authenticated cannot read test-send records');
select ok(not has_table_privilege('service_role', 'private.connected_account_tokens', 'select'), 'service role uses the narrow token RPC instead of direct table access');
select ok(has_function_privilege('service_role', 'public.read_google_refresh_token(uuid,uuid)', 'execute'), 'service role can execute token reader');
select ok(not has_function_privilege('authenticated', 'public.read_google_refresh_token(uuid,uuid)', 'execute'), 'authenticated cannot execute token reader');
select ok(not has_function_privilege('anon', 'public.read_google_refresh_token(uuid,uuid)', 'execute'), 'anon cannot execute token reader');
select ok(has_function_privilege('service_role', 'public.upsert_google_connection(uuid,uuid,text,text,bytea,bytea,bytea,smallint)', 'execute'), 'service role can atomically connect');
select ok(not has_function_privilege('authenticated', 'public.upsert_google_connection(uuid,uuid,text,text,bytea,bytea,bytea,smallint)', 'execute'), 'authenticated cannot connect through privileged RPC');
select ok(not has_function_privilege('authenticated', 'public.claim_gmail_test_send(uuid,uuid)', 'execute'), 'authenticated cannot claim send records');
select ok(has_function_privilege('service_role', 'public.claim_gmail_test_send(uuid,uuid)', 'execute'), 'service role can claim test sends');
select ok(not has_function_privilege('authenticated', 'public.finish_gmail_test_send(uuid,uuid,text,text,text)', 'execute'), 'authenticated cannot finalize sends');
select ok(not has_table_privilege('authenticated', 'private.google_oauth_states', 'select'), 'authenticated cannot access OAuth replay state');
select ok(not has_function_privilege('authenticated', 'public.register_google_oauth_state(uuid,text,timestamptz)', 'execute'), 'authenticated cannot register OAuth states');
select ok(has_function_privilege('service_role', 'public.register_google_oauth_state(uuid,text,timestamptz)', 'execute'), 'service role registers OAuth state hashes');
select ok(has_function_privilege('service_role', 'public.consume_google_oauth_state(uuid,text)', 'execute'), 'service role consumes OAuth state exactly once');
select has_constraint('private', 'connected_account_tokens', 'connected_account_tokens_owner_id_connected_account_id_fkey', 'token row uses composite owner/account foreign key');
select has_index('public', 'connected_accounts', 'connected_accounts_one_active_per_owner_idx', 'only one active Gmail account per user');

insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-666666666666', 'phase5-a@example.test'),
  ('77777777-7777-4777-8777-777777777777', 'phase5-b@example.test');

select is(public.upsert_google_connection(
  '66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000001', 'google-subject-a', 'owner@example.test',
  decode('010203', 'hex'), decode('000102030405060708090a0b', 'hex'), decode('000102030405060708090a0b0c0d0e0f', 'hex'), 1
), '66666666-0000-4000-8000-000000000001'::uuid, 'owner can create encrypted account record');
select is(public.upsert_google_connection(
  '66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000001', 'google-subject-a', 'owner@example.test',
  null, null, null, 1
), '66666666-0000-4000-8000-000000000001'::uuid, 'reauthorization without refresh token preserves same account');
select is((select encode(ciphertext, 'hex') from private.connected_account_tokens where owner_id='66666666-6666-4666-8666-666666666666'), '010203', 'refresh token ciphertext is preserved');
select is((select count(*)::integer from public.read_google_refresh_token('77777777-7777-4777-8777-777777777777', '66666666-0000-4000-8000-000000000001')), 0, 'another owner cannot read the token');
select throws_ok($$select public.upsert_google_connection(
  '66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000002', 'google-subject-a', 'owner@example.test',
  null, null, null, 1
)$$, '40001', 'connection changed; retry authorization', 'mismatched account id is rejected');
select is(public.register_google_oauth_state('66666666-6666-4666-8666-666666666666', repeat('a', 64), now() + interval '5 minutes'), true, 'OAuth state hash can be registered');
select is(public.consume_google_oauth_state('66666666-6666-4666-8666-666666666666', repeat('a', 64)), true, 'registered OAuth state is consumed once');
select is(public.consume_google_oauth_state('66666666-6666-4666-8666-666666666666', repeat('a', 64)), false, 'replayed OAuth state is rejected');
select is((select claimed from public.claim_gmail_test_send('66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000010')), true, 'first send request claims atomically');
select is((select claimed from public.claim_gmail_test_send('66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000010')), false, 'duplicate send request does not claim twice');
select is(public.finish_gmail_test_send('66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000010', 'uncertain', null, 'outcome_uncertain'), 'uncertain', 'claimed request can be finalized as uncertain');
select is((select status from public.claim_gmail_test_send('66666666-6666-4666-8666-666666666666', '66666666-0000-4000-8000-000000000010')), 'uncertain', 'duplicate uncertain request retains manual resolution state');

select * from finish();
rollback;
