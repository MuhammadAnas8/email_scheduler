"use client";

import { useEffect, useRef, useState } from "react";

type Connection = { status: "loading" | "connected" | "disconnected" | "reconnect_required"; email: string | null };
type SendResult = { status: string; requestId: string; message?: string; code?: string; error?: string };

const oauthNotices: Record<string, string> = {
  connected: "Gmail is connected. No test email was sent.",
  oauth_denied: "Google authorization was cancelled.",
  oauth_state_invalid: "The authorization session expired or changed. Start again.",
  sign_in_required: "Sign in again before connecting Gmail.",
  disconnect_before_switch: "Disconnect the active Gmail account before connecting a different one.",
  google_account_in_use: "This Google account is already connected to another app user.",
  refresh_token_missing: "Google did not provide offline access. Start again and approve the requested access.",
  gmail_scope_missing: "Gmail send permission was not granted. Connect again and approve the Gmail send scope.",
  oauth_failed: "Google authorization did not complete. Try again.",
};

export function GmailSettings({ oauthResult }: { oauthResult?: string }) {
  const [connection, setConnection] = useState<Connection>({ status: "loading", email: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const requestId = useRef<string | null>(null);

  async function refreshConnection() {
    try {
      const response = await fetch("/api/gmail/connection", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { status: Connection["status"]; email: string | null };
      setConnection(data);
    } catch {
      setConnection({ status: "disconnected", email: null });
      setNotice("Could not load Gmail connection status. Refresh the page to try again.");
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/gmail/connection", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as { status: Connection["status"]; email: string | null };
      })
      .then((data) => { if (active) setConnection(data); })
      .catch(() => {
        if (active) {
          setConnection({ status: "disconnected", email: null });
          setNotice("Could not load Gmail connection status. Refresh the page to try again.");
        }
      });
    return () => { active = false; };
  }, []);

  async function disconnect() {
    if (!window.confirm("Disconnect Gmail? Future test sends will stop. Existing Gmail messages remain in your Gmail account.")) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/gmail/connection", { method: "POST" });
      const data = await response.json() as { remoteRevoked?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not disconnect Gmail.");
      setNotice(data.remoteRevoked ? "Gmail disconnected and Google's token revocation was confirmed." : "Gmail disconnected locally. Google could not confirm token revocation; remove app access in your Google Account if needed.");
      await refreshConnection();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not disconnect Gmail.");
    } finally { setBusy(false); }
  }

  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const recipient = String(data.get("recipient") ?? "");
    if (!window.confirm(`Send exactly one test email to ${recipient}?`)) return;
    setBusy(true);
    setNotice("");
    setResult(null);
    requestId.current ??= crypto.randomUUID();
    data.set("requestId", requestId.current);
    data.set("confirmed", "true");
    try {
      const response = await fetch("/api/gmail/test-send", { method: "POST", body: data });
      const payload = await response.json() as SendResult;
      if (!response.ok && response.status !== 202) throw new Error(payload.error ?? "Could not send the manual test.");
      setResult(payload);
      if (payload.status !== "sending" && payload.status !== "uncertain") requestId.current = null;
      if (payload.status === "sent") form.reset();
    } catch (error) {
      // Keep this request ID if the browser lost the response; retrying it cannot create a second send.
      setNotice(error instanceof Error ? error.message : "Could not send the manual test.");
    } finally { setBusy(false); }
  }

  return (
    <div className="gmail-settings">
      <section className="workflow-card" aria-labelledby="gmail-connection-heading">
        <p className="eyebrow">GMAIL CONNECTION</p>
        <div className="gmail-connection-heading">
          <div><h2 id="gmail-connection-heading">One account for this user</h2><p className="welcome-copy">The app can send only a manually confirmed test email in this phase.</p></div>
          <span className={`status-pill ${connection.status === "connected" ? "" : "gmail-status-muted"}`}>
            {connection.status === "loading" ? "Checking" : connection.status === "connected" ? "Connected" : connection.status === "reconnect_required" ? "Reconnect required" : "Disconnected"}
          </span>
        </div>
        {connection.email && <p className="gmail-account-email">{connection.email}</p>}
        <div className="history-actions">
          {connection.status !== "connected" && <a className="primary-button gmail-button" href="/api/auth/google/start">Connect Gmail</a>}
          {(connection.status === "connected" || connection.status === "reconnect_required") && <button className="danger-button" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect Gmail</button>}
        </div>
        <p className="phase-note">Connecting does not send an email. Scheduled batches remain queued; the persistent sender is a later phase.</p>
      </section>

      {connection.status === "connected" && <section className="workflow-card" aria-labelledby="manual-test-heading">
        <p className="eyebrow">MANUAL ACTION</p>
        <h2 id="manual-test-heading">Send one test email</h2>
        <p className="welcome-copy">Use an address you control. The message and optional PDF are sent to Gmail and are not saved as a batch.</p>
        <form className="gmail-test-form" onSubmit={(event) => void sendTest(event)}>
          <label className="field-label">Recipient email<input name="recipient" type="email" autoComplete="email" maxLength={320} required /></label>
          <label className="field-label">Subject<input name="subject" type="text" maxLength={998} required /></label>
          <label className="field-label">Plain-text message<textarea name="text" maxLength={10000} required /></label>
          <label className="field-label">Optional PDF attachment<input name="attachment" type="file" accept="application/pdf,.pdf" /></label>
          <label className="gmail-attestation"><input name="attestation" type="checkbox" required /> I control the recipient address and want to send one test email.</label>
          <button className="primary-button" type="submit" disabled={busy || result?.status === "sending" || result?.status === "uncertain"}>{busy ? "Working…" : "Review and send test"}</button>
        </form>
        {(result?.status === "sending" || result?.status === "uncertain") && <button className="secondary-button" type="button" onClick={() => {
          if (!window.confirm("Only continue after checking Gmail Sent for the previous test. Allow a new, separately confirmed test?")) return;
          requestId.current = null;
          setResult(null);
        }}>I checked Gmail Sent — prepare a new test</button>}
      </section>}

      {(notice || (oauthResult ? oauthNotices[oauthResult] : "")) && <p className={!notice && oauthResult === "connected" ? "form-success" : "form-error"} role="status">{notice || (oauthResult ? oauthNotices[oauthResult] : "")}</p>}
      {result && <p className={result.status === "sent" ? "form-success" : result.status === "uncertain" ? "form-error" : "form-error"} role="status">
        {result.message ?? (result.status === "sending" ? "This test is still processing. Do not submit it again." : "The test send finished without confirmation.")}
      </p>}
    </div>
  );
}
