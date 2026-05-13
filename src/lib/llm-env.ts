import type { ClientOptions } from "openai";

/** Kunci untuk penyedia kompatibel OpenAI (Groq, OpenRouter, …). Fallback ke nama lama. */
export function resolveLlmApiKey(): string | undefined {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
}

function openRouterHeaders(): Partial<Pick<ClientOptions, "defaultHeaders">> {
  const ref = process.env.OPENROUTER_REFERER?.trim();
  const title = process.env.OPENROUTER_TITLE?.trim();
  if (!ref && !title) return {};
  const defaultHeaders: Record<string, string> = {};
  if (ref) defaultHeaders["HTTP-Referer"] = ref;
  if (title) defaultHeaders["X-Title"] = title;
  return { defaultHeaders };
}

/** Opsi client SDK `openai` untuk host kompatibel (bukan hanya api.openai.com). */
export function openAiCompatibleClientOptions(
  apiKey: string,
  opts?: { organization?: string; project?: string },
): ClientOptions {
  return {
    apiKey,
    organization: opts?.organization ?? (process.env.OPENAI_ORG_ID?.trim() || undefined),
    project: opts?.project ?? (process.env.OPENAI_PROJECT_ID?.trim() || undefined),
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    ...openRouterHeaders(),
  };
}
