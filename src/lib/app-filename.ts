const PACKAGE_SEGMENT_SKIP = new Set([
  "com",
  "org",
  "net",
  "io",
  "id",
  "co",
  "app",
  "apps",
  "android",
  "mobile",
  "www",
]);

function titleWord(word: string): string {
  if (!word) return word;
  if (word.length <= 3 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Nama tampilan yang masuk akal dari nama file APK (tanpa membuka isi paket). */
export function appDisplayNameFromFilename(fileName: string): string {
  const stem = fileName.replace(/\.apk$/i, "").trim();
  if (!stem) return "Aplikasi Android";

  const looksLikePackage = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(stem);
  if (looksLikePackage) {
    const parts = stem
      .toLowerCase()
      .split(".")
      .filter((p) => p.length > 0 && !PACKAGE_SEGMENT_SKIP.has(p));
    if (parts.length === 0) {
      return stem.split(".").map(titleWord).join(" ");
    }
    return parts.map(titleWord).join(" ");
  }

  return stem
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(titleWord)
    .join(" ");
}

export function isApkFileName(fileName: string, mime?: string): boolean {
  const m = (mime || "").toLowerCase();
  return /\.apk$/i.test(fileName) || m === "application/vnd.android.package-archive";
}

/** Teks untuk model: analisis phishing dari nama aplikasi saja. */
export function buildAppFilenameAnalysisText(fileName: string, appName: string): string {
  return `[Pemeriksaan aplikasi Android — hanya berdasarkan nama file / nama aplikasi, bukan isi APK]

File: ${fileName}
Nama aplikasi (diturunkan dari nama file): ${appName}

Tugas: nilai apakah aplikasi ini berpotensi phishing atau penipuan yang meniru BCA, Halo BCA, myBCA, atau layanan perbankan resmi di Indonesia. Pertimbangkan ejaan mirip, kata "BCA", "bank", "verifikasi", "CS", "klaim hadiah", dll. Jika nama aplikasi tidak terkait perbankan/BCA sama sekali, gunakan verdict "irrelevant".`;
}
