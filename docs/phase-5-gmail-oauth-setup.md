# Phase 5 Gmail OAuth setup

This checklist covers external configuration needed before Gmail connection works. Keep real credentials out of this repository and out of every `NEXT_PUBLIC_*` variable.

## 1. Configure Google Cloud

1. Create or select a Google Cloud project for Correspond.
2. Enable the **Gmail API** in that project.
3. Configure the OAuth consent screen. For personal testing, select the appropriate audience and add the Google account you will use as a test user. The app requests `openid`, `email`, and only the Gmail `gmail.send` scope.
4. Create an OAuth client with application type **Web application**.
5. Add these authorized redirect URIs exactly (no trailing slash):
   - Local: `http://localhost:3000/api/auth/google/callback`
   - Deployed: `https://YOUR-APP-HOST/api/auth/google/callback`
6. Copy the OAuth client ID and client secret into the server environment in the next section. Do not put either value in browser code.

Google may require OAuth app verification before public use of Gmail permissions. A testing configuration with an explicit test user is the intended first setup. Review Google's [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail sending guide](https://developers.google.com/workspace/gmail/api/guides/sending), and [OAuth verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) for the project's current audience and publication requirements.

## 2. Configure server environment

Copy `.env.example` to `.env.local`, then replace the Google placeholders with values from the Web application OAuth client:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
TOKEN_ENCRYPTION_KEY=64-hex-characters-from-the-command-below
```

Generate a fresh 32-byte encryption key in a terminal on the machine that will run the app:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated 64-character hex value in a secure secret manager and in the local `.env.local` file. Keep a secure backup: losing this key makes stored refresh tokens unrecoverable. The Phase 6 worker must receive the same key through its own server-side secret configuration. Key rotation is not implemented in Phase 5; preserve the old key until a planned re-encryption procedure is available.

For deployment, set `GOOGLE_REDIRECT_URI` to the deployed callback URL and add that same exact URL to the OAuth client. Keep `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` as server secrets. The repository's `.gitignore` ignores `.env.local`; never commit a real key or client secret.

The Next.js development request logger excludes the OAuth callback because its query contains a short-lived authorization code and state. Configure any hosting proxy, CDN, error tracker, and APM request logger to redact query strings for `/api/auth/google/callback`; do not capture OAuth callback query parameters.

## 3. Apply the database migration

The repository is integrated with Supabase, so its migration integration should detect `supabase/migrations/20261023000500_phase5_google_oauth.sql` and apply it. Confirm that migration is applied before using Gmail settings. It adds private token, OAuth replay-state, and test-send records plus service-role-only RPCs. The `private` schema must stay outside the Supabase API exposed-schema list.

No Docker stack, manual schema edit, hosted `db push`, or database reset is part of this setup.

## 4. Try a manual test

1. Start the app and sign in with an administrator-provisioned Supabase user.
2. Open **Settings → Connect Gmail** and authorize the Google test user.
3. Confirm the verified Gmail address appears as connected. Connecting alone sends no email.
4. Use **Send one test email** with an address you control. Confirm the attestation and the final browser prompt. An optional attachment must be a valid PDF no larger than 10 MiB.
5. If the result is uncertain, check Gmail Sent before sending another test. Each new test requires a new explicit confirmation.

Phase 5 does not send queued batches. Scheduled sending, persistent worker operation, crash recovery, and bounded retry policy remain Phase 6 work.
