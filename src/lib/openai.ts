import path from "path";
import fs from "fs/promises";
import OpenAI from "openai";
import { readFileAsDataUri } from "./storage";

const PROMPT_PATH = path.join(process.cwd(), "prompts", "describe-image.txt");
const LORA_PROMPT_PATH = path.join(process.cwd(), "prompts", "describe-image-lora.txt");

async function getDescriptionPrompt(): Promise<string> {
  const text = await fs.readFile(PROMPT_PATH, "utf-8");
  return text.trim();
}

async function getLoraPrompt(triggerWord: string): Promise<string> {
  const template = await fs.readFile(LORA_PROMPT_PATH, "utf-8");
  return template.trim().replace("{triggerWord}", triggerWord);
}

const DESCRIPTION_MODEL = process.env.OPENAI_DESCRIPTION_MODEL || "gpt-4o";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function describeImage(imagePath: string): Promise<string> {
  const openai = getClient();
  const [dataUri, prompt] = await Promise.all([
    readFileAsDataUri(imagePath),
    getDescriptionPrompt(),
  ]);

  const response = await openai.chat.completions.create({
    model: DESCRIPTION_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUri, detail: "high" },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenAI returned an empty description");
  }
  return text;
}

export async function describeImageForLora(
  imagePath: string,
  triggerWord: string
): Promise<string> {
  const openai = getClient();
  const [dataUri, prompt] = await Promise.all([
    readFileAsDataUri(imagePath),
    getLoraPrompt(triggerWord),
  ]);

  const response = await openai.chat.completions.create({
    model: DESCRIPTION_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUri, detail: "high" },
          },
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenAI returned an empty description");
  }
  return text;
}

export async function describeImages(
  imagePaths: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const descriptions: string[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < imagePaths.length; i += CONCURRENCY) {
    const batch = imagePaths.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p) => {
        try {
          return await describeImage(p);
        } catch (err) {
          console.error(`Failed to describe ${p}:`, err);
          throw err;
        }
      })
    );
    descriptions.push(...results);
    onProgress?.(descriptions.length, imagePaths.length);
  }

  return descriptions;
}
