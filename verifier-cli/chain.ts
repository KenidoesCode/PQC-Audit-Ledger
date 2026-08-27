import type { AuditBundle } from "../src/verify/bundle";

/**
 * Chain verification over a bundle, with no database.
 *
 * The bundle carries receipts in ledger order. Each one names its predecessor's
 * payload hash, so a removal, an insertion or a reordering all show up here --
 * and none of them would be caught by checking signatures alone, because every
 * receipt in a reordered bundle is individually perfectly valid.
 *
 * That is the point of the chain and it is worth being explicit about: a
 * signature protects a receipt, and only the chain protects the SET of them.
 */
export interface OfflineChainReport {
  length: number;
  intact: boolean;
  breaks: { sequence: number; detail: string }[];
}

export function verifyChainOffline(bundle: AuditBundle): OfflineChainReport {
  const breaks: OfflineChainReport["breaks"] = [];
  let previousHash: string | null = null;
  let previousSequence: number | null = null;

  for (const receipt of bundle.receipts) {
    if (previousSequence !== null && receipt.sequence !== previousSequence + 1) {
      breaks.push({
        sequence: receipt.sequence,
        detail:
          "sequence jumps from " +
          previousSequence +
          " to " +
          receipt.sequence +
          ". " +
          (receipt.sequence > previousSequence + 1
            ? "Receipts are missing from this bundle."
            : "Receipts are out of order in this bundle."),
      });
    }

    const claimed = receipt.body.previousReceiptHash;
    if (claimed !== previousHash) {
      breaks.push({
        sequence: receipt.sequence,
        detail:
          "claims predecessor " +
          (claimed === null ? "(genesis)" : claimed.slice(0, 16) + "...") +
          " but the preceding receipt hashes to " +
          (previousHash === null ? "(nothing)" : previousHash.slice(0, 16) + "..."),
      });
    }

    previousHash = receipt.payloadHash;
    previousSequence = receipt.sequence;
  }

  return { length: bundle.receipts.length, intact: breaks.length === 0, breaks };
}
