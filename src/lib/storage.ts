import fs from "fs/promises";
import path from "path";
import { ImageCategory, makeLabel } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

export function uploadsDir(jobId: string): string {
  return path.join(DATA_DIR, "uploads", jobId);
}

export function outputDir(jobId: string): string {
  return path.join(DATA_DIR, "output", jobId);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveUpload(
  jobId: string,
  name: string,
  buffer: Buffer
): Promise<string> {
  const dir = uploadsDir(jobId);
  await ensureDir(dir);
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function saveSourceImage(
  jobId: string,
  buffer: Buffer,
  ext: string
): Promise<string> {
  return saveUpload(jobId, `source${ext}`, buffer);
}

export async function saveDatasetImage(
  jobId: string,
  category: ImageCategory,
  index: number,
  buffer: Buffer,
  ext: string
): Promise<string> {
  const label = makeLabel(category, index);
  return saveUpload(jobId, `${label}${ext}`, buffer);
}

export async function saveGeneratedImage(
  jobId: string,
  label: string,
  buffer: Buffer
): Promise<string> {
  const dir = outputDir(jobId);
  await ensureDir(dir);
  const filePath = path.join(dir, `${label}.png`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readFileAsBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

export async function readFileAsDataUri(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mime = mimeMap[ext] || "image/jpeg";
  const base64 = await readFileAsBase64(filePath);
  return `data:${mime};base64,${base64}`;
}

export function getOutputFilePath(jobId: string, label: string): string {
  return path.join(outputDir(jobId), `${label}.png`);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
