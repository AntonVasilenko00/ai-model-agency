import { NextRequest, NextResponse } from "next/server";
import { getJob, atomicUpdateJob } from "@/lib/job-store";
import { saveSourceImage } from "@/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  return map[mime] || ".jpg";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const sourceFile = formData.get("source") as File | null;
  if (!sourceFile || !ALLOWED_TYPES.has(sourceFile.type)) {
    return NextResponse.json(
      { error: "Missing or invalid source image. Allowed: JPEG, PNG, WebP." },
      { status: 400 }
    );
  }

  const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());
  const sourceExt = extFromMime(sourceFile.type);
  const sourceImagePath = await saveSourceImage(id, sourceBuffer, sourceExt);

  await atomicUpdateJob(id, (j) => {
    j.sourceImagePath = sourceImagePath;
  });

  return NextResponse.json({ ok: true });
}
