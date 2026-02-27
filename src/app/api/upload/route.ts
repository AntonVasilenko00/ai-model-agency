import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  Job,
  DatasetImage,
  GeneratedImage,
  MAX_DATASET_IMAGES,
  makeLabel,
} from "@/lib/types";
import { saveSourceImage, saveDatasetImage } from "@/lib/storage";
import { setJob } from "@/lib/job-store";

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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const jobId = uuidv4();

    const sourceFile = formData.get("source") as File | null;
    const hasSource = sourceFile && ALLOWED_TYPES.has(sourceFile.type);
    if (sourceFile && !ALLOWED_TYPES.has(sourceFile.type)) {
      return NextResponse.json(
        { error: "Invalid source image. Allowed: JPEG, PNG, WebP." },
        { status: 400 }
      );
    }

    const datasetImages: DatasetImage[] = [];
    const errors: string[] = [];

    for (let i = 1; i <= MAX_DATASET_IMAGES; i++) {
      const fieldName = `dataset_${i}`;
      const file = formData.get(fieldName) as File | null;
      if (!file) continue;
      if (!ALLOWED_TYPES.has(file.type)) {
        errors.push(`Invalid file type for ${fieldName}: ${file.type}`);
        continue;
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Upload validation failed", details: errors },
        { status: 400 }
      );
    }

    const manualPrompts: string[] = [];
    for (let i = 1; i <= 100; i++) {
      const prompt = formData.get(`manual_prompt_${i}`) as string | null;
      if (!prompt) break;
      manualPrompts.push(prompt);
    }

    let sourceImagePath: string | null = null;
    if (hasSource && sourceFile) {
      const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());
      const sourceExt = extFromMime(sourceFile.type);
      sourceImagePath = await saveSourceImage(jobId, sourceBuffer, sourceExt);
    }

    for (let i = 1; i <= MAX_DATASET_IMAGES; i++) {
      const fieldName = `dataset_${i}`;
      const file = formData.get(fieldName) as File | null;
      if (!file) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = extFromMime(file.type);
      const uploadPath = await saveDatasetImage(
        jobId,
        "dataset",
        i,
        buffer,
        ext
      );
      datasetImages.push({
        category: "dataset",
        index: i,
        label: makeLabel("dataset", i),
        uploadPath,
      });
    }

    if (datasetImages.length === 0 && manualPrompts.length === 0) {
      return NextResponse.json(
        { error: "At least 1 prompt or dataset image is required." },
        { status: 400 }
      );
    }

    const generatedImages: GeneratedImage[] = [
      ...datasetImages.map((d) => ({
        label: d.label,
        category: d.category,
        index: d.index,
        prompt: "",
        status: "pending" as const,
      })),
      ...manualPrompts.map((prompt, idx) => ({
        label: makeLabel("manual", idx + 1),
        category: "manual" as const,
        index: idx + 1,
        prompt,
        status: "pending" as const,
      })),
    ];

    const job: Job = {
      id: jobId,
      status: "uploading",
      sourceImagePath,
      datasetImages,
      generatedImages,
      progress: { described: 0, generated: 0, total: generatedImages.length },
      createdAt: new Date().toISOString(),
    };

    await setJob(job);

    return NextResponse.json({
      jobId,
      imageCount: datasetImages.length,
      promptCount: manualPrompts.length,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
