import { NewBatchWorkflow } from "@/components/new-batch-workflow";

export default function NewBatchPage() {
  return <>
    <div className="welcome-row"><div><p className="eyebrow">NEW DRAFT</p><h1>Prepare a batch</h1>
      <p className="welcome-copy">Import, correct, and review your messages. Saving stores a draft; scheduling and sending come in later phases.</p></div></div>
    <NewBatchWorkflow />
  </>;
}
