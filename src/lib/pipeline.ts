import { Job } from "./types";
import { getJob, updateJob, atomicUpdateJob } from "./job-store";
import { describeImage } from "./openai";
import { generateImage } from "./nano-banana-pro";
import { saveGeneratedImage } from "./storage";

const GENERATION_CONCURRENCY = 3;
const DESCRIBE_CONCURRENCY = 5;
const DESCRIBE_MAX_RETRIES = 3;
const DESCRIBE_RETRY_DELAY_MS = 1000;

async function describeImageWithRetry(imagePath: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DESCRIBE_MAX_RETRIES; attempt++) {
    try {
      return await describeImage(imagePath);
    } catch (err) {
      lastErr = err;
      if (attempt < DESCRIBE_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, DESCRIBE_RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

export async function runPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  try {
    if (job.datasetImages.length > 0) {
      // Status already set to "describing" by POST /api/jobs
      await describeAllImages(job);
    }

    // Use atomic update so we don't overwrite prompts written by describeAllImages
    await atomicUpdateJob(jobId, (j) => {
      j.status = "awaiting_validation";
      delete j.pipelineRequestId;
    });
  } catch (err) {
    console.error(`Pipeline failed for job ${jobId}:`, err);
    await atomicUpdateJob(jobId, (j) => {
      j.status = "failed";
      j.error = err instanceof Error ? err.message : String(err);
      delete j.pipelineRequestId;
    });
  }
}

export interface GenerationResult {
  cancelled?: boolean;
}

export async function runGenerationForImage(
  jobId: string,
  label: string,
  signal?: AbortSignal
): Promise<GenerationResult> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (!job.sourceImagePath) throw new Error("Source image is required to generate images");
  const gen = job.generatedImages.find((g) => g.label === label);
  if (!gen) throw new Error(`Image ${label} not found`);
  if (!gen.prompt) throw new Error(`No prompt for ${label}`);

  const result = await generateSingleImage(
    jobId,
    label,
    job.sourceImagePath,
    gen.prompt,
    signal
  );

  if (!result.cancelled) {
    await atomicUpdateJob(jobId, (freshJob) => {
      const allDone = freshJob.generatedImages.every(
        (g) => g.status === "completed" || g.status === "failed"
      );
      if (allDone) {
        freshJob.status = "completed";
      }
    });
  }
  return result;
}

export async function runGenerationForAllImages(
  jobId: string
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (!job.sourceImagePath) throw new Error("Source image is required to generate images");

  const pendingImages = job.generatedImages.filter(
    (g) => (g.status === "pending" || g.status === "failed") && g.prompt
  );
  if (pendingImages.length === 0) return;

  await atomicUpdateJob(jobId, (j) => {
    j.status = "generating";
  });

  for (let i = 0; i < pendingImages.length; i += GENERATION_CONCURRENCY) {
    const batch = pendingImages.slice(i, i + GENERATION_CONCURRENCY);
    await Promise.all(
      batch.map((gen) =>
        generateSingleImage(
          jobId,
          gen.label,
          job.sourceImagePath,
          gen.prompt!
        )
      )
    );
  }

  await atomicUpdateJob(jobId, (freshJob) => {
    freshJob.status = freshJob.generatedImages.some(
      (g) => g.status === "completed"
    )
      ? "completed"
      : "failed";
  });
}

export async function redescribeImage(
  jobId: string,
  label: string
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const gen = job.generatedImages.find((g) => g.label === label);
  if (!gen) throw new Error(`Image ${label} not found`);
  const dataset = job.datasetImages.find((d) => d.label === label);
  if (!dataset) throw new Error(`No dataset image for ${label} — cannot redescribe manual prompts`);

  gen.status = "describing";
  gen.error = undefined;
  await updateJob(job);

  try {
    const prompt = await describeImageWithRetry(dataset.uploadPath);
    gen.prompt = prompt;
    gen.status = "pending";
    await updateJob(job);
  } catch (err) {
    gen.status = "failed";
    gen.error = err instanceof Error ? err.message : String(err);
    await updateJob(job);
  }
}

async function describeAllImages(job: Job): Promise<void> {
  const jobId = job.id;
  const toDescribe = job.datasetImages.filter((d) => {
    const gen = job.generatedImages.find((g) => g.label === d.label);
    return !!gen;
  });

  for (let i = 0; i < toDescribe.length; i += DESCRIBE_CONCURRENCY) {
    const batch = toDescribe.slice(i, i + DESCRIBE_CONCURRENCY);
    await Promise.all(
      batch.map(async (dataset) => {
        await atomicUpdateJob(jobId, (j) => {
          const g = j.generatedImages.find((x) => x.label === dataset.label);
          if (g) g.status = "describing";
        });
        try {
          const prompt = await describeImageWithRetry(dataset.uploadPath);
          await atomicUpdateJob(jobId, (j) => {
            const g = j.generatedImages.find((x) => x.label === dataset.label);
            if (g) {
              g.prompt = prompt;
              g.status = "pending";
            }
            j.progress.described += 1;
          });
        } catch (err) {
          await atomicUpdateJob(jobId, (j) => {
            const g = j.generatedImages.find((x) => x.label === dataset.label);
            if (g) {
              g.status = "failed";
              g.error = err instanceof Error ? err.message : String(err);
            }
            j.progress.described += 1;
          });
        }
      })
    );
  }
}

async function generateSingleImage(
  jobId: string,
  label: string,
  sourceImagePath: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ cancelled?: boolean }> {
  await atomicUpdateJob(jobId, (job) => {
    const gen = job.generatedImages.find((g) => g.label === label)!;
    gen.status = "generating";
    gen.error = undefined;
  });

  try {
    const imageBuffer = await generateImage(sourceImagePath, prompt, signal);

    if (signal?.aborted) {
      await atomicUpdateJob(jobId, (job) => {
        const gen = job.generatedImages.find((g) => g.label === label)!;
        gen.status = "pending";
        gen.error = undefined;
      });
      return { cancelled: true };
    }

    const localPath = await saveGeneratedImage(jobId, label, imageBuffer);

    await atomicUpdateJob(jobId, (job) => {
      const gen = job.generatedImages.find((g) => g.label === label)!;
      gen.localPath = localPath;
      gen.status = "completed";
      job.progress.generated += 1;
    });

    return {};
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      await atomicUpdateJob(jobId, (job) => {
        const gen = job.generatedImages.find((g) => g.label === label)!;
        gen.status = "pending";
        gen.error = undefined;
      });
      return { cancelled: true };
    }

    await atomicUpdateJob(jobId, (job) => {
      const gen = job.generatedImages.find((g) => g.label === label)!;
      gen.status = "failed";
      gen.error = err instanceof Error ? err.message : String(err);
      job.progress.generated += 1;
    });

    return {};
  }
}
