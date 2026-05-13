import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { openAiCompatibleClientOptions, resolveLlmApiKey } from "@/lib/llm-env";
import { mapOpenAIError } from "@/lib/openai-analyze";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function isLikelyAudio(mime: string, name: string): boolean {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/")) return true;
  if (m === "video/webm") return true;
  const low = name.toLowerCase();
  return /\.(mp3|mpeg|mpga|m4a|wav|webm|ogg|flac|opus)$/i.test(low);
}

export async function POST(req: Request) {
  const apiKey = resolveLlmApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Layanan transkrip belum siap. Coba lagi nanti atau hubungi admin." },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body harus multipart/form-data." }, { status: 400 });
  }

  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "Field `file` (audio) wajib diisi." }, { status: 400 });
  }

  if (entry.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `File audio terlalu besar (maks ${MAX_AUDIO_BYTES / (1024 * 1024)} MB).` },
      { status: 400 },
    );
  }

  const mime = entry.type || "application/octet-stream";
  if (!isLikelyAudio(mime, entry.name)) {
    return NextResponse.json(
      { error: "Format tidak dikenali. Gunakan mp3, wav, m4a, webm, ogg, atau flac." },
      { status: 400 },
    );
  }

  const model =
    process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe";

  /** ISO-639-1 — default `id` agar tidak salah deteksi ke Jepang/Inggris pada audio pendek */
  const language = (process.env.OPENAI_TRANSCRIBE_LANGUAGE?.trim() || "id").toLowerCase();
  const prompt =
    process.env.OPENAI_TRANSCRIBE_PROMPT?.trim() ||
    "Percakapan atau pesan suara dalam bahasa Indonesia, sering tentang bank, OTP, SMS, atau penipuan.";

  try {
    const buf = Buffer.from(await entry.arrayBuffer());
    const uploadable = await toFile(buf, entry.name || "audio.webm", { type: mime });

    const client = new OpenAI(openAiCompatibleClientOptions(apiKey));
    const transcription = await client.audio.transcriptions.create({
      file: uploadable,
      model,
      response_format: "json",
      language,
      prompt,
    });

    const text = typeof transcription.text === "string" ? transcription.text.trim() : "";
    return NextResponse.json({
      text,
      model,
      language,
    });
  } catch (e) {
    const message = mapOpenAIError(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
