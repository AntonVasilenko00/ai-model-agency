import path from "path";
import fs from "fs/promises";
import { Job } from "./types";

const JOBS_DIR = path.join(process.cwd(), "data", "jobs");
const jobLocks = new Map<string, Promise<void>>();

function jobPath(id: string): string {
  return path.join(JOBS_DIR, `${id}.json`);
}

async function ensureJobsDir(): Promise<void> {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

export async function getJob(id: string): Promise<Job | undefined> {
  try {
    const raw = await fs.readFile(jobPath(id), "utf-8");
    return JSON.parse(raw) as Job;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

export async function setJob(job: Job): Promise<void> {
  await ensureJobsDir();
  await fs.writeFile(
    jobPath(job.id),
    JSON.stringify(job, null, 0),
    "utf-8"
  );
}

export async function updateJob(job: Job): Promise<void> {
  await ensureJobsDir();
  await fs.writeFile(
    jobPath(job.id),
    JSON.stringify(job, null, 0),
    "utf-8"
  );
}

/**
 * Atomically read-modify-write a job. Uses a per-job promise chain
 * to serialize concurrent mutations and prevent stale overwrites.
 */
export async function atomicUpdateJob(
  jobId: string,
  mutate: (job: Job) => void
): Promise<Job> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  jobLocks.set(jobId, next);

  await prev;
  try {
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    mutate(job);
    await updateJob(job);
    return job;
  } finally {
    release();
    if (jobLocks.get(jobId) === next) {
      jobLocks.delete(jobId);
    }
  }
}
