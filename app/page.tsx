import { Suspense } from "react";
import { getSchedulerCounts } from "@/lib/data/scheduler";
import type { EmailBatchCounts } from "@/lib/types";

function OverviewFallback() {
  return <>
    <section className="welcome-row" aria-labelledby="page-title"><div>
      <p className="eyebrow">YOUR OUTREACH, AT A GLANCE</p>
      <h1 id="page-title">Prepare thoughtful outreach.</h1>
      <p className="welcome-copy">Review and schedule durable queue state. Messages are not sent until a later phase adds the persistent worker and Gmail integration.</p>
    </div></section>
    <p className="welcome-copy" role="status">Loading your queue totals…</p>
  </>;
}

async function OverviewData() {
  let counts: EmailBatchCounts[] | null = null;
  let loadFailed = false;
  try {
    counts = await getSchedulerCounts();
  } catch {
    loadFailed = true;
  }

  const totals = counts?.reduce((total, row) => ({
    queued: total.queued + row.pending_count,
    sent: total.sent + row.sent_count,
    failed: total.failed + row.failed_count,
    skipped: total.skipped + row.skipped_count,
    uncertain: total.uncertain + row.uncertain_count,
  }), { queued: 0, sent: 0, failed: 0, skipped: 0, uncertain: 0 });
  const overviewCards = [
    { label: "Queued", key: "queued" as const, note: "Pending records; not being delivered" },
    { label: "Sent", key: "sent" as const, note: "Sending is not available in Phase 4" },
    { label: "Failed", key: "failed" as const, note: "Persisted message status" },
    { label: "Skipped", key: "skipped" as const, note: "Skipped by you" },
    { label: "Uncertain", key: "uncertain" as const, note: "Requires a later resolution flow" },
  ];

  return <>
    <section className="welcome-row" aria-labelledby="page-title">
      <div>
        <p className="eyebrow">YOUR OUTREACH, AT A GLANCE</p>
        <h1 id="page-title">Prepare thoughtful outreach.</h1>
        <p className="welcome-copy">Review and schedule durable queue state. Messages are not sent until a later phase adds the persistent worker and Gmail integration.</p>
      </div>
    </section>

    {loadFailed && <p className="form-error" role="alert">Queue totals could not be loaded. Refresh to try again.</p>}
    <section className="stat-grid overview-grid" aria-label="Persisted message status totals">
      {overviewCards.map((item) => (
        <article className="stat-card" key={item.label}>
          <span className="stat-top">{item.label}</span>
          <strong className="stat-value" aria-label={`${item.label}: ${loadFailed ? "unavailable" : totals?.[item.key] ?? 0}`}>
            {loadFailed ? "—" : totals?.[item.key] ?? 0}
          </strong>
          <span className="stat-note">{item.note}</span>
        </article>
      ))}
    </section>

    <section className="setup-panel" aria-labelledby="setup-heading">
      <div className="panel-heading">
        <div><p className="eyebrow">QUEUE STATUS</p><h2 id="setup-heading">Queue state is saved; delivery is not enabled</h2></div>
      </div>
      <p className="welcome-copy">Pause, resume, cancel, and skip actions persist in the database. No email is sent or claimed by this application in Phase 4.</p>
    </section>

    <footer className="page-footer"><span>Designed for thoughtful, one-to-one outreach.</span><span>Phase 4 · Queue state only</span></footer>
  </>;
}

export default function Home() {
  return <Suspense fallback={<OverviewFallback />}><OverviewData /></Suspense>;
}
