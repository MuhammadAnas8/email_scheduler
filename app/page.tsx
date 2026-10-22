const overview = [
  { label: "Queued", value: "—", note: "Queue data is not connected" },
  { label: "Sent", value: "—", note: "Sending is not enabled" },
  { label: "Needs attention", value: "—", note: "No message history yet" },
];

export default function Home() {
  return (
    <>
      <section className="welcome-row" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">YOUR OUTREACH, AT A GLANCE</p>
          <h1 id="page-title">Prepare thoughtful outreach.</h1>
          <p className="welcome-copy">Import, review, and save message drafts. Scheduling and sending will be added in later phases.</p>
        </div>
      </section>

      <section className="stat-grid" aria-label="Email activity overview">
        {overview.map((item) => (
          <article className="stat-card" key={item.label}>
            <span className="stat-top">{item.label}</span>
            <strong className="stat-value" aria-label={`${item.label}: unavailable`}>{item.value}</strong>
            <span className="stat-note">{item.note}</span>
          </article>
        ))}
      </section>

      <section className="setup-panel" aria-labelledby="setup-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">PROJECT STATUS</p><h2 id="setup-heading">Private draft preparation is ready</h2></div>
        </div>
        <p className="welcome-copy">Sign in to import, edit, and save owner-scoped drafts with an optional private CV attachment. No message is scheduled or sent.</p>
        <div className="setup-list" aria-label="Project capabilities">
          <div className="setup-item"><span className="step-number" aria-hidden="true">1</span><div className="step-copy"><strong>Import and review drafts</strong><span>CSV/JSON validation, editable message previews, and private PDF storage are available.</span></div><span className="step-status">READY</span></div>
          <div className="setup-item"><span className="step-number" aria-hidden="true">2</span><div className="step-copy"><strong>Connect Gmail securely</strong><span>OAuth and encrypted per-user credentials are not available yet.</span></div><span className="step-status pending">PLANNED</span></div>
          <div className="setup-item"><span className="step-number" aria-hidden="true">3</span><div className="step-copy"><strong>Schedule through a persistent worker</strong><span>Scheduled sending will run in a separate cloud worker in a later phase.</span></div><span className="step-status pending">PLANNED</span></div>
        </div>
      </section>

      <footer className="page-footer"><span>Designed for thoughtful, one-to-one outreach.</span><span>Phase 3 · Draft preparation only</span></footer>
    </>
  );
}
