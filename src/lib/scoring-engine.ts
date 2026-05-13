import type {
  MatchedSignal,
  ModelAnalysisBeforeScoring,
  PhishingAnalysis,
  ScoreRow,
  ScoringBreakdown,
  Verdict,
} from "./types";

/** Pembagi dokumentasi: jumlah bobot “sangat tinggi” untuk normalisasi rasio */
export const MAX_WEIGHT_REFERENCE = 42;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/**
 * Kualitas teks untuk skor penjelasan: panjang + (untuk OCR) penalti jika sangat pendek.
 */
export function assessTextQuality(
  text: string,
  source: "text" | "image" | "voice",
  ocrCharCount?: number,
  ocrConfidenceHint?: number,
): { quality: number; explanation: string } {
  const len = source === "image" ? (ocrCharCount ?? text.trim().length) : text.trim().length;
  const base = clamp01(len / 280);
  let quality = 0.25 + 0.75 * Math.pow(base, 0.85);
  let explanation =
    source === "image"
      ? `OCR / ekstraksi klien ~${len} karakter → faktor kelengkapan ${(quality * 100).toFixed(0)}%.`
      : source === "voice"
        ? `Panjang transkrip suara ${len} karakter → faktor kelengkapan ${(quality * 100).toFixed(0)}% (referensi ~280+ karakter = penuh).`
        : `Panjang teks ${len} karakter → faktor kelengkapan ${(quality * 100).toFixed(0)}% (referensi ~280+ karakter = penuh).`;

  if (source === "image" && typeof ocrConfidenceHint === "number" && ocrConfidenceHint > 0) {
    const ocrBoost = clamp01(ocrConfidenceHint / 100) * 0.12;
    quality = clamp01(quality + ocrBoost);
    explanation += ` Rata-rata confidence OCR Tesseract ~${ocrConfidenceHint.toFixed(0)}% menaikkan sedikit skor.`;
  }

  if (len < 15) {
    quality *= 0.55;
    explanation += " **Penalti:** teks hampir kosong atau terlalu pendek — confidence keseluruhan akan diturunkan.";
  } else if (len < 45) {
    quality *= 0.78;
    explanation += " Penalti ringan: teks pendek, konteks terbatas.";
  }

  return { quality: clamp01(quality), explanation };
}

function buildRows(signals: MatchedSignal[]): ScoreRow[] {
  let cum = 0;
  return signals.map((s) => {
    cum += s.weight;
    return {
      id: s.id,
      label: s.label,
      detail: s.detail,
      weight: s.weight,
      cumulativeWeight: cum,
    };
  });
}

/**
 * Confidence akhir: kombinasi confidence model + rasio bobot sinyal + kualitas teks/OCR.
 * Transparan untuk demo akademik (bukan ground truth statistik).
 */
export function computeExplainableScoring(
  verdict: Verdict,
  signals: MatchedSignal[],
  modelConfidenceRaw: number,
  textQuality: number,
  ocrPenaltyApplied: boolean,
): ScoringBreakdown {
  const rows = buildRows(signals);
  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  const weightRatio = clamp01(totalWeight / MAX_WEIGHT_REFERENCE);
  const m = clamp01(modelConfidenceRaw);
  const q = clamp01(textQuality);

  let computed: number;
  let formulaNote: string;

  if (verdict === "phishing") {
    computed = 0.52 * m + 0.28 * weightRatio + 0.2 * q;
    formulaNote =
      "phishing: 0.52×confidence_model + 0.28×(totalBobot/42) + 0.20×kualitas_teks — bukti bobot tinggi menaikkan keyakinan laporan.";
  } else if (verdict === "not_phishing") {
    computed = 0.48 * m + 0.17 * (1 - weightRatio) + 0.35 * q;
    formulaNote =
      "not_phishing: 0.48×confidence_model + 0.17×(1−totalBobot/42) + 0.35×kualitas_teks — sedikit bobot + teks jelas → lebih percaya diri “bukan phising”.";
  } else {
    computed = 0.42 * m + 0.12 * weightRatio + 0.46 * q;
    formulaNote =
      "irrelevant: 0.42×confidence_model + 0.12×(totalBobot/42) + 0.46×kualitas_teks — di luar cakupan; bobot sinyal scam biasanya rendah.";
  }

  if (ocrPenaltyApplied) {
    computed *= 0.88;
    formulaNote += " Lalu ×0.88 karena OCR lemah/kosong.";
  }

  computed = clamp01(computed);

  return {
    rows,
    totalWeight,
    maxWeightReference: MAX_WEIGHT_REFERENCE,
    weightRatio,
    textQuality: q,
    textQualityExplanation: "", // diisi caller
    modelConfidenceRaw: m,
    computedConfidence: computed,
    ocrPenaltyApplied,
    formulaNote,
  };
}

export function applyScoringToAnalysis(
  partial: ModelAnalysisBeforeScoring,
  opts: {
    source: "text" | "image" | "voice";
    inputTextForQuality: string;
    ocrCharCount?: number;
    ocrConfidenceHint?: number;
  },
): PhishingAnalysis {
  const { quality, explanation } = assessTextQuality(
    opts.inputTextForQuality,
    opts.source,
    opts.ocrCharCount,
    opts.ocrConfidenceHint,
  );

  const ocrPenaltyApplied =
    opts.source === "image" && (quality < 0.42 || (opts.ocrCharCount ?? 0) < 12);

  const scoring = computeExplainableScoring(
    partial.verdict,
    partial.signals,
    partial.modelConfidenceRaw,
    quality,
    ocrPenaltyApplied,
  );
  scoring.textQualityExplanation = explanation;

  const totalWeight = partial.signals.reduce((a, s) => a + s.weight, 0);
  const rationale =
    partial.confidenceRationale +
    (ocrPenaltyApplied
      ? " **Penyesuaian mesin:** OCR kurang memadai — confidence diturunkan agar eskalasi manusia lebih mungkin."
      : "");

  const { modelConfidenceRaw, ...rest } = partial;
  void modelConfidenceRaw;

  return {
    ...rest,
    confidence: scoring.computedConfidence,
    confidenceRationale: rationale,
    riskPoints: totalWeight,
    scoring,
  };
}
