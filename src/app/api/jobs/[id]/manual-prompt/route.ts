import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob } from "@/lib/job-store";
import { makeLabel } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { prompt } = body ?? {};

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json(
        { error: "Cannot add prompts to a finished job" },
        { status: 400 }
      );
    }

    const existingManualCount = job.generatedImages.filter(
      (g) => g.category === "manual"
    ).length;
    const nextIndex = existingManualCount + 1;
    const label = makeLabel("manual", nextIndex);

    job.generatedImages.push({
      label,
      category: "manual",
      index: nextIndex,
      prompt,
      status: "pending",
    });
    job.progress.total = job.generatedImages.length;

    await updateJob(job);

    return NextResponse.json({ ok: true, label });
  } catch (err) {
    console.error("Manual prompt error:", err);
    const message = err instanceof Error ? err.message : "Adding manual prompt failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
