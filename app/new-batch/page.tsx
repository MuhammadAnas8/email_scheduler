import { NewBatchWorkflow } from "@/components/new-batch-workflow";

export default function NewBatchPage() {
  return <>
    <div className="welcome-row"><div><p className="eyebrow">NEW QUEUE</p><h1>Prepare a batch</h1>
      <p className="welcome-copy">Import, correct, and review your messages, save the draft, then explicitly confirm when its queue starts. Email sending is not available in Phase 4.</p></div></div>
    <NewBatchWorkflow />
  </>;
}
