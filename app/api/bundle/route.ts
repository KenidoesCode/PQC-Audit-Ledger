import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { buildBundle } from "@/verify/bundle";
import { jsonError } from "@/api/handler";
import { newCorrelationId } from "@/shared/ids";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Downloads the audit bundle.
 *
 * Served as an attachment rather than as an API response, because the point of
 * this endpoint is that the file leaves here and is checked somewhere else with
 * `ledger-verify.mjs`. An auditor who has to write a curl pipeline first is an
 * auditor who checks nothing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  try {
    await ensureBootstrapped();
    const db = await getDb();
    const limit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "300", 10);
    const bundle = await buildBundle(db, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 300);

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="audit-bundle.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
