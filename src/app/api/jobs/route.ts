import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getJob, atomicUpdateJob } from "@/lib/job-store";
import { runPipeline } from "@/lib/pipeline";

export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "uploading") {
      return NextResponse.json(
        { error: `Job is already in status: ${job.status}` },
        { status: 400 }
      );
    }

    // Only one request may start the pipeline: atomically transition uploading -> describing
    // and record who claimed it so we don't run the pipeline twice (e.g. double-click or Strict Mode).
    const requestId = randomUUID();
    const updated = await atomicUpdateJob(jobId, (j) => {
      if (j.status === "uploading") {
        j.status = "describing";
        j.pipelineRequestId = requestId;
      }
    });

    const weStartedPipeline =
      updated.status === "describing" && updated.pipelineRequestId === requestId;
    if (weStartedPipeline) {
      runPipeline(jobId).catch((err) => {
        console.error(`Background pipeline error for ${jobId}:`, err);
      });
    }

    return NextResponse.json({ jobId, status: "started" });
  } catch (err) {
    console.error("Jobs POST error:", err);
    return NextResponse.json(
      { error: "Failed to start job" },
      { status: 500 }
    );
  }
}
