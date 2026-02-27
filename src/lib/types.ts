export type ImageCategory = "face" | "face_and_body" | "body" | "dataset" | "manual";

export interface DatasetImage {
  category: ImageCategory;
  index: number;
  label: string;
  uploadPath: string;
}

export interface GeneratedImage {
  label: string;
  category: ImageCategory;
  index: number;
  prompt: string;
  localPath?: string;
  status: "pending" | "describing" | "generating" | "completed" | "failed";
  error?: string;
}

export interface Job {
  id: string;
  status: "uploading" | "describing" | "awaiting_validation" | "generating" | "completed" | "failed";
  sourceImagePath: string | null;
  datasetImages: DatasetImage[];
  generatedImages: GeneratedImage[];
  progress: {
    described: number;
    generated: number;
    total: number;
  };
  error?: string;
  createdAt: string;
  /** Set when a request claims the pipeline start; used to avoid duplicate runs. */
  pipelineRequestId?: string;
}

export function makeLabel(category: ImageCategory | string, index: number): string {
  return `${category}_${index}`;
}

export const CATEGORIES: ImageCategory[] = ["face", "face_and_body", "body"];
export const MAX_IMAGES_PER_CATEGORY = 10;
export const MAX_DATASET_IMAGES = 30;
