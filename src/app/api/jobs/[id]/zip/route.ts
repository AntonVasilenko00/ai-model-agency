import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { Readable } from "stream";
import { getJob } from "@/lib/job-store";
import { getOutputFilePath, fileExists } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const completedImages = job.generatedImages.filter(
    (g) => g.status === "completed" && g.localPath
  );

  if (completedImages.length === 0) {
    return NextResponse.json(
      { error: "No completed images to download" },
      { status: 400 }
    );
  }

  const archive = archiver("zip", { zlib: { level: 5 } });
  const chunks: Buffer[] = [];

  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  const finishPromise = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  for (const img of completedImages) {
    const filePath = getOutputFilePath(id, img.label);
    if (await fileExists(filePath)) {
      archive.file(filePath, { name: `${img.label}.png` });
    }
  }

  await archive.finalize();
  await finishPromise;

  const buffer = Buffer.concat(chunks);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dataset_${id}.zip"`,
    },
  });
}
