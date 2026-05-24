/** Phishing / bukan phishing / di luar cakupan (bukan konteks penilaian BCA & scam). */
export type Verdict = "irrelevant" | "phishing" | "not_phishing";

export type MatchedSignal = {
  id: string;
  label: string;
  /** Bobot indikator (1–10) untuk mesin skor yang bisa dijelaskan */
  weight: number;
  detail: string;
};

export type ReasoningStep = {
  step: number;
  title: string;
  detail: string;
};

/** Baris tabel breakdown skor */
export type ScoreRow = {
  id: string;
  label: string;
  detail: string;
  weight: number;
  cumulativeWeight: number;
};

export type ScoringBreakdown = {
  rows: ScoreRow[];
  totalWeight: number;
  /** Pembagi normalisasi (konstanta dokumentasi) */
  maxWeightReference: number;
  weightRatio: number;
  /** 0 = buruk/kosong, 1 = cukup panjang & andal */
  textQuality: number;
  textQualityExplanation: string;
  /** Confidence mentah dari model (sebelum penyesuaian mesin) */
  modelConfidenceRaw: number;
  /** Confidence akhir yang dipakai UI & ambang tiket */
  computedConfidence: number;
  /** Kalau OCR buruk, penalti diterapkan */
  ocrPenaltyApplied: boolean;
  formulaNote: string;
};

export type PhishingAnalysis = {
  verdict: Verdict;
  verdictLabel: string;
  /** Confidence final (gabungan mesin + kualitas teks; lihat scoring) */
  confidence: number;
  confidenceRationale: string;
  /** Jumlah bobot terpasang (alias totalWeight untuk ringkas) */
  riskPoints: number;
  signals: MatchedSignal[];
  reasoningSteps: ReasoningStep[];
  scoring: ScoringBreakdown;
  recommendedAction: string;
  source: "text" | "image" | "voice";
  analyzedTextPreview: string;
  ocrMeta?: {
    usedMock: boolean;
    note?: string;
    /** Teks OCR sisi klien (untuk audit; bisa kosong) */
    clientOcrExcerpt?: string;
  };
};

/** Hasil model sebelum mesin skor explainable diterapkan */
export type ModelAnalysisBeforeScoring = Omit<PhishingAnalysis, "confidence" | "riskPoints" | "scoring"> & {
  modelConfidenceRaw: number;
};

export const ESCALATION_CONFIDENCE_THRESHOLD = 0.75;

export type TicketPayload = {
  id: string;
  category: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  verdict: Verdict;
  userNote?: string;
  createdAt: string;
};
