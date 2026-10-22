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
          <h1 id="page-title">A calmer way to follow up.</h1>
          <p className="welcome-copy">Prepare thoughtful emails, schedule them, and keep every conversation in view.</p>
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
          <div><p className="eyebrow">PROJECT STATUS</p><h2 id="setup-heading">The app shell is ready for the next phases</h2></div>
        </div>
        <p className="welcome-copy">This dashboard is a visual foundation. It does not yet have sign-in, data persistence, email import, Gmail connection, or sending.</p>
        <div className="setup-list" aria-label="Planned capabilities">
          <div className="setup-item"><span className="step-number" aria-hidden="true">1</span><div className="step-copy"><strong>Secure user accounts and data</strong><span>Supabase Auth, owner-scoped records, and access policies are planned for a later phase.</span></div><span className="step-status pending">PLANNED</span></div>
          <div className="setup-item"><span className="step-number" aria-hidden="true">2</span><div className="step-copy"><strong>Connect Gmail securely</strong><span>OAuth and encrypted per-user credentials are not available yet.</span></div><span className="step-status pending">PLANNED</span></div>
          <div className="setup-item"><span className="step-number" aria-hidden="true">3</span><div className="step-copy"><strong>Schedule through a persistent worker</strong><span>Scheduled sending will run in a separate cloud worker in a later phase.</span></div><span className="step-status pending">PLANNED</span></div>
        </div>
      </section>

      <footer className="page-footer"><span>Designed for thoughtful, one-to-one outreach.</span><span>Phase 1 · No email activity is enabled</span></footer>
    </>
  );
}
