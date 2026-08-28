"use client";

/**
 * Route-level error state.
 *
 * It prints what actually failed rather than a shrug. The retry is React's own
 * reset() -- a real control, not a reload button dressed as one -- because the
 * common failure here is a bootstrap that timed out on a cold instance and
 * succeeds on the second attempt.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel">
      <div className="panel-title">Circuit broken</div>
      <h1 className="title">This page did not render.</h1>
      <p className="lede mt-3 max-w-2xl">
        The most likely cause is bootstrap: on a cold instance the ledger is generated, anchored and evaluated
        before any page can be served, and that work can exceed the request budget. Retrying usually finds it
        finished.
      </p>
      <pre className="term term-wrap mt-4">{error.message || "No message was attached to the error."}</pre>
      {error.digest && <p className="label mt-2">digest {error.digest}</p>}
      <div className="mt-5">
        <button type="button" onClick={reset} className="key key-lume">
          Try again
        </button>
      </div>
    </section>
  );
}
