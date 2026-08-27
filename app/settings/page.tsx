import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { environmentStatus } from "@/shared/env";
import { listPublicKeys } from "@/crypto/keys";
import { DEFAULT_RULES, POLICY_VERSION, rulesHash } from "@/policy/engine";
import { PAYMENT_LABEL } from "@/payment/simulator";
import { Plate, Stamp, inr } from "@/ui/plate";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureBootstrapped();
  const db = await getDb();
  const env = environmentStatus();
  const keys = await listPublicKeys(db);

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Settings</p>
        <h1 className="text-2xl">What this deployment is, exactly</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Plate title="Environment">
          <div className="space-y-1.5">
            <Row label="Mode" value={env.nodeEnv} />
            <Row label="Payment mode" value={env.paymentMode} />
            <Row label="Live money reachable" value={env.liveMoneyPossible ? "YES" : "no"} />
            <Row label="Database driver" value={env.database.driver} />
            <Row label="Database target" value={env.database.target} />
            <Row label="Razorpay key id present" value={env.razorpay.keyIdPresent ? "yes" : "no"} />
            <Row label="Razorpay secret present" value={env.razorpay.keySecretPresent ? "yes" : "no"} />
            <Row label="Corpus seed" value={String(env.seed)} />
          </div>
          <div className="mt-4">
            <Stamp kind="note">{PAYMENT_LABEL}</Stamp>
          </div>
          <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
            No code path in this repository calls a Razorpay endpoint. The adapter interface exists; the
            simulator is the only implementation of it. Secrets are reported as present or absent and are never
            shown.
          </p>
        </Plate>

        <div className="space-y-5">
          <Plate title="Signing keys">
            {keys.map((key) => (
              <div key={key.id} className="mb-4 space-y-1.5 last:mb-0">
                <Row label="Id" value={key.id} />
                <Row label="Algorithm" value={key.algorithm} />
                <Row label="State" value={key.state} />
                <Row label="Custody" value={key.custody} />
                <p className="mt-2 text-xs text-[var(--color-vermilion)]">{key.label}</p>
              </div>
            ))}
            <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
              Key generation is a deterministic function of a seed held in the environment. That is fine for a
              demonstration and catastrophic in production: whoever holds the seed holds the private key.
              Rotation would create a new key, mark it ACTIVE and retire the old one; historical receipts stay
              verifiable because each one names the key that signed it.
            </p>
          </Plate>

          <Plate title="Active policy">
            <div className="space-y-1.5">
              <Row label="Version" value={POLICY_VERSION} />
              <Row label="Rules hash" value={rulesHash(DEFAULT_RULES).slice(0, 24)} />
              <Row label="Human review threshold" value={inr(DEFAULT_RULES.humanReviewThresholdMinor)} />
              <Row label="Minimum intent confidence" value={DEFAULT_RULES.minimumIntentConfidence + "%"} />
            </div>
            <p className="mt-3 text-xs text-[var(--color-intaglio-soft)]">
              Both thresholds were tuned so the demonstration corpus produces a workable number of review cases.
              Neither is derived from loss data, and a real deployment would set them from its own.
            </p>
          </Plate>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color-mix(in_oklab,var(--color-intaglio)_12%,transparent)] pb-1">
      <span className="label">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
