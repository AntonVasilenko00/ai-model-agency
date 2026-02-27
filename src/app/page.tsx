"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { splitPromptsByLabels } from "@/lib/prompt-utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Trash2,
  Copy,
  Pencil,
  Download,
  Eye,
  Plus,
  ArrowRight,
  X,
  Upload,
  RotateCcw,
  Loader2,
  Play,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import JSZip from "jszip";

interface GeneratedImageInfo {
  label: string;
  category: string;
  index: number;
  status: string;
  prompt?: string;
  error?: string;
  hasLocal: boolean;
}

interface JobStatus {
  id: string;
  status: string;
  progress: { described: number; generated: number; total: number };
  error?: string;
  hasSource?: boolean;
  images: GeneratedImageInfo[];
}

const MAX_DATASET_IMAGES = 30;

// ─── Shared job hook ──────────────────────────────────────────────────────────

function useJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingLabel, setGeneratingLabel] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [uploadingSource, setUploadingSource] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetchJob = useCallback(() => {
    if (!jobId) return;
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((data: JobStatus) => setJobStatus(data))
      .catch(() => {});
  }, [jobId]);

  const startGeneration = useCallback(
    async (label: string) => {
      if (!jobId) return;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setGeneratingLabel(label);
      try {
        const res = await fetch(`/api/jobs/${jobId}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || "Generation failed");
        }
        const reader = res.body?.getReader();
        if (!reader) return;
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line) as { type: string };
              if (ev.type === "completed" || ev.type === "error" || ev.type === "cancelled") {
                refetchJob();
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          refetchJob();
        }
      } finally {
        setGeneratingLabel(null);
        abortControllerRef.current = null;
      }
    },
    [jobId, refetchJob]
  );

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleGenerateAll = useCallback(async () => {
    if (!jobId) return;
    setGeneratingAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/generate-all`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start generation");
      }
      refetchJob();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation");
    } finally {
      setGeneratingAll(false);
    }
  }, [jobId, refetchJob]);

  const handleUploadSourceToJob = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !jobId) return;
      setUploadingSource(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("source", file);
        const res = await fetch(`/api/jobs/${jobId}/source`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }
        refetchJob();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadingSource(false);
        e.target.value = "";
      }
    },
    [jobId, refetchJob]
  );

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.ok) {
          const data: JobStatus = await res.json();
          setJobStatus(data);
          if (data.status === "completed" || data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const reset = useCallback(() => {
    setJobId(null);
    setJobStatus(null);
    setError(null);
  }, []);

  return {
    jobId,
    setJobId,
    jobStatus,
    setJobStatus,
    uploading,
    setUploading,
    error,
    setError,
    generatingLabel,
    generatingAll,
    uploadingSource,
    refetchJob,
    startGeneration,
    cancelGeneration,
    handleGenerateAll,
    handleUploadSourceToJob,
    reset,
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab] = useState<string>("prompts");
  const [promptsFromTab1, setPromptsFromTab1] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loraImagesFromTab2, setLoraImagesFromTab2] = useState<File[]>([]);

  const tab1Job = useJob();
  const tab2Job = useJob();

  const handleCopyToImagesTab = useCallback(
    (images: GeneratedImageInfo[]) => {
      const withPrompts = images.filter((i) => i.prompt);
      const text = withPrompts.map((i) => `[${i.label}]\n${i.prompt}`).join("\n\n");
      setPromptsFromTab1(text);
      setActiveTab("images");
    },
    []
  );

  const handleMoveToLoraTab = useCallback(
    async (jobId: string, images: GeneratedImageInfo[]) => {
      const completed = images.filter((i) => i.status === "completed" && i.hasLocal);
      if (completed.length === 0) return;
      const files: File[] = [];
      for (const img of completed) {
        try {
          const res = await fetch(`/api/download?job=${jobId}&label=${img.label}`);
          if (!res.ok) continue;
          const blob = await res.blob();
          files.push(new File([blob], `${img.label}.png`, { type: "image/png" }));
        } catch {
          /* skip failed fetches */
        }
      }
      if (files.length > 0) {
        setLoraImagesFromTab2(files);
        setActiveTab("lora");
      }
    },
    []
  );

  return (
    <main className="min-h-screen p-6 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">AI Model Agency</h1>
        <p className="text-muted mt-1">
          Generate consistent AI image datasets from reference photos
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="prompts">Prompt Generation</TabsTrigger>
          <TabsTrigger value="images">Images from Prompts</TabsTrigger>
          <TabsTrigger value="lora">LoRA Descriptions</TabsTrigger>
        </TabsList>

        <TabsContent value="prompts">
          <PromptGenerationTab
            job={tab1Job}
            onCopyToImagesTab={handleCopyToImagesTab}
            onPreview={setPreviewUrl}
          />
        </TabsContent>

        <TabsContent value="images">
          <ImagesFromPromptsTab
            job={tab2Job}
            promptsFromTab1={promptsFromTab1}
            clearPromptsFromTab1={() => setPromptsFromTab1("")}
            onPreview={setPreviewUrl}
            onMoveToLoraTab={handleMoveToLoraTab}
          />
        </TabsContent>

        <TabsContent value="lora">
          <DescribeForLoraTab
            loraImagesFromTab2={loraImagesFromTab2}
            clearLoraImagesFromTab2={() => setLoraImagesFromTab2([])}
            onPreview={setPreviewUrl}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={!!previewUrl} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent onClose={() => setPreviewUrl(null)}>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Full preview"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

// ─── Tab 1: Prompt Generation ─────────────────────────────────────────────────

function PromptGenerationTab({
  job,
  onCopyToImagesTab,
  onPreview,
}: {
  job: ReturnType<typeof useJob>;
  onCopyToImagesTab: (images: GeneratedImageInfo[]) => void;
  onPreview: (url: string) => void;
}) {
  const [datasetFiles, setDatasetFiles] = useState<File[]>([]);

  const handleDatasetChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setDatasetFiles(Array.from(e.target.files).slice(0, MAX_DATASET_IMAGES));
  }, []);

  const handleUploadAndRun = useCallback(async () => {
    if (datasetFiles.length === 0) return;
    job.setUploading(true);
    job.setError(null);
    job.setJobId(null);
    job.setJobStatus(null);

    try {
      const formData = new FormData();
      datasetFiles.forEach((file, idx) => formData.append(`dataset_${idx + 1}`, file));

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        throw new Error(body.error || "Upload failed");
      }

      const { jobId: newJobId } = await uploadRes.json();
      job.setJobId(newJobId);

      const startRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: newJobId }),
      });
      if (!startRes.ok) {
        const body = await startRes.json();
        throw new Error(body.error || "Failed to start job");
      }
    } catch (err) {
      job.setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      job.setUploading(false);
    }
  }, [datasetFiles, job]);

  // Before job
  if (!job.jobId) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Image to prompt</CardTitle>
            <CardDescription>
              Upload reference images to generate prompts from their descriptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted">
                Select reference images (up to {MAX_DATASET_IMAGES})
              </p>
              {datasetFiles.length > 0 && (
                <span className="text-xs font-mono text-success">
                  {datasetFiles.length}/{MAX_DATASET_IMAGES}
                </span>
              )}
            </div>
            <label
              className={`flex items-center justify-center py-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                datasetFiles.length > 0
                  ? "border-success/50 bg-success/5 hover:border-success"
                  : "border-card-border hover:border-accent"
              }`}
            >
              <span className="text-sm text-muted">
                {datasetFiles.length > 0
                  ? `${datasetFiles.length} image${datasetFiles.length > 1 ? "s" : ""} selected — click to change`
                  : `Select up to ${MAX_DATASET_IMAGES} images`}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={handleDatasetChange}
              />
            </label>
            {datasetFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {datasetFiles.map((f, i) => (
                  <span
                    key={i}
                    className="text-xs bg-card-border/50 text-muted px-2 py-0.5 rounded truncate max-w-[150px]"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {job.error && (
          <div className="rounded-lg bg-error/10 border border-error/30 text-error p-4 text-sm">
            {job.error}
          </div>
        )}

        <Button
          onClick={handleUploadAndRun}
          disabled={datasetFiles.length === 0 || job.uploading}
          className="w-full h-12 text-base font-semibold"
          size="lg"
        >
          {job.uploading ? (
            <>
              <Loader2 className="animate-spin" /> Uploading...
            </>
          ) : (
            <>
              <Upload /> Upload & generate prompts
            </>
          )}
        </Button>
      </div>
    );
  }

  // Loading
  if (!job.jobStatus) {
    return (
      <div className="text-center py-20 text-muted flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Loading job status...
      </div>
    );
  }

  // After job
  const withPrompts = job.jobStatus.images.filter((i) => i.prompt);

  return (
    <div className="space-y-6">
      {job.error && (
        <div className="rounded-lg bg-error/10 border border-error/30 text-error p-4 text-sm">
          {job.error}
        </div>
      )}

      <UnifiedPromptsSection
        images={job.jobStatus.images}
        jobId={job.jobId}
        jobStatus={job.jobStatus.status}
        hasSource={job.jobStatus.hasSource}
        generatingLabel={job.generatingLabel}
        onStartGeneration={job.startGeneration}
        onCancelGeneration={job.cancelGeneration}
        onRefetch={job.refetchJob}
        onPreview={onPreview}
        imageToPromptOnly
      />

      {withPrompts.length > 0 && (
        <Button
          onClick={() => onCopyToImagesTab(job.jobStatus!.images)}
          className="w-full h-12 text-base font-semibold"
          size="lg"
        >
          <ArrowRight /> Copy prompts to Images tab
        </Button>
      )}

      <Button
        variant="outline"
        onClick={() => {
          job.reset();
          setDatasetFiles([]);
        }}
        className="w-full"
      >
        Start New Dataset
      </Button>
    </div>
  );
}

// ─── Tab 2: Images from Prompts ───────────────────────────────────────────────

function ImagesFromPromptsTab({
  job,
  promptsFromTab1,
  clearPromptsFromTab1,
  onPreview,
  onMoveToLoraTab,
}: {
  job: ReturnType<typeof useJob>;
  promptsFromTab1: string;
  clearPromptsFromTab1: () => void;
  onPreview: (url: string) => void;
  onMoveToLoraTab: (jobId: string, images: GeneratedImageInfo[]) => Promise<void>;
}) {
  const [movingToLora, setMovingToLora] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [manualPrompts, setManualPrompts] = useState<string[]>([]);
  const [draftPrompt, setDraftPrompt] = useState("");

  // Pre-fill from Tab 1
  useEffect(() => {
    if (promptsFromTab1) {
      const parsed = splitPromptsByLabels(promptsFromTab1);
      if (parsed.length > 0) {
        setManualPrompts((prev) => [...prev, ...parsed]);
      }
      clearPromptsFromTab1();
    }
  }, [promptsFromTab1, clearPromptsFromTab1]);

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceFile(file);
      setSourcePreview(URL.createObjectURL(file));
    }
  }, []);

  const handleAddPrompt = useCallback(() => {
    const trimmed = draftPrompt.trim();
    if (!trimmed) return;
    const prompts = splitPromptsByLabels(trimmed);
    if (prompts.length === 0) return;
    setManualPrompts((prev) => [...prev, ...prompts]);
    setDraftPrompt("");
  }, [draftPrompt]);

  const handleRemovePrompt = useCallback((index: number) => {
    setManualPrompts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditPrompt = useCallback((index: number, value: string) => {
    setManualPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));
  }, []);

  const handleUploadAndRun = useCallback(async () => {
    if (manualPrompts.length === 0) return;
    job.setUploading(true);
    job.setError(null);
    job.setJobId(null);
    job.setJobStatus(null);

    try {
      const formData = new FormData();
      if (sourceFile) formData.append("source", sourceFile);
      manualPrompts.forEach((prompt, idx) => formData.append(`manual_prompt_${idx + 1}`, prompt));

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.json();
        throw new Error(body.error || "Upload failed");
      }

      const { jobId: newJobId } = await uploadRes.json();
      job.setJobId(newJobId);

      const startRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: newJobId }),
      });
      if (!startRes.ok) {
        const body = await startRes.json();
        throw new Error(body.error || "Failed to start job");
      }
    } catch (err) {
      job.setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      job.setUploading(false);
    }
  }, [sourceFile, manualPrompts, job]);

  const completedCount =
    job.jobStatus?.images.filter((i) => i.status === "completed").length ?? 0;

  // Before job
  if (!job.jobId) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Source Photo</CardTitle>
            <CardDescription>
              Upload the identity reference photo. Required to generate images from your prompts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              <label className="flex flex-col items-center justify-center w-40 h-40 rounded-lg border-2 border-dashed border-card-border hover:border-accent cursor-pointer transition-colors overflow-hidden">
                {sourcePreview ? (
                  <img src={sourcePreview} alt="Source" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted">
                    <Upload className="h-6 w-6" />
                    <span className="text-sm text-center px-2">Click to upload</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleSourceChange}
                />
              </label>
              {sourceFile && (
                <div className="text-sm text-muted pt-2">
                  <p className="font-medium text-foreground">{sourceFile.name}</p>
                  <p>{(sourceFile.size / 1024).toFixed(0)} KB</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prompts</CardTitle>
            <CardDescription>
              Paste or type prompts to generate images. Use [label] blocks to split multiple
              prompts at once.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAddPrompt();
                  }
                }}
                placeholder='Paste or type a prompt (or multiple with [dataset_1], [dataset_2]...). Enter or Add.'
                className="flex-1 min-h-[44px] max-h-[120px]"
                rows={1}
              />
              <Button onClick={handleAddPrompt} disabled={!draftPrompt.trim()} className="self-end shrink-0">
                Add
              </Button>
            </div>

            {manualPrompts.length > 0 && (
              <div className="space-y-2">
                {manualPrompts.map((prompt, i) => (
                  <EditablePromptItem
                    key={i}
                    index={i}
                    value={prompt}
                    onChange={handleEditPrompt}
                    onRemove={handleRemovePrompt}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {job.error && (
          <div className="rounded-lg bg-error/10 border border-error/30 text-error p-4 text-sm">
            {job.error}
          </div>
        )}

        {manualPrompts.length > 0 && !sourceFile && (
          <p className="text-sm text-muted">Upload a source photo above to continue.</p>
        )}

        <Button
          onClick={handleUploadAndRun}
          disabled={!sourceFile || manualPrompts.length === 0 || job.uploading}
          className="w-full h-12 text-base font-semibold"
          size="lg"
        >
          {job.uploading ? (
            <>
              <Loader2 className="animate-spin" /> Uploading...
            </>
          ) : (
            <>
              <ImageIcon /> Upload & generate images
            </>
          )}
        </Button>
      </div>
    );
  }

  // Loading
  if (!job.jobStatus) {
    return (
      <div className="text-center py-20 text-muted flex flex-col items-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin" />
        Loading job status...
      </div>
    );
  }

  // After job
  const failedCount = job.jobStatus.images.filter((i) => i.status === "failed").length;

  return (
    <div className="space-y-6">
      {job.error && (
        <div className="rounded-lg bg-error/10 border border-error/30 text-error p-4 text-sm">
          {job.error}
        </div>
      )}

      <JobStatusCard
        jobId={job.jobId}
        jobStatus={job.jobStatus}
        completedCount={completedCount}
        failedCount={failedCount}
        generatingAll={job.generatingAll}
        hasSource={job.jobStatus.hasSource}
        onGenerateAll={job.handleGenerateAll}
        onRefetch={job.refetchJob}
      />

      {!job.jobStatus.hasSource && (
        <SourceUploadCard
          uploadingSource={job.uploadingSource}
          onUpload={job.handleUploadSourceToJob}
        />
      )}

      <UnifiedPromptsSection
        images={job.jobStatus.images}
        jobId={job.jobId}
        jobStatus={job.jobStatus.status}
        hasSource={job.jobStatus.hasSource}
        generatingLabel={job.generatingLabel}
        onStartGeneration={job.startGeneration}
        onCancelGeneration={job.cancelGeneration}
        onRefetch={job.refetchJob}
        onPreview={onPreview}
      />

      {completedCount > 0 && (
        <Button
          onClick={async () => {
            setMovingToLora(true);
            try {
              await onMoveToLoraTab(job.jobId!, job.jobStatus!.images);
            } finally {
              setMovingToLora(false);
            }
          }}
          disabled={movingToLora}
          className="w-full h-12 text-base font-semibold"
          size="lg"
        >
          {movingToLora ? (
            <>
              <Loader2 className="animate-spin" /> Moving images...
            </>
          ) : (
            <>
              <ArrowRight /> Move all to LoRA tab
            </>
          )}
        </Button>
      )}

      <Button
        variant="outline"
        onClick={() => {
          job.reset();
          setSourceFile(null);
          setSourcePreview(null);
          setManualPrompts([]);
          setDraftPrompt("");
        }}
        className="w-full"
      >
        Start New Dataset
      </Button>
    </div>
  );
}

// ─── Shared: Job Status Card ──────────────────────────────────────────────────

function StatusBadgeComponent({ status }: { status: string }) {
  const variantMap: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
    completed: "success",
    failed: "destructive",
    awaiting_validation: "warning",
    describing: "default",
    generating: "default",
    uploading: "secondary",
  };
  return <Badge variant={variantMap[status] || "secondary"}>{status}</Badge>;
}

function JobStatusCard({
  jobId,
  jobStatus,
  completedCount,
  failedCount,
  generatingAll,
  hasSource,
  onGenerateAll,
  onRefetch,
  showGenerateButton = true,
}: {
  jobId: string;
  jobStatus: JobStatus;
  completedCount: number;
  failedCount: number;
  generatingAll: boolean;
  hasSource?: boolean;
  onGenerateAll: () => void;
  onRefetch?: () => void;
  showGenerateButton?: boolean;
}) {
  const [recovering, setRecovering] = useState(false);
  const statusTitle: Record<string, string> = {
    completed: "Generation Complete",
    failed: "Generation Failed",
    awaiting_validation: "Review Prompts",
    describing: "Describing Images...",
    generating: "Generating Images...",
  };

  const handleRecoverFromDescribing = async () => {
    if (!onRefetch) return;
    setRecovering(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/recover-from-describing`, { method: "POST" });
      if (res.ok) onRefetch();
    } finally {
      setRecovering(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{statusTitle[jobStatus.status] || jobStatus.status}</CardTitle>
          <StatusBadgeComponent status={jobStatus.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobStatus.error && <p className="text-error text-sm">{jobStatus.error}</p>}

        <div className="space-y-2">
          <Progress label="Described" value={jobStatus.progress.described} max={jobStatus.progress.total} />
          <Progress label="Generated" value={jobStatus.progress.generated} max={jobStatus.progress.total} />
        </div>

        <p className="text-sm text-muted">
          {completedCount} completed, {failedCount} failed out of {jobStatus.progress.total}
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {showGenerateButton && jobStatus.status === "awaiting_validation" && (
            <>
              <Button onClick={onGenerateAll} disabled={generatingAll || !hasSource}>
                {generatingAll ? (
                  <>
                    <Loader2 className="animate-spin" /> Starting...
                  </>
                ) : (
                  <>
                    <Play /> Generate images for all
                  </>
                )}
              </Button>
              {!hasSource && (
                <span className="text-sm text-muted">Upload a source photo to generate images.</span>
              )}
            </>
          )}
          {(jobStatus.status === "describing" || jobStatus.images?.some((i) => i.status === "describing")) && onRefetch && (
            <Button variant="outline" size="sm" onClick={handleRecoverFromDescribing} disabled={recovering}>
              {recovering ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5" /> Recovering...
                </>
              ) : (
                "Stuck? Recover"
              )}
            </Button>
          )}
          {completedCount > 0 && (
            <Button variant="secondary" asChild>
              <a href={`/api/jobs/${jobId}/zip`}>
                <Download /> Download All as ZIP
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Shared: Source Upload Card ───────────────────────────────────────────────

function SourceUploadCard({
  uploadingSource,
  onUpload,
}: {
  uploadingSource: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source photo</CardTitle>
        <CardDescription>
          Upload the identity reference photo to generate images from your prompts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onUpload}
              disabled={uploadingSource}
            />
            {uploadingSource ? (
              <>
                <Loader2 className="animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <Upload /> Upload source photo
              </>
            )}
          </label>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Editable prompt (pre-job local list) ─────────────────────────────────────

function EditablePromptItem({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  return (
    <div className="flex items-start gap-2 rounded-lg border border-card-border bg-background/50 p-3">
      <span className="text-xs font-mono text-muted shrink-0 pt-0.5">#{index + 1}</span>
      {editing ? (
        <div className="flex-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[44px]"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              onClick={() => {
                onChange(index, draft);
                setEditing(false);
              }}
              disabled={!draft.trim()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p
          className="flex-1 text-sm text-foreground/80 leading-relaxed cursor-pointer hover:text-foreground transition-colors"
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {value}
        </p>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 h-7 w-7 text-muted hover:text-error"
        onClick={() => onRemove(index)}
        title="Remove prompt"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Unified Prompts Section (after job) ──────────────────────────────────────

function UnifiedPromptsSection({
  images,
  jobId,
  jobStatus,
  hasSource,
  generatingLabel,
  onStartGeneration,
  onCancelGeneration,
  onRefetch,
  onPreview,
  imageToPromptOnly = false,
}: {
  images: GeneratedImageInfo[];
  jobId: string;
  jobStatus: string;
  hasSource?: boolean;
  generatingLabel: string | null;
  onStartGeneration: (label: string) => void;
  onCancelGeneration: () => void;
  onRefetch: () => void;
  onPreview: (url: string) => void;
  imageToPromptOnly?: boolean;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualPrompt, setManualPrompt] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const awaitingValidation = jobStatus === "awaiting_validation";
  const withPrompts = images.filter((i) => i.prompt);
  const stuckDescribingCount = images.filter((i) => i.status === "describing").length;

  const handleRecoverFromDescribing = async () => {
    setRecovering(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/recover-from-describing`, { method: "POST" });
      if (res.ok) onRefetch();
    } finally {
      setRecovering(false);
    }
  };

  const handleCopyAll = async () => {
    const text = withPrompts.map((i) => `[${i.label}]\n${i.prompt}`).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleAddManual = async () => {
    const raw = manualPrompt.trim();
    if (!raw) return;
    const prompts = splitPromptsByLabels(raw);
    if (prompts.length === 0) return;

    setAddingManual(true);
    try {
      for (const prompt of prompts) {
        const res = await fetch(`/api/jobs/${jobId}/manual-prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to add prompt");
        }
      }
      setManualPrompt("");
      setShowManualForm(false);
      onRefetch();
    } catch {
      /* silently fail */
    } finally {
      setAddingManual(false);
    }
  };

  return (
    <Card>
      <div className="p-4 flex items-center justify-between">
        <h3 className="text-md font-semibold">Prompts & Results ({images.length})</h3>
        <div className="flex items-center gap-2">
          {withPrompts.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleCopyAll}>
              <Copy className="h-3.5 w-3.5" />
              {copiedAll ? "Copied!" : "Copy All"}
            </Button>
          )}
          {!imageToPromptOnly && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowManualForm(!showManualForm)}
            >
              {showManualForm ? (
                <>
                  <X className="h-3.5 w-3.5" /> Cancel
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" /> Add Prompt
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {stuckDescribingCount > 0 && (
        <div className="border-t border-card-border px-4 py-2 flex items-center justify-between bg-muted/30">
          <span className="text-sm text-muted">
            {stuckDescribingCount} prompt{stuckDescribingCount !== 1 ? "s" : ""} stuck describing.
          </span>
          <Button variant="outline" size="sm" onClick={handleRecoverFromDescribing} disabled={recovering}>
            {recovering ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : null}
            {recovering ? " Recovering..." : "Recover"}
          </Button>
        </div>
      )}

      {!imageToPromptOnly && showManualForm && (
        <div className="border-t border-card-border px-4 py-3">
          <Textarea
            value={manualPrompt}
            onChange={(e) => setManualPrompt(e.target.value)}
            placeholder='Enter or paste a prompt (or multiple with [dataset_1], [dataset_2]...). Add splits automatically.'
            className="min-h-[80px]"
          />
          <div className="flex justify-end mt-2">
            <Button size="sm" onClick={handleAddManual} disabled={!manualPrompt.trim() || addingManual}>
              {addingManual ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5" /> Adding...
                </>
              ) : (
                "Add Prompt"
              )}
            </Button>
          </div>
        </div>
      )}

      <div className="border-t border-card-border">
        {images.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No prompts yet — images are being described...
          </div>
        ) : (
          images.map((img) => (
            <UnifiedPromptRow
              key={img.label}
              image={img}
              jobId={jobId}
              awaitingValidation={awaitingValidation}
              hasSource={hasSource}
              generatingLabel={generatingLabel}
              onStartGeneration={onStartGeneration}
              onCancelGeneration={onCancelGeneration}
              onRefetch={onRefetch}
              onPreview={onPreview}
              imageToPromptOnly={imageToPromptOnly}
            />
          ))
        )}
      </div>
    </Card>
  );
}

// ─── Unified Prompt Row ───────────────────────────────────────────────────────

function UnifiedPromptRow({
  image,
  jobId,
  awaitingValidation,
  hasSource,
  generatingLabel,
  onStartGeneration,
  onCancelGeneration,
  onRefetch,
  onPreview,
  imageToPromptOnly = false,
}: {
  image: GeneratedImageInfo;
  jobId: string;
  awaitingValidation: boolean;
  hasSource?: boolean;
  generatingLabel: string | null;
  onStartGeneration: (label: string) => void;
  onCancelGeneration: () => void;
  onRefetch: () => void;
  onPreview: (url: string) => void;
  imageToPromptOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(image.prompt ?? "");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryingPrompt, setRetryingPrompt] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isGeneratingThis = generatingLabel === image.label;
  const isReady = image.status === "completed" && image.hasLocal;
  const isManual = image.category === "manual";
  const canAct =
    awaitingValidation &&
    (image.status === "pending" || image.status === "failed") &&
    !!image.prompt;
  const canDelete =
    image.status !== "generating" && image.status !== "describing" && !isGeneratingThis;

  useEffect(() => {
    if (!editing) setEditValue(image.prompt ?? "");
  }, [image.prompt, editing]);

  const handleSavePrompt = async () => {
    if (editValue === image.prompt) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: image.label, prompt: editValue }),
      });
      if (res.ok) {
        setEditing(false);
        onRefetch();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRetryPrompt = async () => {
    setRetryingPrompt(true);
    try {
      await fetch(`/api/jobs/${jobId}/describe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: image.label }),
      });
      onRefetch();
    } finally {
      setRetryingPrompt(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await onStartGeneration(image.label);
    } finally {
      setAccepting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/delete-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: image.label }),
      });
      if (res.ok) {
        onRefetch();
      }
    } finally {
      setDeleting(false);
    }
  };

  const imgUrl = `/api/download?job=${jobId}&label=${image.label}`;

  // Fixed min-height for prompt area to prevent layout shift when toggling describing / prompt text
  const promptContentMinHeight = "min-h-[2.75rem]";

  return (
    <div className="border-t border-card-border first:border-t-0 px-4 py-3 flex items-start gap-4 min-h-20">
      {/* Left: label + prompt */}
      <div className="flex-1 min-w-0 flex flex-col min-h-20">
        <div className="flex items-center gap-2 mb-1 shrink-0 min-h-5">
          <span className="text-xs font-mono text-muted shrink-0">{image.label}</span>
          {image.status === "describing" ? (
            <span className="text-xs text-accent flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Describing...
            </span>
          ) : (
            <span className="text-xs invisible select-none" aria-hidden>Describing...</span>
          )}
        </div>

        {editing ? (
          <div>
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="min-h-[60px]"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={handleSavePrompt} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setEditValue(image.prompt ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : image.prompt ? (
          <div className={`flex items-start gap-1.5 ${promptContentMinHeight}`}>
            <p
              className={`text-sm text-foreground/80 leading-relaxed flex-1 min-w-0 ${
                expanded ? "" : "line-clamp-1"
              } cursor-pointer hover:text-foreground transition-colors`}
              onClick={() => {
                if (image.status !== "generating") setEditing(true);
              }}
              title="Click to edit"
            >
              {image.prompt}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              className="shrink-0 p-0.5 rounded text-muted hover:text-foreground hover:bg-muted/50 transition-colors"
              title={expanded ? "Collapse" : "Expand"}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        ) : image.status !== "describing" ? (
          <p
            className={`text-sm text-muted italic cursor-pointer hover:text-foreground transition-colors flex items-center ${promptContentMinHeight}`}
            onClick={() => setEditing(true)}
          >
            No prompt — click to add
          </p>
        ) : (
          <div className={promptContentMinHeight} aria-hidden />
        )}
      </div>

      {/* Middle: status + thumbnail — fixed size to avoid shift */}
      <div className="shrink-0 w-16 h-20 flex items-center justify-center">
        {isReady ? (
          <img
            src={imgUrl}
            alt={image.label}
            className="w-16 h-20 object-cover rounded border border-card-border cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => onPreview(imgUrl)}
          />
        ) : !imageToPromptOnly && image.status === "generating" ? (
          <div className="w-16 h-20 rounded border border-card-border bg-background flex flex-col items-center justify-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span className="text-[10px] text-muted">Generating</span>
          </div>
        ) : image.status === "failed" && image.prompt ? (
          <div className="w-16 h-20 rounded border border-error/30 bg-error/5 flex items-center justify-center">
            <span className="text-[10px] text-error">Failed</span>
          </div>
        ) : (
          <div className="w-16 h-20 rounded border border-transparent" aria-hidden />
        )}
      </div>

      {/* Right: actions — reserve space when describing to avoid layout shift */}
      <div className="shrink-0 flex flex-col items-end gap-1.5 min-w-[100px] w-[100px]">
        {image.status === "describing" && !editing ? (
          <div className="w-full h-8 shrink-0" aria-hidden />
        ) : !isGeneratingThis && !editing ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        ) : null}
        {!imageToPromptOnly && isGeneratingThis && (
          <Button variant="outline" size="sm" className="w-full border-error/50 text-error hover:bg-error/10" onClick={onCancelGeneration}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
        {!imageToPromptOnly && canAct && !isGeneratingThis && (
          <Button size="sm" className="w-full" onClick={handleAccept} disabled={accepting || !hasSource}>
            {accepting ? (
              <>
                <Loader2 className="animate-spin h-3.5 w-3.5" /> Starting...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Generate
              </>
            )}
          </Button>
        )}
        {image.status === "describing" && !editing && !isManual ? (
          <div className="w-full h-8 shrink-0" aria-hidden />
        ) : !isManual && image.prompt && !isGeneratingThis ? (
          <Button variant="outline" size="sm" className="w-full" onClick={handleRetryPrompt} disabled={retryingPrompt}>
            <RotateCcw className="h-3.5 w-3.5" />
            {retryingPrompt ? "Retrying..." : "Re-describe"}
          </Button>
        ) : null}
        {!imageToPromptOnly && image.status === "failed" && image.prompt && !awaitingValidation && !isGeneratingThis && (
          <Button variant="secondary" size="sm" className="w-full" onClick={handleAccept} disabled={accepting || !hasSource}>
            <RotateCcw className="h-3.5 w-3.5" />
            {accepting ? "Retrying..." : "Retry"}
          </Button>
        )}
        {isReady && (
          <>
            {!imageToPromptOnly && (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <a href={`${imgUrl}&dl=1`} download>
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => onPreview(imgUrl)}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </Button>
          </>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted hover:text-error"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Tab 3: Describe images for LoRA ──────────────────────────────────────────

interface LoraItem {
  id: string;
  file: File;
  previewUrl: string;
  description?: string;
  describing: boolean;
  error?: string;
}

function DescribeForLoraTab({
  loraImagesFromTab2,
  clearLoraImagesFromTab2,
  onPreview,
}: {
  loraImagesFromTab2: File[];
  clearLoraImagesFromTab2: () => void;
  onPreview: (url: string) => void;
}) {
  const [triggerWord, setTriggerWord] = useState("");
  const [items, setItems] = useState<LoraItem[]>([]);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (loraImagesFromTab2.length === 0) return;
    const newItems: LoraItem[] = loraImagesFromTab2.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      describing: false,
    }));
    setItems((prev) => [...prev, ...newItems]);
    clearLoraImagesFromTab2();
  }, [loraImagesFromTab2, clearLoraImagesFromTab2]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const newItems: LoraItem[] = files.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      describing: false,
    }));
    setItems((prev) => [...prev, ...newItems]);
    e.target.value = "";
  }, []);

  const describeOne = useCallback(
    async (itemId: string) => {
      const tw = triggerWord.trim();
      if (!tw) return;
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, describing: true, error: undefined } : it))
      );
      try {
        const item = items.find((it) => it.id === itemId);
        if (!item) return;
        const formData = new FormData();
        formData.append("image", item.file);
        formData.append("triggerWord", tw);
        const res = await fetch("/api/describe-lora", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Description failed");
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId ? { ...it, description: data.description, describing: false } : it
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId
              ? { ...it, describing: false, error: err instanceof Error ? err.message : "Failed" }
              : it
          )
        );
      }
    },
    [triggerWord, items]
  );

  const handleGenerateAll = useCallback(async () => {
    const tw = triggerWord.trim();
    if (!tw || items.length === 0) return;
    setGeneratingAll(true);
    const toDescribe = items.filter((it) => !it.description && !it.describing);

    setItems((prev) =>
      prev.map((it) =>
        toDescribe.some((td) => td.id === it.id)
          ? { ...it, describing: true, error: undefined }
          : it
      )
    );

    const CONCURRENCY = 5;
    for (let i = 0; i < toDescribe.length; i += CONCURRENCY) {
      const batch = toDescribe.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          try {
            const formData = new FormData();
            formData.append("image", item.file);
            formData.append("triggerWord", tw);
            const res = await fetch("/api/describe-lora", { method: "POST", body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Description failed");
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id ? { ...it, description: data.description, describing: false } : it
              )
            );
          } catch (err) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? { ...it, describing: false, error: err instanceof Error ? err.message : "Failed" }
                  : it
              )
            );
          }
        })
      );
    }
    setGeneratingAll(false);
  }, [triggerWord, items]);

  const handleRemoveItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((it) => it.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  }, []);

  const handleEditDescription = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, description: value } : it))
    );
  }, []);

  const handleDownloadTrainingData = useCallback(async () => {
    const withDesc = items.filter((it) => it.description);
    if (withDesc.length === 0) return;
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < withDesc.length; i++) {
        const item = withDesc[i];
        const num = i + 1;
        const arrayBuffer = await item.file.arrayBuffer();
        zip.file(`${num}.png`, arrayBuffer);
        zip.file(`${num}.txt`, item.description!);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lora_training_data.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }, [items]);

  const describedCount = items.filter((it) => it.description).length;
  const undescribedCount = items.filter((it) => !it.description && !it.describing).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Trigger Word</CardTitle>
          <CardDescription>
            The trigger word will be prepended to every description (e.g. &quot;misaz&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="text"
            value={triggerWord}
            onChange={(e) => setTriggerWord(e.target.value)}
            placeholder="e.g. misaz"
            className="w-full px-3 py-2 rounded-lg border border-card-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Training Images</CardTitle>
          <CardDescription>
            Upload images or move generated images from the Images tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-center py-4 rounded-lg border-2 border-dashed border-card-border hover:border-accent cursor-pointer transition-colors">
            <span className="text-sm text-muted">
              {items.length > 0
                ? `${items.length} image${items.length !== 1 ? "s" : ""} loaded — click to add more`
                : "Select images to describe for LoRA training"}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <>
          <Button
            onClick={handleGenerateAll}
            disabled={!triggerWord.trim() || undescribedCount === 0 || generatingAll}
            className="w-full h-12 text-base font-semibold"
            size="lg"
          >
            {generatingAll ? (
              <>
                <Loader2 className="animate-spin" /> Generating descriptions...
              </>
            ) : (
              <>
                <FileText /> Generate LoRA descriptions
                {undescribedCount > 0 && ` (${undescribedCount})`}
              </>
            )}
          </Button>
          {!triggerWord.trim() && (
            <p className="text-sm text-muted -mt-4">Enter a trigger word above to generate descriptions.</p>
          )}

          <Card>
            <div className="p-4 flex items-center justify-between">
              <h3 className="text-md font-semibold">
                Images & Descriptions ({describedCount}/{items.length})
              </h3>
            </div>
            <div className="border-t border-card-border">
              {items.map((item, idx) => (
                <LoraItemRow
                  key={item.id}
                  item={item}
                  index={idx}
                  triggerWord={triggerWord}
                  onRetry={describeOne}
                  onEdit={handleEditDescription}
                  onRemove={handleRemoveItem}
                  onPreview={onPreview}
                />
              ))}
            </div>
          </Card>

          {describedCount > 0 && (
            <Button
              onClick={handleDownloadTrainingData}
              disabled={downloading}
              className="w-full h-12 text-base font-semibold"
              size="lg"
            >
              {downloading ? (
                <>
                  <Loader2 className="animate-spin" /> Preparing ZIP...
                </>
              ) : (
                <>
                  <Download /> Download training data ({describedCount} items)
                </>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── LoRA Item Row ────────────────────────────────────────────────────────────

function LoraItemRow({
  item,
  index,
  triggerWord,
  onRetry,
  onEdit,
  onRemove,
  onPreview,
}: {
  item: LoraItem;
  index: number;
  triggerWord: string;
  onRetry: (id: string) => void;
  onEdit: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  onPreview: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.description ?? "");

  useEffect(() => {
    if (!editing) setDraft(item.description ?? "");
  }, [item.description, editing]);

  return (
    <div className="border-t border-card-border first:border-t-0 px-4 py-3 flex items-start gap-4 min-h-20">
      <div className="shrink-0 w-16 h-20 flex items-center justify-center">
        <img
          src={item.previewUrl}
          alt={`Image ${index + 1}`}
          className="w-16 h-20 object-cover rounded border border-card-border cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => onPreview(item.previewUrl)}
        />
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-20">
        <span className="text-xs font-mono text-muted mb-1">#{index + 1}</span>
        {item.describing ? (
          <span className="text-sm text-accent flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Describing...
          </span>
        ) : editing ? (
          <div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60px]"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                onClick={() => {
                  onEdit(item.id, draft);
                  setEditing(false);
                }}
                disabled={!draft.trim()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(item.description ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : item.description ? (
          <p
            className="text-sm text-foreground/80 leading-relaxed cursor-pointer hover:text-foreground transition-colors"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {item.description}
          </p>
        ) : item.error ? (
          <p className="text-sm text-error">{item.error}</p>
        ) : (
          <p className="text-sm text-muted italic">No description yet</p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5 min-w-[100px] w-[100px]">
        {item.description && !editing && !item.describing && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {!item.describing && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onRetry(item.id)}
            disabled={!triggerWord.trim()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {item.description ? "Retry" : "Describe"}
          </Button>
        )}
        {!item.describing && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted hover:text-error"
            onClick={() => onRemove(item.id)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
