import { NextResponse } from "next/server";
import { resolveLlmApiKey } from "@/lib/llm-env";
import { analyzeWithOpenAI, mapOpenAIError } from "@/lib/openai-analyze";
import { applyScoringToAnalysis } from "@/lib/scoring-engine";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 20_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type Body = {
  text?: string;
  source?: "text" | "image" | "voice";
  imageBase64?: string;
  mimeType?: string;
  clientOcrText?: string;
  /** Heuristik 0–1 dari klien */
  clientOcrQuality?: number;
  /** Rata-rata confidence Tesseract 0–100 */
  clientOcrMeanConfidence?: number;
};

export async function POST(req: Request) {
  const apiKey = resolveLlmApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Layanan analisis belum siap. Coba lagi nanti atau hubungi admin.",
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid." }, { status: 400 });
  }

  const source: "text" | "image" | "voice" =
    body.source === "image" ? "image" : body.source === "voice" ? "voice" : "text";
  const organization = process.env.OPENAI_ORG_ID?.trim() || undefined;
  const project = process.env.OPENAI_PROJECT_ID?.trim() || undefined;
  const model = process.env.OPENAI_MODEL?.trim() || undefined;

  const clientOcrText = typeof body.clientOcrText === "string" ? body.clientOcrText : "";
  const clientOcrQuality =
    typeof body.clientOcrQuality === "number" && Number.isFinite(body.clientOcrQuality)
      ? Math.min(1, Math.max(0, body.clientOcrQuality))
      : undefined;
  const clientOcrMeanConfidence =
    typeof body.clientOcrMeanConfidence === "number" && Number.isFinite(body.clientOcrMeanConfidence)
      ? body.clientOcrMeanConfidence
      : undefined;

  try {
    if (source === "image") {
      const b64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
      const mimeType =
        typeof body.mimeType === "string" && body.mimeType.trim()
          ? body.mimeType.trim()
          : "image/jpeg";

      if (!b64) {
        return NextResponse.json(
          { error: "Untuk tab Image, kirim imageBase64 (base64 tanpa prefix data:)." },
          { status: 400 },
        );
      }

      const approxBytes = Math.floor((b64.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: `Gambar terlalu besar (>${MAX_IMAGE_BYTES / (1024 * 1024)} MB setelah decode).` },
          { status: 400 },
        );
      }

      const raw = await analyzeWithOpenAI({
        apiKey,
        organization,
        project,
        model,
        source: "image",
        imageBase64: b64,
        mimeType,
        clientOcrText: clientOcrText || undefined,
        clientOcrQuality,
      });

      const scored = applyScoringToAnalysis(raw, {
        source: "image",
        inputTextForQuality: clientOcrText || raw.analyzedTextPreview,
        ocrCharCount: clientOcrText.trim().length,
        ocrConfidenceHint: clientOcrMeanConfidence,
      });

      return NextResponse.json(scored);
    }

    const text = typeof body.text === "string" ? body.text : "";
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Teks terlalu panjang (maks ${MAX_TEXT_CHARS} karakter).` },
        { status: 400 },
      );
    }
    if (!text.trim()) {
      return NextResponse.json({ error: "Teks kosong. Paste isi pesan dulu." }, { status: 400 });
    }

    const raw = await analyzeWithOpenAI({
      apiKey,
      organization,
      project,
      model,
      source: source === "voice" ? "voice" : "text",
      text,
    });

    const scored = applyScoringToAnalysis(raw, {
      source: source === "voice" ? "voice" : "text",
      inputTextForQuality: text,
    });

    return NextResponse.json(scored);
  } catch (e) {
    const message = mapOpenAIError(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
