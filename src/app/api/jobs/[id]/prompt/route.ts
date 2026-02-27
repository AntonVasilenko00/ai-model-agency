import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/job-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { label, prompt } = body ?? {};

    if (!label || typeof label !== "string") {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    if (typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const gen = job.generatedImages.find((g) => g.label === label);
    if (!gen) {
      return NextResponse.json({ error: `Image ${label} not found` }, { status: 404 });
    }

    if (gen.status === "generating") {
      return NextResponse.json({ error: "Cannot edit prompt while generating" }, { status: 400 });
    }

    gen.prompt = prompt;
    if (gen.status === "describing") {
      gen.status = "pending";
    }
    await updateJob(job);

    return NextResponse.json({ ok: true, label });
  } catch (err) {
    console.error("Edit prompt error:", err);
    const message = err instanceof Error ? err.message : "Edit prompt failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
