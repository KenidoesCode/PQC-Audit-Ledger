import Link from "next/link";

import { SUITE } from "@/crypto/mldsa";
import { GridIntro } from "@/ui/grid-intro";

/**
 * The landing.
 *
 * Four scenes over four screens of scroll, against the Grid and the Merkle
 * lattice on the canvas behind them. The scenes are server-rendered prose and
 * real links -- the client component contributes the canvas and one class flip
 * per scene, and nothing here is decorative markup standing in for a control.
 *
 * The fourth scene is where the honest reading lives, in front of the console
 * rather than buried three pages into it: the signing key is a development
 * key, no live money is reachable, and the headline detection rate is a
 * regression test rather than an achievement.
 */
export default function Home() {
  return (
    <GridIntro>
      <header className="intro-head">
        <span className="rail-mark">PQC Audit Ledger</span>
        <div className="flex items-center gap-3">
          <span className="tag tag-void">Simulated — no live money</span>
          <Link href="/overview" className="key">
            Enter the Grid
          </Link>
        </div>
      </header>

      <section className="scene">
        <div className="scene-body">
          <p className="scene-kicker">
            {SUITE.algorithm} · {SUITE.standard} · SHA-256 Merkle
          </p>
          <h1 className="scene-title mt-4">
            Every action an agent takes
            <br />
            leaves a record you can check
            <br />
            without trusting us.
          </h1>
          <p className="scene-lede mt-6">
            An AI agent is given a spend authority. It reads an instruction and proposes a payment. A
            deterministic layer it cannot reach decides whether that payment happens — and every step of that,
            including every refusal, produces a receipt signed with a post-quantum signature.
          </p>
        </div>
        <p className="cue label">scroll</p>
      </section>

      <section className="scene scene-right">
        <div className="scene-body">
          <p className="scene-kicker">The chain</p>
          <h2 className="scene-title mt-4">Each receipt names the one before it.</h2>
          <p className="scene-lede mt-6">
            A signature protects one receipt. Nothing in a signature protects the <em>order</em>, or notices
            that a receipt was quietly removed. So each one carries the payload hash of its predecessor:
            delete a row and every row below it stops linking, and the break names itself.
          </p>
        </div>
      </section>

      <section className="scene">
        <div className="scene-body">
          <p className="scene-kicker">The root</p>
          <h2 className="scene-title mt-4">The traces fold, and the root seals.</h2>
          <p className="scene-lede mt-6">
            Leaves fold in pairs — SHA-256 over the payload hash the signature already covers, with RFC 6962
            domain separation, and an odd node promoted rather than hashed against a copy of itself. The root
            is one statement about the whole batch.
          </p>
          <p className="scene-lede mt-4">
            It is a <em>different</em> statement from the signature, made later, and this system never
            conflates the two: a signature says who wrote these bytes, a root says they were in the ledger
            when the batch was sealed.
          </p>
        </div>
      </section>

      <section className="scene scene-right">
        <div className="scene-body">
          <p className="scene-kicker">The last mile</p>
          <h2 className="scene-title mt-4">Take the evidence with you.</h2>
          <p className="scene-lede mt-6">
            The bundle is every receipt, signature and root as one file. The verifier is one file with no
            dependencies and no network calls that reads it and decides. Neither asks this website anything,
            which is the only reason a stranger has to believe either of them.
          </p>

          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <a href="/api/bundle" className="key key-lume">
              Download audit bundle
            </a>
            <a href="/ledger-verify.mjs" download className="key key-lume">
              Download offline verifier
            </a>
            <Link href="/overview" className="key">
              Enter the Grid →
            </Link>
          </div>

          {/* The unflattering reading, on the front door rather than in a
              footnote three pages in. */}
          <div className="panel mt-9 text-left">
            <div className="panel-title">What this does not claim</div>
            <ul className="space-y-2 text-sm t-2">
              <li>
                <span className="t-void">The signing key is a development key.</span> It is derived from a seed
                in the environment, so whoever holds that seed can forge any receipt this deployment ever
                issued. Every receipt it signs is cryptographically valid and organizationally worthless.
              </li>
              <li>
                <span className="t-void">No live money is reachable.</span> Not &ldquo;not intended&rdquo; — no
                code path here calls a payment endpoint. The simulator is the only implementation.
              </li>
              <li>
                <span className="t-void">A 1.000 tamper-detection rate is not an achievement.</span> Any change
                to the canonical bytes changes their SHA-256 and the verifier recomputes that hash before it
                looks at the signature. Read it as a regression test on the canonicalizer.
              </li>
              <li>
                A valid signature proves the bytes are authentic and unmodified. It proves nothing about
                whether the merchant was legitimate, the policy sensible, or the payment a good idea. A signed
                receipt of a bad decision is a reliable record of a bad decision.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </GridIntro>
  );
}
