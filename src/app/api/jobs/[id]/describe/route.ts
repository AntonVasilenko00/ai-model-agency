import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { redescribeImage } from "@/lib/pipeline";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const label = body?.label;
    if (!label || typeof label !== "string") {
      return NextResponse.json(
        { error: "label is required" },
        { status: 400 }
      );
    }

    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await redescribeImage(id, label);
    return NextResponse.json({ ok: true, label });
  } catch (err) {
    console.error("Describe image error:", err);
    const message = err instanceof Error ? err.message : "Describe failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
