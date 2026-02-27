import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { runGenerationForImage } from "@/lib/pipeline";

function streamEvent(
  encoder: TextEncoder,
  event: { type: string; [key: string]: unknown }
): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const label = body?.label;
  if (!label || typeof label !== "string") {
    return NextResponse.json(
      { error: "label is required" },
      { status: 400 }
    );
  }

  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.sourceImagePath) {
    return NextResponse.json(
      { error: "Source image is required. Upload a source photo first." },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(streamEvent(encoder, { type: "started", label }));
        controller.enqueue(
          streamEvent(encoder, { type: "progress", message: "Generating image with Nano Banana Pro..." })
        );

        const result = await runGenerationForImage(
          id,
          label,
          request.signal
        );

        if (result.cancelled) {
          controller.enqueue(streamEvent(encoder, { type: "cancelled", label }));
        } else {
          controller.enqueue(streamEvent(encoder, { type: "completed", label }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        controller.enqueue(
          streamEvent(encoder, { type: "error", message, label })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
