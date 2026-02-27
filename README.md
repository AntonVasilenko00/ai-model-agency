# AI Model Agency — Dataset Generator

Generate consistent AI image datasets by uploading a source photo and 30 reference images. The app describes each reference with OpenAI Vision, then generates matching images of the source person via Nano Banana Pro.

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in your API keys in .env.local
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key (needs vision-capable model access) |
| `NANO_BANANA_PRO_API_KEY` | Yes | Nano Banana Pro API key |
| `NANO_BANANA_PRO_BASE_URL` | No | Defaults to `https://gateway.bananapro.site` |

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Workflow

1. Upload a **source photo** (the identity reference).
2. Upload **30 dataset images** across three categories:
   - **Face** (10) — close-up face shots
   - **Face + Body** (10) — upper body with face
   - **Full Body** (10) — full body shots
3. Click **Generate Dataset**.
4. The app describes each of the 30 images using OpenAI, then generates 30 images of the source person matching those descriptions.
5. Download individual images or the full set as a ZIP.

## Project Structure

```
src/
  app/
    page.tsx                    # Main UI
    api/
      upload/route.ts           # Handle file uploads
      jobs/route.ts             # Start generation pipeline
      jobs/[id]/route.ts        # Poll job status
      jobs/[id]/zip/route.ts    # Download all as ZIP
      download/route.ts         # Download single image
  lib/
    types.ts                    # Shared types
    storage.ts                  # File I/O helpers
    openai.ts                   # OpenAI Vision descriptions
    nano-banana-pro.ts          # Image generation + polling
    job-store.ts                # In-memory job state
    pipeline.ts                 # Orchestration logic
data/                           # Runtime uploads & output (gitignored)
```
