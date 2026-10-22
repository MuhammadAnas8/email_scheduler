import { Suspense } from "react";
import { BatchHistory } from "@/components/batch-history";
import { getSchedulerOverview } from "@/lib/data/scheduler";

function HistoryFallback() {
  return <>
    <div className="welcome-row"><div><p className="eyebrow">YOUR QUEUE HISTORY</p><h1>Saved batches</h1></div></div>
    <p className="welcome-copy" role="status">Loading your saved batches…</p>
  </>;
}

async function HistoryData() {
  let overview: Awaited<ReturnType<typeof getSchedulerOverview>> | null = null;
  try {
    overview = await getSchedulerOverview();
  } catch {
    return <>
      <div className="welcome-row"><div><p className="eyebrow">YOUR QUEUE HISTORY</p><h1>Saved batches</h1></div></div>
      <p className="form-error" role="alert">Queue history could not be loaded. Refresh to try again.</p>
    </>;
  }

  return <>
    <div className="welcome-row"><div>
      <p className="eyebrow">YOUR QUEUE HISTORY</p>
      <h1>Saved batches</h1>
      <p className="welcome-copy">Review persisted batch and message status. Queue actions are saved, but Phase 4 does not send email.</p>
    </div></div>
    <BatchHistory batches={overview.batches} messages={overview.messages} counts={overview.counts} />
  </>;
}

export default function HistoryPage() {
  return <Suspense fallback={<HistoryFallback />}><HistoryData /></Suspense>;
}
