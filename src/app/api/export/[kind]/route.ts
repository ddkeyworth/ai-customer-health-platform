// Downloads one CSV file of the signed-in workspace's own data. The session is
// checked here because /api/* is outside the session proxy (see src/proxy.ts).
// Only the caller's own workspace is ever read.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { allowExport } from "@/lib/authLimits";
import { getCurrentSessionId } from "@/lib/demoVisitServer";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/lib/import/exportData";

export const maxDuration = 60;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(EXPORT_KINDS as string[]).includes(kind)) return NextResponse.json({ error: "Unknown export" }, { status: 404 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Each visit has its own allowance (so demo visitors do not share one), with a
  // much higher per-workspace backstop. See src/lib/authLimits.ts.
  if (!(await allowExport(await getCurrentSessionId(), user.workspaceId))) {
    return NextResponse.json({ error: "Too many downloads this hour. Try again shortly." }, { status: 429 });
  }

  const csv = await buildExport(user.workspaceId, kind as ExportKind);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bearing-${kind}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
