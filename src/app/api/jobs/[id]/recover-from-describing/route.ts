import { NextRequest, NextResponse } from "next/server";
import { getJob, atomicUpdateJob } from "@/lib/job-store";

/**
 * Clear stuck "describing" state:
 * - If the job is in "describing", move it to "awaiting_validation".
 * - Any generatedImage with status "describing" is set to "pending" (user can Re-describe or edit).
 * - progress.described is recomputed.
 * Use when the pipeline was interrupted or some prompts never finished describing.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const hasJobDescribing = job.status === "describing";
    const stuckImages = job.generatedImages.filter((g) => g.status === "describing");
    if (!hasJobDescribing && stuckImages.length === 0) {
      return NextResponse.json(
        { error: "No describing state to recover" },
        { status: 400 }
      );
    }

    await atomicUpdateJob(jobId, (j) => {
      if (j.status === "describing") {
        j.status = "awaiting_validation";
        delete j.pipelineRequestId;
      }
      for (const g of j.generatedImages) {
        if (g.status === "describing") {
          g.status = "pending";
          g.error = undefined;
        }
      }
      j.progress.described = j.generatedImages.filter(
        (g) => g.prompt && g.status !== "describing"
      ).length;
    });

    return NextResponse.json({
      ok: true,
      status: "awaiting_validation",
      recoveredImages: stuckImages.length,
    });
  } catch (err) {
    console.error("Recover from describing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Recover failed" },
      { status: 500 }
    );
  }
}
