import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("obter_saude_publica");
    if (error || !data?.[0]?.checked_at) throw error ?? new Error("Health check ainda não executado.");

    const snapshot = data[0];
    const stale = Date.now() - new Date(snapshot.checked_at).getTime() > 10 * 60 * 1000;
    const status = stale ? "down" : snapshot.status;
    return NextResponse.json(
      { status, checkedAt: snapshot.checked_at },
      { status: status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "down", checkedAt: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
