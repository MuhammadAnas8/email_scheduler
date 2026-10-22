const overview = [
  { label: "Queued", value: "—", note: "Available after setup", tone: "mint" },
  { label: "Sent", value: "—", note: "Your history will appear here", tone: "blue" },
  { label: "Needs attention", value: "—", note: "Failures and uncertain sends", tone: "peach" },
];

function Mark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M5 9.5 16 18l11-8.5M7 7h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="m5.5 23 8-7M26.5 23l-8-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Icon({ name }: { name: "overview" | "batches" | "history" | "settings" }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    batches: <><path d="M4 6h16M4 12h16M4 18h10" /><path d="M19 16v6m-3-3h6" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.9Z" transform="translate(-1 -1)" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#overview" aria-label="Correspond home">
          <Mark />
          <span className="brand-name">correspond<span>.</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list">
          <a className="nav-item active" href="#overview" aria-current="page"><Icon name="overview" />Overview</a>
          <a className="nav-item muted" href="#setup"><Icon name="batches" />Batches</a>
          <a className="nav-item muted" href="#setup"><Icon name="history" />History</a>
        </nav>

        <div className="sidebar-bottom">
          <a className="nav-item muted" href="#setup"><Icon name="settings" />Settings</a>
          <div className="owner-card">
            <div className="owner-avatar" aria-hidden="true">Y</div>
            <div className="owner-copy"><strong>Your workspace</strong><span>Personal account</span></div>
            <span className="owner-dot" aria-label="Setup in progress" />
          </div>
        </div>
      </aside>

      <section className="main-column" id="overview">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="topbar-right"><span className="setup-pill"><i />Setup in progress</span><button className="avatar-small" aria-label="Workspace profile">Y</button></div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div><p className="eyebrow">YOUR OUTREACH, AT A GLANCE</p><h1>A calmer way to follow up.</h1><p className="welcome-copy">Prepare thoughtful emails, schedule them, and keep every conversation in view.</p></div>
            <button className="primary-button" disabled title="Batch creation will be available in a later setup phase"><span aria-hidden="true">＋</span> New batch <span className="button-soon">Soon</span></button>
          </section>

          <section className="stat-grid" aria-label="Email activity overview">
            {overview.map((item) => <article className="stat-card" key={item.label}>
              <div className="stat-top"><span>{item.label}</span><span className={`stat-icon ${item.tone}`} aria-hidden="true">{item.label === "Queued" ? "↗" : item.label === "Sent" ? "✓" : "!"}</span></div>
              <strong className="stat-value">{item.value}</strong><span className="stat-note">{item.note}</span>
            </article>)}
          </section>

          <section className="setup-panel" id="setup">
            <div className="panel-heading"><div><p className="eyebrow">GETTING STARTED</p><h2>Make this space yours</h2></div><span className="progress-label">0 of 3 complete</span></div>
            <div className="progress-track" role="progressbar" aria-label="Setup progress" aria-valuenow={0} aria-valuemin={0} aria-valuemax={3}><span /></div>
            <div className="setup-list">
              <div className="setup-item"><span className="step-number">1</span><div className="step-copy"><strong>Connect your data store</strong><span>Set up Supabase to save batches and message history.</span></div><span className="step-status">NEXT STEP</span></div>
              <div className="setup-item"><span className="step-number">2</span><div className="step-copy"><strong>Connect your Gmail account</strong><span>Authorize the account you want to send from.</span></div><span className="step-status pending">UP NEXT</span></div>
              <div className="setup-item"><span className="step-number">3</span><div className="step-copy"><strong>Prepare your first batch</strong><span>Import, review, and schedule personalized messages.</span></div><span className="step-status pending">UP NEXT</span></div>
            </div>
            <p className="phase-note"><span aria-hidden="true">✳</span> This project is at the app shell stage. Sending and account connections are not enabled yet.</p>
          </section>

          <footer className="page-footer"><span>Built for thoughtful, one-to-one outreach.</span><span>Private by design <b>·</b> Single workspace</span></footer>
        </div>
      </section>
    </main>
  );
}
