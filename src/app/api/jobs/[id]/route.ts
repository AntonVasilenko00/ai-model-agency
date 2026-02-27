import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    hasSource: !!job.sourceImagePath,
    images: job.generatedImages.map((g) => ({
      label: g.label,
      category: g.category,
      index: g.index,
      status: g.status,
      prompt: g.prompt || undefined,
      error: g.error || undefined,
      hasLocal: !!g.localPath,
    })),
  });
}
