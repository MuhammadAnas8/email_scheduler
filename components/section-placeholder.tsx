export function SectionPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="placeholder-panel" aria-labelledby="page-title">
      <p className="eyebrow">COMING IN A LATER PHASE</p>
      <h1 id="page-title">{title}</h1>
      <p className="placeholder-copy">{description}</p>
      <p className="phase-note">This destination is informational in the current app shell. No changes or email activity can be started here yet.</p>
    </section>
  );
}
