import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { runGenerationForAllImages } from "@/lib/pipeline";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.sourceImagePath) {
    return NextResponse.json(
      { error: "Source image is required. Upload a source photo first." },
      { status: 400 }
    );
  }

  const actionable = job.generatedImages.filter(
    (g) => (g.status === "pending" || g.status === "failed") && g.prompt
  );
  if (actionable.length === 0) {
    return NextResponse.json(
      { error: "No images to generate" },
      { status: 400 }
    );
  }

  runGenerationForAllImages(id).catch((err) => {
    console.error(`Generate-all failed for job ${id}:`, err);
  });

  return NextResponse.json({ ok: true, count: actionable.length });
}
