"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquareText,
  Mic,
  Shield,
  Ticket,
} from "lucide-react";
import type { PhishingAnalysis, TicketPayload } from "@/lib/types";
import { ESCALATION_CONFIDENCE_THRESHOLD } from "@/lib/types";
import { extractTextFromImageClient } from "@/lib/ocr-client";
import { nextHBCATicketId } from "@/lib/ticket";

const MAX_IMAGE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_FILE_BYTES = 24 * 1024 * 1024;

type Tab = "text" | "image" | "voice";

type OcrUiState = {
  loading: boolean;
  text: string;
  meanConfidence: number;
  usedMock: boolean;
  note?: string;
};

const SAMPLE_PHISHING = `Yth nasabah yang terhormat, tim keamanan Bank mendeteksi aktivitas mencurigakan.
Segera verifikasi OTP dan PIN Anda di http://bit.ly/verify-secure-login agar akun tidak diblokir dalam 30 menit.
Customer Service Bank`;

const SAMPLE_AMBIGUOUS = `Halo, kami dari tim follow-up program kartu. Boleh minta waktu singkat untuk konfirmasi preferensi komunikasi Anda? Tidak perlu kirim data sensitif lewat chat ini.`;

const SAMPLE_SAFE = `Reminder: tagihan kartu kredit jatuh tempo 22 Apr 2026. Pembayaran dapat dilakukan melalui aplikasi resmi atau ATM.`;

function heuristicOcrQuality(text: string, meanConfidence: number): number {
  const len = text.trim().length;
  const lenF = Math.min(1, len / 220);
  const confF = meanConfidence > 0 ? Math.min(1, meanConfidence / 100) : 0.35;
  return Math.min(1, 0.55 * lenF + 0.45 * confF);
}

async function fileToBase64(file: File): Promise<{ imageBase64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Gagal membaca file gambar."));
    r.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Format data URL tidak dikenali.");
  const header = dataUrl.slice(0, comma);
  const imageBase64 = dataUrl.slice(comma + 1);
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch?.[1]?.trim() || file.type || "image/jpeg";
  return { imageBase64, mimeType };
}

function verdictStyles(verdict: PhishingAnalysis["verdict"]) {
  if (verdict === "likely_phishing") {
    return {
      ring: "ring-red-300",
      badge: "bg-red-100 text-red-900 border border-red-300",
      bar: "bg-red-600",
      cardBg: "bg-gradient-to-br from-red-50/95 via-white to-white",
      border: "border-red-200",
    };
  }
  if (verdict === "suspicious") {
    return {
      ring: "ring-amber-300",
      badge: "bg-amber-100 text-amber-950 border border-amber-300",
      bar: "bg-amber-500",
      cardBg: "bg-gradient-to-br from-amber-50/90 via-white to-white",
      border: "border-amber-200",
    };
  }
  return {
    ring: "ring-emerald-300",
    badge: "bg-emerald-100 text-emerald-950 border border-emerald-300",
    bar: "bg-emerald-600",
    cardBg: "bg-gradient-to-br from-emerald-50/90 via-white to-white",
    border: "border-emerald-200",
  };
}

function ticketCategory(v: PhishingAnalysis["verdict"]): string {
  if (v === "likely_phishing") return "FRAUD — Likely phishing / scam";
  if (v === "suspicious") return "FRAUD — Suspicious / needs review";
  return "INFO — Low risk / safe-ish";
}

function ticketPriority(v: PhishingAnalysis["verdict"]): TicketPayload["priority"] {
  if (v === "likely_phishing") return "HIGH";
  if (v === "suspicious") return "MEDIUM";
  return "LOW";
}

function ticketSummary(r: PhishingAnalysis): string {
  const head = r.analyzedTextPreview.split("\n")[0]?.slice(0, 120) || r.verdictLabel;
  const sig = r.signals[0]?.label;
  return [r.verdictLabel, sig ? `Signal: ${sig}` : null, head].filter(Boolean).join(" · ");
}

export default function ContactScamChecker() {
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrUiState>({
    loading: false,
    text: "",
    meanConfidence: 0,
    usedMock: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhishingAnalysis | null>(null);
  const [ticketPayload, setTicketPayload] = useState<TicketPayload | null>(null);
  const [ticketNote, setTicketNote] = useState("");
  const [ticketBusy, setTicketBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setOcr({ loading: false, text: "", meanConfidence: 0, usedMock: false });
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setOcr({ loading: true, text: "", meanConfidence: 0, usedMock: false });
    let cancelled = false;
    void (async () => {
      try {
        const r = await extractTextFromImageClient(file);
        if (cancelled) return;
        setOcr({
          loading: false,
          text: r.text,
          meanConfidence: r.meanConfidence,
          usedMock: r.usedMock,
          note: r.note,
        });
      } catch {
        if (cancelled) return;
        setOcr({
          loading: false,
          text: "",
          meanConfidence: 0,
          usedMock: true,
          note: "OCR error",
        });
      }
    })();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const needsEscalation = useMemo(() => {
    if (!result || ticketPayload) return false;
    return result.confidence < ESCALATION_CONFIDENCE_THRESHOLD;
  }, [result, ticketPayload]);

  type AnalyzePayload =
    | { source: "text"; text: string }
    | { source: "voice"; text: string }
    | {
        source: "image";
        imageBase64: string;
        mimeType: string;
        clientOcrText: string;
        clientOcrQuality: number;
        clientOcrMeanConfidence: number;
      };

  async function executeAnalyze(payload: AnalyzePayload): Promise<PhishingAnalysis> {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg =
        typeof j.error === "string"
          ? j.error
          : res.status === 503
            ? "Layanan analisis belum dikonfigurasi (API key)."
            : `Permintaan gagal (${res.status}).`;
      throw new Error(msg);
    }
    return (await res.json()) as PhishingAnalysis;
  }

  async function runAnalyze(payload: AnalyzePayload) {
    setLoading(true);
    setError(null);
    setTicketPayload(null);
    setTicketNote("");
    try {
      setResult(await executeAnalyze(payload));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Terjadi kesalahan jaringan atau server.");
    } finally {
      setLoading(false);
    }
  }

  async function onAnalyzeText() {
    if (!text.trim()) {
      setError("Isi teks dulu, atau gunakan tombol sample.");
      return;
    }
    await runAnalyze({ source: "text", text });
  }

  async function onVoiceTranscribeAndAnalyze() {
    if (!audioFile) {
      setError("Pilih file audio dulu (mp3, wav, m4a, webm, …).");
      return;
    }
    if (audioFile.size > MAX_AUDIO_FILE_BYTES) {
      setError(`Audio terlalu besar (maks ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB).`);
      return;
    }
    setLoading(true);
    setError(null);
    setTicketPayload(null);
    setTicketNote("");
    setVoiceTranscript("");
    try {
      const fd = new FormData();
      fd.append("file", audioFile);
      const tr = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!tr.ok) {
        const j = await tr.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Transkrip gagal (${tr.status}).`);
      }
      const raw = (await tr.json()) as { text?: string };
      const transcript = typeof raw.text === "string" ? raw.text.trim() : "";
      setVoiceTranscript(transcript);
      if (!transcript) {
        throw new Error("Transkrip kosong — coba file lain atau perjelas rekaman.");
      }
      setResult(await executeAnalyze({ source: "voice", text: transcript }));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Gagal transkrip atau analisis.");
    } finally {
      setLoading(false);
    }
  }

  async function onAnalyzeImage() {
    if (!file) {
      setError("Pilih file gambar (PNG/JPG) terlebih dahulu.");
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setError(`Ukuran file melebihi ${MAX_IMAGE_FILE_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    try {
      let ocrText = ocr.text;
      let meanConf = ocr.meanConfidence;
      if (ocr.loading) {
        const fresh = await extractTextFromImageClient(file);
        ocrText = fresh.text;
        meanConf = fresh.meanConfidence;
        setOcr({
          loading: false,
          text: fresh.text,
          meanConfidence: fresh.meanConfidence,
          usedMock: fresh.usedMock,
          note: fresh.note,
        });
      }
      const { imageBase64, mimeType } = await fileToBase64(file);
      const clientOcrQuality = heuristicOcrQuality(ocrText, meanConf);
      await runAnalyze({
        source: "image",
        imageBase64,
        mimeType,
        clientOcrText: ocrText,
        clientOcrQuality,
        clientOcrMeanConfidence: meanConf,
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Gagal memproses gambar.");
    }
  }

  function applySample(value: string) {
    setTab("text");
    setText(value);
    setFile(null);
    setPreviewUrl(null);
    setAudioFile(null);
    setVoiceTranscript("");
    setError(null);
    setResult(null);
    setTicketPayload(null);
    setTicketNote("");
  }

  async function createTicket() {
    if (!result) return;
    setTicketBusy(true);
    await new Promise((r) => setTimeout(r, 500));
    const id = nextHBCATicketId();
    const payload: TicketPayload = {
      id,
      category: ticketCategory(result.verdict),
      priority: ticketPriority(result.verdict),
      summary: ticketSummary(result),
      verdict: result.verdict,
      userNote: ticketNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    setTicketPayload(payload);
    setTicketBusy(false);
  }

  const styles = result ? verdictStyles(result.verdict) : null;

  return (
    <div className="min-h-full bg-[#F5F7F9] text-slate-800">
      <header className="bg-[#0a3a63] text-white shadow-md">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95 shadow-sm ring-1 ring-white/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- SVG statis di /public */}
              <img src="/bca-logo.svg" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">ContactGuard</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#0a3a63]">Periksa pesan</h2>
              <div className="inline-flex flex-wrap rounded-full bg-slate-100 p-1 text-sm font-medium text-slate-600">
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-full px-4 py-2 transition ${
                    tab === "text" ? "bg-white text-[#0a3a63] shadow-sm" : "hover:text-slate-800"
                  }`}
                  onClick={() => {
                    setTab("text");
                    setError(null);
                  }}
                >
                  <MessageSquareText className="h-4 w-4" />
                  Teks
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-full px-4 py-2 transition ${
                    tab === "image" ? "bg-white text-[#0a3a63] shadow-sm" : "hover:text-slate-800"
                  }`}
                  onClick={() => {
                    setTab("image");
                    setError(null);
                  }}
                >
                  <ImageIcon className="h-4 w-4" />
                  Gambar
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 rounded-full px-4 py-2 transition ${
                    tab === "voice" ? "bg-white text-[#0a3a63] shadow-sm" : "hover:text-slate-800"
                  }`}
                  onClick={() => {
                    setTab("voice");
                    setError(null);
                  }}
                >
                  <Mic className="h-4 w-4" />
                  Suara
                </button>
              </div>
            </div>

            {tab === "text" && (
              <div className="flex flex-col gap-2">
                <label htmlFor="msg" className="text-sm font-medium text-slate-700">
                  Teks mencurigakan
                </label>
                <textarea
                  id="msg"
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Tempel SMS, chat WA, email…"
                  className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none ring-sky-300 focus:border-sky-400 focus:bg-white focus:ring-2"
                />
              </div>
            )}

            {tab === "image" && (
              <div className="flex flex-col gap-3">
                <label htmlFor="img" className="text-sm font-medium text-slate-700">
                  Screenshot
                </label>
                <input
                  id="img"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFile(f ?? null);
                    setError(null);
                    setResult(null);
                    setTicketPayload(null);
                  }}
                  className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-sky-700"
                />
                {previewUrl && (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="Pratinjau unggahan" className="max-h-56 w-full object-contain" />
                  </div>
                )}
                {file && (
                  <details className="rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800">
                      OCR (Tesseract) — teks yang diekstrak di perangkat
                      {ocr.loading && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-sky-700">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Memproses…
                        </span>
                      )}
                    </summary>
                    <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
                      {ocr.usedMock && (
                        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-amber-900">
                          Mode fallback / error OCR — kualitas teks dianggap rendah untuk skor.
                        </p>
                      )}
                      {ocr.note && <p className="mb-2 text-slate-500">{ocr.note}</p>}
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 font-mono text-slate-100">
                        {ocr.text.trim() ? ocr.text : "(kosong atau belum terbaca)"}
                      </pre>
                      {ocr.meanConfidence > 0 && (
                        <p className="mt-2 text-slate-500">Rata-rata confidence OCR: {ocr.meanConfidence.toFixed(0)}%</p>
                      )}
                    </div>
                  </details>
                )}
                <p className="text-xs text-slate-500">
                  Vision (OpenAI) tetap dipakai untuk klasifikasi; OCR lokal untuk transparansi & penalti confidence jika
                  teks buruk.
                </p>
              </div>
            )}

            {tab === "voice" && (
              <div className="flex flex-col gap-3">
                <label htmlFor="aud" className="text-sm font-medium text-slate-700">
                  File rekaman
                </label>
                <input
                  id="aud"
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac,.opus"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setAudioFile(f ?? null);
                    setVoiceTranscript("");
                    setError(null);
                    setResult(null);
                    setTicketPayload(null);
                  }}
                  className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-sky-700"
                />
                {audioFile && (
                  <p className="text-xs text-slate-600">
                    Dipilih: <span className="font-medium">{audioFile.name}</span> ·{" "}
                    {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                )}
                {voiceTranscript && (
                  <details className="rounded-xl border border-slate-200 bg-slate-50" open>
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800">
                      Transkrip (gpt-4o-mini-transcribe)
                    </summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-slate-200 px-3 py-2 font-mono text-xs text-slate-800">
                      {voiceTranscript}
                    </pre>
                  </details>
                )}
                <p className="text-xs text-slate-500">
                  Transkrip memakai bahasa <strong>Indonesia (id)</strong> secara default agar tidak melenceng ke bahasa
                  lain — atur <code className="rounded bg-slate-100 px-1">OPENAI_TRANSCRIBE_LANGUAGE</code> /{" "}
                  <code className="rounded bg-slate-100 px-1">OPENAI_TRANSCRIBE_PROMPT</code> di{" "}
                  <code className="rounded bg-slate-100 px-1">.env.local</code> bila perlu.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                disabled={loading}
                onClick={
                  tab === "text" ? onAnalyzeText : tab === "image" ? onAnalyzeImage : onVoiceTranscribeAndAnalyze
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0072BC] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00619e] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                {tab === "voice" ? "Transkrip & analisis" : "Analisis"}
              </button>
              <span className="text-xs text-slate-500 sm:self-center">Sample cepat:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
                  onClick={() => applySample(SAMPLE_PHISHING)}
                >
                  Phishing
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                  onClick={() => applySample(SAMPLE_AMBIGUOUS)}
                >
                  Ambigu
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                  onClick={() => applySample(SAMPLE_SAFE)}
                >
                  Aman
                </button>
              </div>
            </div>

            {loading && (
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
                {tab === "image"
                  ? "Mengirim gambar + konteks OCR ke server…"
                  : tab === "voice"
                    ? "Mentranskrip audio lalu menganalisis…"
                    : "Mengirim teks ke model & mesin skor…"}
              </p>
            )}

            {error && (
              <div
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Tidak bisa menganalisis</p>
                  <p className="mt-0.5 text-red-800/90">{error}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {!result && !loading && !error && (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-600">
            <p className="font-medium text-slate-700">Belum ada laporan</p>
            <p className="mt-2 max-w-md mx-auto">
              Pilih tab <strong>Teks</strong>, <strong>Gambar</strong>, atau <strong>Suara</strong>, lalu jalankan analisis.
              Pastikan <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code> ada di{" "}
              <code className="rounded bg-slate-100 px-1">.env.local</code>.
            </p>
          </section>
        )}

        {result && styles && (
          <section
            className={`rounded-2xl border-2 p-5 shadow-md ring-2 ${styles.border} ${styles.ring} ${styles.cardBg}`}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verdict</p>
                  <p className="text-2xl font-bold text-[#0a3a63]">{result.verdictLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.source === "voice" && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 ring-1 ring-violet-200">
                      Sumber: suara
                    </span>
                  )}
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles.badge}`}>
                    Confidence akhir {(result.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200/80 bg-white/80 px-3 py-2 text-xs text-slate-600">
                <span className="font-medium text-slate-700">Confidence model (mentah):</span>{" "}
                {(result.scoring.modelConfidenceRaw * 100).toFixed(0)}% →{" "}
                <span className="font-medium text-slate-700">setelah mesin skor:</span>{" "}
                {(result.scoring.computedConfidence * 100).toFixed(0)}%
              </div>

              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>Meter confidence (untuk tiket manual)</span>
                  <span>Ambang {ESCALATION_CONFIDENCE_THRESHOLD * 100}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                  <div
                    className={`h-full rounded-full transition-all ${styles.bar}`}
                    style={{ width: `${Math.min(100, result.confidence * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-600">{result.confidenceRationale}</p>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white/90">
                <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-[#0a3a63]">
                  Breakdown skor — indikator & bobot
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[280px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="px-3 py-2 font-medium">Indikator</th>
                        <th className="px-3 py-2 font-medium">Bobot</th>
                        <th className="px-3 py-2 font-medium">Kumulatif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.scoring.rows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-slate-500">
                            Tidak ada sinyal terbobot — total bobot 0.
                          </td>
                        </tr>
                      ) : (
                        result.scoring.rows.map((row) => (
                          <tr key={row.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2 align-top text-slate-800">
                              <span className="font-medium">{row.label}</span>
                              <p className="mt-0.5 text-slate-500">{row.detail}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{row.weight}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">
                              {row.cumulativeWeight}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1 border-t border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
                  <p>
                    <strong>Total bobot:</strong> {result.scoring.totalWeight} · <strong>Rasio / ref:</strong>{" "}
                    {(result.scoring.weightRatio * 100).toFixed(0)}% (÷ {result.scoring.maxWeightReference})
                  </p>
                  <p>
                    <strong>Kualitas teks/OCR:</strong> {(result.scoring.textQuality * 100).toFixed(0)}% —{" "}
                    {result.scoring.textQualityExplanation}
                  </p>
                  {result.scoring.ocrPenaltyApplied && (
                    <p className="font-medium text-amber-800">Penalti OCR / teks pendek diterapkan (×0.88).</p>
                  )}
                  <p className="text-slate-500">{result.scoring.formulaNote}</p>
                </div>
              </div>

              <details
                open
                className="group rounded-xl border border-indigo-100 bg-indigo-50/50 text-slate-800 ring-1 ring-indigo-100/80"
              >
                <summary className="cursor-pointer list-none px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-indigo-950">
                      <Layers className="h-4 w-4 shrink-0 text-indigo-700" aria-hidden />
                      Behind the scenes (narasi model)
                    </span>
                    <ChevronRight className="h-4 w-4 text-indigo-600 transition group-open:rotate-90" />
                  </div>
                </summary>
                <div className="border-t border-indigo-100 px-3 pb-3 pt-1">
                  <p className="mb-3 text-xs leading-relaxed text-slate-600">
                    Narasi edukatif, bukan aktivasi internal model.
                  </p>
                  <ol className="space-y-3">
                    {result.reasoningSteps.map((r) => (
                      <li key={`${r.step}-${r.title}`} className="flex gap-3 text-sm">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-200 text-xs font-bold text-indigo-950">
                          {r.step}
                        </span>
                        <div>
                          <p className="font-semibold text-indigo-950">{r.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{r.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>

              <div>
                <p className="mb-2 text-sm font-semibold text-[#0a3a63]">Red flags (dari model)</p>
                {result.signals.length === 0 ? (
                  <p className="text-sm text-slate-600">Tidak ada daftar sinyal dari model.</p>
                ) : (
                  <ul className="space-y-2">
                    {result.signals.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-slate-100 bg-white/90 px-3 py-2 text-sm text-slate-800"
                      >
                        <span className="font-semibold text-slate-900">{s.label}</span>
                        <span className="text-slate-500"> · bobot {s.weight}</span>
                        <p className="text-xs text-slate-600">{s.detail}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2 text-sm text-slate-800">
                <p className="font-semibold text-[#0a3a63]">Rekomendasi tindakan</p>
                <p className="mt-1">{result.recommendedAction}</p>
              </div>

              {result.source === "image" && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Transkrip vision (preview)</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900/95 p-3 text-xs text-slate-100">
                    {result.analyzedTextPreview || "(kosong)"}
                  </pre>
                  {result.ocrMeta?.note && <p className="mt-1 text-xs text-slate-600">{result.ocrMeta.note}</p>}
                </div>
              )}

              {(result.source === "text" || result.source === "voice") && result.analyzedTextPreview && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    {result.source === "voice" ? "Cuplikan transkrip" : "Cuplikan teks"}
                  </p>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white/90 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
                    {result.analyzedTextPreview}
                  </pre>
                </div>
              )}
            </div>
          </section>
        )}

        {needsEscalation && result && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/95 p-5 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-amber-950">
                <Ticket className="h-5 w-5" />
                <h3 className="text-base font-semibold">Review manual disarankan</h3>
              </div>
              <p className="text-sm text-amber-950/90">
                Confidence akhir di bawah {(ESCALATION_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%. Isi form ringkas
                (simulasi) lalu buat tiket.
              </p>
              <div className="grid gap-3 rounded-xl border border-amber-200/80 bg-white/90 p-4 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Kategori</p>
                  <p className="font-medium text-slate-900">{ticketCategory(result.verdict)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Prioritas</p>
                  <p className="font-medium text-slate-900">{ticketPriority(result.verdict)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Ringkasan otomatis</p>
                  <p className="text-slate-800">{ticketSummary(result)}</p>
                </div>
                <div>
                  <label htmlFor="note" className="text-xs font-medium uppercase text-slate-500">
                    Catatan untuk agen (opsional)
                  </label>
                  <textarea
                    id="note"
                    rows={3}
                    value={ticketNote}
                    onChange={(e) => setTicketNote(e.target.value)}
                    placeholder="Contoh: Saya ragu karena nomor pengirim tidak dikenal…"
                    className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={ticketBusy}
                onClick={createTicket}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a3a63] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#082f52] disabled:opacity-60 sm:w-auto"
              >
                {ticketBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                Buat tiket (simulasi) — Halo BCA Agent
              </button>
            </div>
          </section>
        )}

        {ticketPayload && (
          <section className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/95 p-5 shadow-md">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-700" />
              <div className="min-w-0 flex-1 text-sm text-emerald-950">
                <h3 className="text-base font-semibold">Tiket berhasil dibuat (lokal)</h3>
                <p className="mt-2 font-mono text-base font-bold tracking-tight">{ticketPayload.id}</p>
                <dl className="mt-3 grid gap-2 text-emerald-900/95">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-emerald-800/80">Kategori</dt>
                    <dd>{ticketPayload.category}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-emerald-800/80">Prioritas</dt>
                    <dd>{ticketPayload.priority}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-emerald-800/80">Ringkasan</dt>
                    <dd className="break-words">{ticketPayload.summary}</dd>
                  </div>
                  {ticketPayload.userNote && (
                    <div>
                      <dt className="text-xs font-semibold uppercase text-emerald-800/80">Catatan pengguna</dt>
                      <dd className="whitespace-pre-wrap break-words">{ticketPayload.userNote}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-semibold uppercase text-emerald-800/80">Waktu</dt>
                    <dd className="font-mono text-xs">{ticketPayload.createdAt}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>
        )}

        <footer className="pb-8 text-center text-sm font-medium tracking-wide text-slate-500">BIC 2026</footer>
      </main>
    </div>
  );
}
