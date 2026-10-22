import { Suspense } from "react";
import { signInAction } from "./actions";

function LoginFallback() {
  return <section className="auth-panel" aria-busy="true"><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Sign in to Correspond</h1></section>;
}

async function LoginContents({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return (
    <section className="auth-panel" aria-labelledby="login-heading">
      <p className="eyebrow">PRIVATE WORKSPACE</p>
      <h1 id="login-heading">Sign in to Correspond</h1>
      <p className="welcome-copy">Accounts are provisioned by the administrator. Public registration is disabled.</p>
      {params.error && <p className="form-error" role="alert">Sign in failed. Check your email and password.</p>}
      <form className="auth-form" action={signInAction}>
        <label>Email address<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="primary-button" type="submit">Sign in</button>
      </form>
    </section>
  );
}

export default function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  return <Suspense fallback={<LoginFallback />}><LoginContents {...props} /></Suspense>;
}
