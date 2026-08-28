/**
 * Route-level loading state.
 *
 * Not decoration. On a cold instance the first request generates the corpus,
 * seals a Merkle batch and runs an evaluation before a page can render, which
 * is seconds; and every page here is force-dynamic, so a navigation waits on a
 * real query. Saying what is happening beats a blank frame.
 */
export default function Loading() {
  return (
    <section className="panel" aria-busy="true">
      <div className="panel-title">Rezzing</div>
      <div className="beam" />
      <p className="lede mt-4">
        Reading the ledger. On a cold instance the corpus is generated, anchored and evaluated before the
        first page renders — the alternative is a deployed audit ledger with no audit trail.
      </p>
    </section>
  );
}
