import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getJob } from "@/lib/job-store";
import { getOutputFilePath, fileExists } from "@/lib/storage";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job");
  const label = searchParams.get("label");

  if (!jobId || !label) {
    return NextResponse.json(
      { error: "job and label query params are required" },
      { status: 400 }
    );
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const filePath = getOutputFilePath(jobId, label);
  if (!(await fileExists(filePath))) {
    return NextResponse.json(
      { error: "Image not found" },
      { status: 404 }
    );
  }

  const download = searchParams.get("dl") === "1";
  const buffer = await fs.readFile(filePath);

  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Cache-Control": "private, max-age=3600",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${label}.png"`;
  }

  return new NextResponse(buffer, { headers });
}
