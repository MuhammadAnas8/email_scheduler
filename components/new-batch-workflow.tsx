"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { emailRecordSchema } from "@/lib/schemas";
import { buildScheduleRequest, canConfirmSchedule, type ScheduleMode } from "@/lib/scheduling";
import { parseImport, type ImportRow } from "@/lib/imports";

function rowIssues(row: ImportRow) {
  const result = emailRecordSchema.safeParse(row.value);
  return result.success ? [] : result.error.issues.map((issue) => ({
    field: String(issue.path[0] ?? "record"), message: issue.message,
  }));
}

function currentLocalDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function NewBatchWorkflow() {
  const router = useRouter();
  const [name, setName] = useState("Outreach batch");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedBatchId, setSavedBatchId] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("immediate");
  const [localStartsAt, setLocalStartsAt] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [queueStatus, setQueueStatus] = useState<"scheduled" | "paused" | "cancelled" | null>(null);
  const scheduled = queueStatus !== null;
  const attachmentInput = useRef<HTMLInputElement>(null);

  async function importFile(file?: File) {
    setError("");
    setNotice("");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setRows([]);
      setError("Import file must be 2 MiB or smaller.");
      return;
    }
    const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : file.name.toLowerCase().endsWith(".json") ? "json" : null;
    if (!format) { setRows([]); setError("Choose a .csv or .json file."); return; }

    const content = await file.text();
    const clientResult = parseImport(format, content);
    if (!clientResult.ok) { setRows([]); setError(clientResult.error); return; }
    const response = await fetch("/api/import/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, content }),
    });
    const serverResult = await response.json() as { ok?: boolean; rows?: ImportRow[]; error?: string };
    if (!response.ok || !serverResult.ok || !serverResult.rows) {
      setRows([]); setError(serverResult.error ?? "Import could not be validated on the server."); return;
    }
    setRows(serverResult.rows);
  }

  function updateRow(index: number, field: keyof ImportRow["value"], value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index
      ? { ...row, value: { ...row.value, [field]: value } } : row));
  }

  async function saveDraft() {
    setError(""); setNotice("");
    const messages = rows.map((row) => emailRecordSchema.safeParse(row.value));
    if (messages.some((message) => !message.success)) {
      setError("Correct or remove every row with an error before saving this draft."); return;
    }
    setBusy(true);
    try {
      let batchId = savedBatchId;
      if (!batchId) {
        const response = await fetch("/api/batches", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, messages: messages.map((message) => message.success ? message.data : null) }),
        });
        const result = await response.json() as { id?: string; error?: string };
        if (!response.ok || !result.id) throw new Error(result.error ?? "Draft could not be saved.");
        batchId = result.id;
        setSavedBatchId(batchId);
      }

      if (attachment) {
        const form = new FormData(); form.set("file", attachment);
        const response = await fetch(`/api/batches/${batchId}/attachment`, { method: "POST", body: form });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "PDF upload failed. Retry the upload.");
        setAttachment(null);
        if (attachmentInput.current) attachmentInput.current.value = "";
      }
      setNotice("Draft and attachment saved. Choose when to schedule the queue below.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Draft could not be saved.");
    } finally { setBusy(false); }
  }

  async function confirmSchedule() {
    setError(""); setNotice("");
    const rowsValid = rows.length > 0 && rows.every((row) => rowIssues(row).length === 0);
    if (!canConfirmSchedule({ rowsValid, draftId: savedBatchId, attachmentPending: Boolean(attachment), busy })) {
      setError("Save a valid draft and finish any PDF upload before confirming its schedule.");
      return;
    }

    let scheduleRequest;
    try {
      scheduleRequest = buildScheduleRequest({ mode: scheduleMode, localStartsAt, intervalSeconds });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a valid schedule.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/batches/${savedBatchId}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleRequest),
      });
      const result = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error ?? "The queue schedule could not be saved.");
      if (result.status !== "scheduled" && result.status !== "paused" && result.status !== "cancelled") {
        throw new Error("The queue was saved, but its current status could not be confirmed. Refresh history to check it.");
      }
      setQueueStatus(result.status);
      setNotice(`Queue status: ${result.status}. Sending is not available until the worker phase.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The queue schedule could not be saved.");
    } finally { setBusy(false); }
  }

  const validCount = rows.filter((row) => rowIssues(row).length === 0).length;
  const errorCount = rows.length - validCount;
  const canConfirm = canConfirmSchedule({
    rowsValid: rows.length > 0 && errorCount === 0,
    draftId: savedBatchId,
    attachmentPending: Boolean(attachment),
    busy: busy || scheduled,
  });

  return <div className="new-batch-flow">
    <section className="workflow-card" aria-labelledby="import-heading">
      <p className="eyebrow">STEP 1 · IMPORT</p><h2 id="import-heading">Bring in your messages</h2>
      <p className="welcome-copy">CSV needs recipient, subject, and body headers. JSON must be an array with the same fields. Up to 200 messages per batch.</p>
      <label className="field-label">Import CSV or JSON
        <input type="file" accept=".csv,.json,text/csv,application/json" disabled={Boolean(savedBatchId)} onChange={(event) => void importFile(event.target.files?.[0])} />
      </label>
    </section>

    {rows.length > 0 && <section className="workflow-card" aria-labelledby="preview-heading">
      <div className="panel-heading"><div><p className="eyebrow">STEP 2 · REVIEW</p><h2 id="preview-heading">Edit every message before saving</h2></div>
        <span className="row-summary">{validCount} valid · {errorCount} with errors</span></div>
      <label className="field-label batch-name">Draft name
        <input value={name} maxLength={120} disabled={Boolean(savedBatchId)} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="message-list">
        {rows.map((row, index) => {
          const issues = rowIssues(row);
          return <article className="message-editor" key={`${row.rowNumber}-${index}`}>
            <header className="message-editor-heading"><strong>Record {row.rowNumber}</strong>
              {!savedBatchId && <button className="text-button" type="button" aria-label={`Remove record ${row.rowNumber}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}</header>
            <label className="field-label">Recipient
              <input type="email" value={row.value.recipient} disabled={Boolean(savedBatchId)} onChange={(event) => updateRow(index, "recipient", event.target.value)} aria-invalid={issues.some((issue) => issue.field === "recipient")} />
            </label>
            <label className="field-label">Subject
              <input value={row.value.subject} disabled={Boolean(savedBatchId)} onChange={(event) => updateRow(index, "subject", event.target.value)} aria-invalid={issues.some((issue) => issue.field === "subject")} />
            </label>
            <label className="field-label">Plain-text message
              <textarea rows={5} value={row.value.body} disabled={Boolean(savedBatchId)} onChange={(event) => updateRow(index, "body", event.target.value)} aria-invalid={issues.some((issue) => issue.field === "body")} />
            </label>
            {issues.length > 0 && <ul className="row-errors" aria-label={`Validation errors for record ${row.rowNumber}`}>
              {issues.map((issue, issueIndex) => <li key={`${issue.field}-${issueIndex}`}><strong>{issue.field}:</strong> {issue.message}</li>)}
            </ul>}
          </article>;
        })}
      </div>
    </section>}

    <section className="workflow-card" aria-labelledby="attachment-heading">
      <p className="eyebrow">STEP 3 · SHARED ATTACHMENT</p><h2 id="attachment-heading">Attach one CV PDF (optional)</h2>
      <p className="welcome-copy">The PDF is private and available only to you. The server checks its size and PDF signature.</p>
      <label className="field-label">CV attachment
        <input ref={attachmentInput} type="file" accept=".pdf,application/pdf" disabled={scheduled} onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
      </label>
      {attachment && <p className="file-note">Selected: {attachment.name} ({(attachment.size / 1024).toFixed(0)} KiB)</p>}
      {rows.length > 0 && <div className="preview-footer">
        <span>{savedBatchId ? "Draft is saved. Upload any selected PDF before scheduling." : "The draft and optional PDF are saved before scheduling."}</span>
        <button className="primary-button" type="button" disabled={busy || scheduled || errorCount > 0 || rows.length === 0 || (Boolean(savedBatchId) && !attachment)} onClick={() => void saveDraft()}>
          {busy ? "Saving…" : savedBatchId ? "Upload PDF to draft" : "Save draft and PDF"}
        </button>
      </div>}
    </section>

    {savedBatchId && <section className="workflow-card" aria-labelledby="schedule-heading">
      <p className="eyebrow">STEP 4 · CONFIRM QUEUE</p><h2 id="schedule-heading">Choose when this batch is scheduled</h2>
      <p className="welcome-copy">The schedule is saved in UTC. No messages will send until a later phase adds the persistent worker.</p>
      <fieldset className="schedule-options" disabled={busy || scheduled || Boolean(attachment)}>
        <legend className="field-label">Start time</legend>
        <label className="radio-choice"><input type="radio" name="schedule-mode" value="immediate" checked={scheduleMode === "immediate"} onChange={() => setScheduleMode("immediate")} /> Start immediately</label>
        <label className="radio-choice"><input type="radio" name="schedule-mode" value="future" checked={scheduleMode === "future"} onChange={() => { setScheduleMode("future"); if (!localStartsAt) setLocalStartsAt(currentLocalDateTime()); }} /> Start at a future date and time</label>
        {scheduleMode === "future" && <label className="field-label">Local start date and time
          <input type="datetime-local" value={localStartsAt} min={currentLocalDateTime()} onChange={(event) => setLocalStartsAt(event.target.value)} />
        </label>}
        <label className="field-label">Interval between queued messages
          <select value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))}>
            {[5, 6, 7, 8, 9, 10].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select>
        </label>
      </fieldset>
      <div className="preview-footer">
        <span>{queueStatus ? `Queue status: ${queueStatus}.` : "Confirming saves queue state only; it does not deliver email."}</span>
        <button className="primary-button" type="button" disabled={!canConfirm} onClick={() => void confirmSchedule()}>
          {busy ? "Scheduling…" : queueStatus ? `Queue ${queueStatus}` : "Confirm schedule"}
        </button>
      </div>
    </section>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}

  </div>;
}
