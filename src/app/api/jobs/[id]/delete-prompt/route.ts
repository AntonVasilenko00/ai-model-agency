import { NextRequest, NextResponse } from "next/server";
import { atomicUpdateJob } from "@/lib/job-store";
import fs from "fs/promises";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { label } = body ?? {};

    if (!label || typeof label !== "string") {
      return NextResponse.json(
        { error: "label is required" },
        { status: 400 }
      );
    }

    const job = await atomicUpdateJob(id, (j) => {
      const idx = j.generatedImages.findIndex((g) => g.label === label);
      if (idx === -1) return;

      const img = j.generatedImages[idx];

      if (img.status === "generating" || img.status === "describing") {
        throw new Error("Cannot delete a prompt that is currently being processed");
      }

      // Clean up generated file if it exists
      if (img.localPath) {
        fs.unlink(img.localPath).catch(() => {});
      }

      j.generatedImages.splice(idx, 1);

      j.progress.total = j.generatedImages.length;
      j.progress.described = j.generatedImages.filter(
        (g) => g.prompt && g.status !== "describing"
      ).length;
      j.progress.generated = j.generatedImages.filter(
        (g) => g.status === "completed"
      ).length;
    });

    return NextResponse.json({ ok: true, total: job.generatedImages.length });
  } catch (err) {
    console.error("Delete prompt error:", err);
    const message =
      err instanceof Error ? err.message : "Deleting prompt failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
