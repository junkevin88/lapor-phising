import OpenAI from "openai";
import type { MatchedSignal, ModelAnalysisBeforeScoring, PhishingAnalysis, ReasoningStep, Verdict } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a fraud-awareness assistant for a banking help-center *demo* (not a real bank).
Classify user-submitted content as phishing/scam risk for Indonesian and English messages (and text visible in screenshots).

Return a single JSON object ONLY (no markdown), with exactly these keys:
- "verdict": one of "safe", "suspicious", "likely_phishing"
- "confidence": number from 0 to 1 (your subjective estimate BEFORE any server-side math — server will blend this with weighted signals)
- "confidence_rationale": short explanation (plain language)
- "signals": array of objects. Each MUST have: "id" (snake_case), "label" (short), "weight" (integer 1-10 importance of this red flag), "detail" (one sentence). Use empty array if none. Higher weight = stronger scam indicator.
- "reasoning_steps": array of 4 to 7 objects for an EDUCATIONAL "behind the scenes" trace. Each: "step" (int), "title" (short), "detail" (1-2 sentences). Do NOT claim raw neural internals.
- "recommended_action": one short paragraph
- "analyzed_text_preview": trimmed excerpt of message OR transcription from image (max ~800 chars)

Verdict calibration:
- "likely_phishing": strong credential-theft / fake bank / malicious link / suspension threats.
- "suspicious": mixed or vague marketing, unclear sender, no explicit OTP/link threat.
- "safe": routine reminders, official-style, low pressure.

Rules:
- Never ask the user for real OTP/PIN/passwords.
- Prefer "suspicious" over "likely_phishing" when malicious links or OTP demands are NOT clearly present.`;

function verdictLabel(v: Verdict): string {
  if (v === "likely_phishing") return "Likely Phishing";
  if (v === "suspicious") return "Suspicious";
  return "Safe";
}

function coerceVerdict(v: unknown): Verdict {
  if (typeof v !== "string") return "suspicious";
  const x = v.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (x === "likely_phishing" || x === "phishing" || x === "scam" || x === "fraud") return "likely_phishing";
  if (x === "suspicious" || x === "spam" || x === "uncertain") return "suspicious";
  if (x === "safe" || x === "legitimate" || x === "benign") return "safe";
  return "suspicious";
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function parseSignals(raw: unknown): MatchedSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: MatchedSignal[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `signal_${i}`;
    const label = typeof o.label === "string" ? o.label : "Signal";
    let w = typeof o.weight === "number" ? o.weight : Number(o.weight);
    if (!Number.isFinite(w)) {
      const legacy = typeof o.points === "number" ? o.points : Number(o.points);
      w = Number.isFinite(legacy) ? legacy : 3;
    }
    const weight = Math.min(10, Math.max(1, Math.round(w)));
    const detail = typeof o.detail === "string" ? o.detail : "";
    out.push({ id, label, weight, detail: detail || label });
  });
  return out;
}

function parseReasoningSteps(raw: unknown): ReasoningStep[] {
  if (!Array.isArray(raw)) return [];
  const out: ReasoningStep[] = [];
  raw.forEach((item, i) => {
    if (typeof item === "string" && item.trim()) {
      out.push({ step: i + 1, title: `Step ${i + 1}`, detail: item.trim() });
      return;
    }
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    const stepNum =
      typeof o.step === "number" && Number.isFinite(o.step)
        ? Math.round(o.step)
        : typeof o.step === "string"
          ? parseInt(o.step, 10)
          : i + 1;
    const step = Number.isFinite(stepNum) ? stepNum : i + 1;
    const title =
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim()
        : typeof o.heading === "string" && o.heading.trim()
          ? o.heading.trim()
          : `Langkah ${i + 1}`;
    const detail =
      typeof o.detail === "string" && o.detail.trim()
        ? o.detail.trim()
        : typeof o.body === "string" && o.body.trim()
          ? o.body.trim()
          : "";
    if (!detail) return;
    out.push({ step, title, detail });
  });
  out.sort((a, b) => a.step - b.step);
  return out.slice(0, 10);
}

function fallbackReasoning(verdict: Verdict, source: "text" | "image" | "voice"): ReasoningStep[] {
  const src = source === "image" ? "gambar" : source === "voice" ? "transkrip suara" : "teks";
  return [
    { step: 1, title: "Input", detail: `Model menerima ${src} pengguna untuk penilaian risiko phishing/spam.` },
    {
      step: 2,
      title: "Respons",
      detail: "Tidak ada reasoning_steps terstruktur dari model; menampilkan ringkasan fallback.",
    },
    { step: 3, title: "Verdict", detail: `Klasifikasi: ${verdict}.` },
  ];
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body);
}

export function normalizeAiPayload(
  parsed: unknown,
  source: PhishingAnalysis["source"],
  ocrMeta: PhishingAnalysis["ocrMeta"],
): ModelAnalysisBeforeScoring {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned invalid JSON root.");
  }
  const o = parsed as Record<string, unknown>;
  const verdict = coerceVerdict(o.verdict);
  const modelConfidenceRaw = clamp01(
    typeof o.confidence === "number" ? o.confidence : Number(o.confidence),
  );
  const confidenceRationale =
    typeof o.confidence_rationale === "string" && o.confidence_rationale.trim()
      ? o.confidence_rationale.trim()
      : "No rationale provided by the model.";
  const signals = parseSignals(o.signals);
  const recommendedAction =
    typeof o.recommended_action === "string" && o.recommended_action.trim()
      ? o.recommended_action.trim()
      : "If unsure, verify through your bank’s official app or phone number on your card.";
  const previewRaw =
    typeof o.analyzed_text_preview === "string" ? o.analyzed_text_preview.trim() : "";
  const analyzedTextPreview =
    previewRaw.length > 1200 ? `${previewRaw.slice(0, 1200)}…` : previewRaw;

  let reasoningSteps = parseReasoningSteps(o.reasoning_steps);
  if (reasoningSteps.length === 0) {
    reasoningSteps = fallbackReasoning(verdict, source);
  }

  return {
    verdict,
    verdictLabel: verdictLabel(verdict),
    modelConfidenceRaw,
    confidenceRationale,
    signals,
    reasoningSteps,
    recommendedAction,
    source,
    analyzedTextPreview,
    ocrMeta,
  };
}

export type OpenAiAnalyzeParams = {
  apiKey: string;
  organization?: string;
  project?: string;
  model?: string;
  source: "text" | "image" | "voice";
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  /** OCR klien (Tesseract) untuk konteks + skor kualitas */
  clientOcrText?: string;
  clientOcrQuality?: number;
};

export async function analyzeWithOpenAI(params: OpenAiAnalyzeParams): Promise<ModelAnalysisBeforeScoring> {
  const model = params.model?.trim() || DEFAULT_MODEL;
  const client = new OpenAI({
    apiKey: params.apiKey,
    organization: params.organization,
    project: params.project,
  });

  const ocrBlock =
    params.source === "image" && (params.clientOcrText || params.clientOcrQuality != null)
      ? `\n\n[Auxiliary client OCR — Tesseract]\nQuality heuristic (0-1): ${params.clientOcrQuality ?? "n/a"}\nExtracted text:\n---\n${(params.clientOcrText || "").slice(0, 2500)}\n---\nUse image as primary; OCR may be noisy.`
      : "";

  const textBody =
    params.source === "voice"
      ? `This is a **transcript of a voice message or call recording** (may contain errors). Analyze for phishing / scam / spam risk:\n\n---\n${params.text ?? ""}\n---`
      : `Analyze the following message for phishing / scam / spam risk:\n\n---\n${params.text ?? ""}\n---`;

  const userParts: OpenAI.Chat.ChatCompletionContentPart[] =
    params.source === "image" && params.imageBase64 && params.mimeType
      ? [
          {
            type: "text",
            text: `Screenshot for scam/phishing risk check.${ocrBlock}`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${params.mimeType};base64,${params.imageBase64}`,
              detail: "high",
            },
          },
        ]
      : [
          {
            type: "text",
            text: textBody,
          },
        ];

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 2800,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userParts },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI.");

  let parsed: unknown;
  try {
    parsed = extractJsonObject(content);
  } catch {
    throw new Error("Could not parse JSON from model output.");
  }

  const ocrMeta: PhishingAnalysis["ocrMeta"] =
    params.source === "image"
      ? {
          usedMock: false,
          note: `Vision: ${model}`,
          clientOcrExcerpt: params.clientOcrText?.slice(0, 2000),
        }
      : undefined;

  return normalizeAiPayload(parsed, params.source, ocrMeta);
}

export function mapOpenAIError(err: unknown): string {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return "OpenAI API key ditolak (401). Periksa OPENAI_API_KEY di .env.local.";
    if (status === 429) return "Rate limit OpenAI (429). Coba lagi nanti.";
    if (status === 400) return "Permintaan ditolak oleh OpenAI (400). Cek format gambar/teks.";
  }
  if (err instanceof Error) return err.message;
  return "Gagal memanggil OpenAI.";
}
