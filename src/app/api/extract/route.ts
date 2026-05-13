import { NextResponse } from "next/server";
import mammoth from "mammoth";
/** Entry `pdf-parse` menjalankan skrip debug saat `module.parent` kosong — pakai lib agar aman di bundle. */
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 24 * 1024 * 1024;

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function isTextLike(ext: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  return ["txt", "md", "csv", "json"].includes(ext);
}

export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Unggahan tidak valid." }, { status: 400 });
  }

  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "File wajib dipilih." }, { status: 400 });
  }

  if (entry.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File terlalu besar (maks ${MAX_FILE_BYTES / (1024 * 1024)} MB).` },
      { status: 400 },
    );
  }

  const name = entry.name || "upload";
  const mime = (entry.type || "application/octet-stream").toLowerCase();
  const ext = extOf(name);

  try {
    const buf = Buffer.from(await entry.arrayBuffer());

    if (ext === "pdf" || mime === "application/pdf") {
      const r = await pdfParse(buf);
      const text = typeof r.text === "string" ? r.text.trim() : "";
      return NextResponse.json({ text });
    }

    if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const r = await mammoth.extractRawText({ buffer: buf });
      const text = typeof r.value === "string" ? r.value.trim() : "";
      return NextResponse.json({ text });
    }

    if (isTextLike(ext, mime)) {
      const text = buf.toString("utf8").trim();
      return NextResponse.json({ text });
    }

    if (ext === "apk" || mime === "application/vnd.android.package-archive") {
      return NextResponse.json(
        { error: "File aplikasi (APK) belum didukung untuk dibaca teksnya. Coba unggah PDF/DOCX/TXT." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Format file belum didukung. Coba PDF, DOCX, atau TXT." },
      { status: 400 },
    );
  } catch {
    return NextResponse.json({ error: "Gagal membaca isi file." }, { status: 400 });
  }
}

