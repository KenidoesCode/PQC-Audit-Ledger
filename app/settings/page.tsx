import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { environmentStatus } from "@/shared/env";
import { listPublicKeys } from "@/crypto/keys";
import { DEFAULT_RULES, POLICY_VERSION, rulesHash } from "@/policy/engine";
import { PAYMENT_LABEL } from "@/payment/simulator";
import { Dim, Plate, Tag, inr } from "@/ui/plate";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureBootstrapped();
  const db = await getDb();
  const env = environmentStatus();
  const keys = await listPublicKeys(db);

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <p className="label">Settings</p>
        <h1 className="h-part mt-1">What this deployment is, exactly</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Plate title="Environment">
          <div className="space-y-1.5">
            <Dim ruled label="Mode" value={env.nodeEnv} />
            <Dim ruled label="Payment mode" value={env.paymentMode} />
            <Dim ruled label="Live money reachable" value={env.liveMoneyPossible ? "YES" : "no"} />
            <Dim ruled label="Database driver" value={env.database.driver} />
            <Dim ruled label="Database target" value={env.database.target} />
            <Dim ruled label="Razorpay key id present" value={env.razorpay.keyIdPresent ? "yes" : "no"} />
            <Dim ruled label="Razorpay secret present" value={env.razorpay.keySecretPresent ? "yes" : "no"} />
            <Dim ruled label="Corpus seed" value={String(env.seed)} />
          </div>
          <div className="mt-4">
            <Tag kind="note">{PAYMENT_LABEL}</Tag>
          </div>
          <p className="mt-3 text-xs t-2">
            No code path in this repository calls a Razorpay endpoint. The adapter interface exists; the
            simulator is the only implementation of it. Secrets are reported as present or absent and are
            never shown.
          </p>
        </Plate>

        <div className="space-y-5">
          <Plate title="Signing keys">
            {keys.map((key) => (
              <div key={key.id} className="mb-4 space-y-1.5 last:mb-0">
                <Dim ruled label="Id" value={key.id} />
                <Dim ruled label="Algorithm" value={key.algorithm} />
                <Dim ruled label="State" value={key.state} />
                <Dim ruled label="Custody" value={key.custody} />
                <p className="mt-2 text-xs t-void">{key.label}</p>
              </div>
            ))}
            <p className="mt-3 text-xs t-2">
              Key generation is a deterministic function of a seed held in the environment. That is fine for a
              demonstration and catastrophic in production: whoever holds the seed holds the private key.
              Rotation would create a new key, mark it ACTIVE and retire the old one; historical receipts stay
              verifiable because each one names the key that signed it.
            </p>
          </Plate>

          <Plate title="Active policy">
            <div className="space-y-1.5">
              <Dim ruled label="Version" value={POLICY_VERSION} />
              <Dim ruled label="Rules hash" value={rulesHash(DEFAULT_RULES).slice(0, 24)} />
              <Dim ruled label="Human review threshold" value={inr(DEFAULT_RULES.humanReviewThresholdMinor)} />
              <Dim ruled label="Minimum intent confidence" value={DEFAULT_RULES.minimumIntentConfidence + "%"} />
            </div>
            <p className="mt-3 text-xs t-2">
              Both thresholds were tuned so the demonstration corpus produces a workable number of review
              cases. Neither is derived from loss data, and a real deployment would set them from its own.
            </p>
          </Plate>
        </div>
      </div>
    </div>
  );
}
