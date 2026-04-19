"use client";

/**
 * OCR browser (Tesseract) untuk preview & skor kualitas teks.
 * Vision OpenAI tetap dipakai untuk klasifikasi; OCR ini untuk transparansi & penalti confidence.
 */
export type OcrOutcome = {
  text: string;
  /** Rata-rata confidence Tesseract 0–100 jika tersedia */
  meanConfidence: number;
  usedMock: boolean;
  note?: string;
};

export function mockOcrFallback(): string {
  return "[OCR mock] Tidak ada teks yang terbaca — unggah gambar yang lebih jelas.";
}

export async function extractTextFromImageClient(file: File): Promise<OcrOutcome> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["eng", "ind"], 1, {
      logger: () => undefined,
    });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const text = (data.text || "").replace(/\s+/g, " ").trim();
    const conf =
      typeof data.confidence === "number" && Number.isFinite(data.confidence) ? data.confidence : 0;
    if (text.length < 3) {
      return {
        text: "",
        meanConfidence: conf || 0,
        usedMock: false,
        note: "OCR hampir kosong — confidence gambar dianggap rendah.",
      };
    }
    return { text, meanConfidence: conf || 55, usedMock: false };
  } catch (err) {
    return {
      text: "",
      meanConfidence: 0,
      usedMock: true,
      note: err instanceof Error ? err.message : "OCR gagal di browser.",
    };
  }
}
