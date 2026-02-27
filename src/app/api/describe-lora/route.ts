import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { describeImageForLora } from "@/lib/openai";

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File | null;
    const triggerWord = (formData.get("triggerWord") as string | null)?.trim();

    if (!image || !(image instanceof File)) {
      return NextResponse.json({ error: "image file is required" }, { status: 400 });
    }
    if (!triggerWord) {
      return NextResponse.json({ error: "triggerWord is required" }, { status: 400 });
    }

    const ext = path.extname(image.name) || ".png";
    tempPath = path.join(os.tmpdir(), `lora_${Date.now()}${ext}`);
    const buffer = Buffer.from(await image.arrayBuffer());
    await fs.writeFile(tempPath, buffer);

    const description = await describeImageForLora(tempPath, triggerWord);
    return NextResponse.json({ description });
  } catch (err) {
    console.error("describe-lora error:", err);
    const message = err instanceof Error ? err.message : "Description failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) {
      fs.unlink(tempPath).catch(() => {});
    }
  }
}
