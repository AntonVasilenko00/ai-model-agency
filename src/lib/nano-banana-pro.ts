import fs from "fs/promises";
import path from "path";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-3-pro-image-preview";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  return map[ext] || "image/jpeg";
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }>;
    };
  }[];
  error?: { message: string; code: number };
}

export async function generateImage(
  sourceImagePath: string,
  prompt: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const apiKey = getApiKey();
  const imageBytes = await fs.readFile(sourceImagePath);
  const base64 = imageBytes.toString("base64");
  const mime = mimeFromPath(sourceImagePath);

  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: mime, data: base64 } },
          {
            text: `Using the person in this reference photo, generate a new photo matching this description:\n\n${prompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const url = `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed (${res.status}): ${text}`);
  }

  const json: GeminiResponse = await res.json();

  if (json.error) {
    throw new Error(`Gemini API error: ${json.error.message}`);
  }

  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("Gemini API returned no content");
  }

  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    throw new Error("Gemini API returned no image data");
  }

  return Buffer.from(imagePart.inlineData.data, "base64");
}
