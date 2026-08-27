import { asc, desc, eq } from "drizzle-orm";

import { intParam, route } from "@/api/handler";
import { auditReceipts } from "@/db/schema";

export const dynamic = "force-dynamic";

export const GET = route(async ({ db, url }) => {
  const eventType = url.searchParams.get("eventType");
  const order = url.searchParams.get("order") === "asc" ? asc : desc;
  const limit = intParam(url, "limit", 100, 500);

  const rows = await (eventType
    ? db.select().from(auditReceipts).where(eq(auditReceipts.eventType, eventType as never))
    : db.select().from(auditReceipts)
  )
    .orderBy(order(auditReceipts.sequence))
    .limit(limit);

  return {
    receipts: rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      eventType: r.eventType,
      payloadHash: r.payloadHash,
      previousReceiptHash: r.previousReceiptHash,
      signatureAlgorithm: r.signatureAlgorithm,
      signingKeyId: r.signingKeyId,
      occurredAt: r.occurredAt,
      body: r.body,
    })),
  };
});
