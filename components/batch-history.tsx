"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmailBatchRow, ScheduledEmailRow } from "@/lib/data/scheduler";
import type { EmailBatchCounts } from "@/lib/types";

type Props = {
  batches: EmailBatchRow[];
  messages: ScheduledEmailRow[];
  counts: EmailBatchCounts[];
};

function localTime(value: string | null) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function BatchHistory({ batches, messages, counts }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function performAction(url: string, action: "pause" | "resume" | "cancel" | "skip", label: string) {
    setError("");
    if (action === "cancel" && !window.confirm("Cancel this batch? This stops future queue work. Phase 4 does not send email.")) return;
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: action === "skip" ? undefined : { "Content-Type": "application/json" },
        body: action === "skip" ? undefined : JSON.stringify({ action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `${label} could not be saved.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} could not be saved.`);
    } finally {
      setBusy(false);
    }
  }

  const messagesByBatch = new Map<string, ScheduledEmailRow[]>();
  for (const message of messages) {
    const items = messagesByBatch.get(message.batch_id) ?? [];
    items.push(message);
    messagesByBatch.set(message.batch_id, items);
  }
  const countsByBatch = new Map(counts.map((row) => [row.batch_id, row]));

  if (batches.length === 0) {
    return <section className="empty-state" aria-label="Batch history">
      <h2>No batches yet</h2>
      <p>Saved drafts and confirmed schedules will appear here. Phase 4 stores queue state only; email sending is not available.</p>
    </section>;
  }

  return <div className="history-list">
    {error && <p className="form-error" role="alert">{error}</p>}
    {batches.map((batch) => {
      const batchMessages = messagesByBatch.get(batch.id) ?? [];
      const batchCounts = countsByBatch.get(batch.id);
      const canControl = batch.status === "scheduled" || batch.status === "paused";
      return <article className="history-card" key={batch.id}>
        <header className="history-card-heading">
          <div><p className="eyebrow">{batch.status.toUpperCase()}</p><h2>{batch.name}</h2></div>
          <span className="status-pill">{batch.status}</span>
        </header>
        <dl className="batch-metadata">
          <div><dt>Created</dt><dd><time dateTime={batch.created_at}>{localTime(batch.created_at)}</time></dd></div>
          <div><dt>Queue starts</dt><dd><time dateTime={batch.starts_at ?? undefined}>{localTime(batch.starts_at)}</time></dd></div>
          <div><dt>Interval</dt><dd>{batch.interval_seconds} seconds</dd></div>
          <div><dt>Queued</dt><dd>{batchCounts?.pending_count ?? 0} pending</dd></div>
          <div><dt>Skipped</dt><dd>{batchCounts?.skipped_count ?? 0}</dd></div>
          <div><dt>Cancelled</dt><dd>{batchCounts?.cancelled_count ?? 0}</dd></div>
          <div><dt>Sent</dt><dd>{batchCounts?.sent_count ?? 0}</dd></div>
          <div><dt>Failed</dt><dd>{batchCounts?.failed_count ?? 0}</dd></div>
          <div><dt>Uncertain</dt><dd>{batchCounts?.uncertain_count ?? 0}</dd></div>
        </dl>
        <p className="history-honesty">Saved queue state only. These messages are not being sent in Phase 4.</p>
        {canControl && <div className="history-actions" aria-label={`Controls for ${batch.name}`}>
          {batch.status === "scheduled"
            ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void performAction(`/api/batches/${batch.id}/actions`, "pause", "Pause")}>Pause</button>
            : <button type="button" className="secondary-button" disabled={busy} onClick={() => void performAction(`/api/batches/${batch.id}/actions`, "resume", "Resume")}>Resume</button>}
          <button type="button" className="danger-button" disabled={busy} onClick={() => void performAction(`/api/batches/${batch.id}/actions`, "cancel", "Cancel")}>Cancel queue</button>
        </div>}
        <details className="history-messages">
          <summary>{batchCounts?.total_count ?? batchMessages.length} messages</summary>
          {batchMessages.length === 0 ? <p>No message records are available.</p> : <ol className="history-message-list">
            {batchMessages.map((message) => <li className="history-message" key={message.id}>
              <div className="history-message-heading">
                <strong>#{message.position} · {message.recipient}</strong>
                <span className="status-pill">{message.status}</span>
              </div>
              <p><strong>Subject:</strong> {message.subject}</p>
              <p><strong>Scheduled:</strong> {localTime(message.scheduled_at)}</p>
              <details><summary>View full message</summary><pre className="message-body">{message.body}</pre></details>
              {canControl && message.status === "pending" && <button type="button" className="text-button" disabled={busy}
                onClick={() => void performAction(`/api/batches/${batch.id}/messages/${message.id}/skip`, "skip", "Skip message")}>
                Skip queued message
              </button>}
            </li>)}
          </ol>}
        </details>
      </article>;
    })}
  </div>;
}
