import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { proofForReceipt } from "@/audit/ledger";
import { jsonError } from "@/api/handler";
import { newCorrelationId } from "@/shared/ids";

export const dynamic = "force-dynamic";

/** GET /api/merkle/proof/:receiptId -- receipt id, leaf, proof, root, batch. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  try {
    await ensureBootstrapped();
    const db = await getDb();
    const { id } = await context.params;
    const anchored = await proofForReceipt(db, id);

    if (!anchored) {
      return NextResponse.json(
        {
          error: "MERKLE_PROOF_UNAVAILABLE",
          message:
            "Receipt " +
            id +
            " has not been anchored into a batch yet. It is signed and chained; it is simply not yet in a tree, and saying so is more useful than inventing a proof.",
          correlationId,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      receiptId: id,
      batchId: anchored.batchId,
      leaf: anchored.proof.leaf,
      proof: { siblings: anchored.proof.siblings, directions: anchored.proof.directions },
      root: anchored.root,
      treeSize: anchored.proof.treeSize,
      algorithm: anchored.proof.algorithm,
      correlationId,
    });
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
