/** Ekstensi installer / paket aplikasi (Android, iOS, Windows, web extension, dll.) */
export const APP_INSTALL_EXTENSIONS = new Set([
  "apk",
  "apks",
  "xapk",
  "aab",
  "ipa",
  "app",
  "dmg",
  "pkg",
  "exe",
  "msi",
  "msix",
  "msixbundle",
  "appx",
  "appxbundle",
  "cab",
  "deb",
  "rpm",
  "appimage",
  "crx",
  "xpi",
  "nex",
]);

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

export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

export function appPlatformLabel(ext: string): string {
  if (["apk", "apks", "xapk", "aab"].includes(ext)) return "Android";
  if (["ipa", "app", "dmg", "pkg"].includes(ext)) return "iOS / Apple";
  if (["exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "cab"].includes(ext)) return "Windows";
  if (["deb", "rpm", "appimage"].includes(ext)) return "Linux";
  if (["crx", "xpi", "nex"].includes(ext)) return "Ekstensi browser / web";
  return "Aplikasi";
}

function stemFromAppFileName(fileName: string): string {
  const ext = fileExtension(fileName);
  if (ext && APP_INSTALL_EXTENSIONS.has(ext)) {
    return fileName.slice(0, -(ext.length + 1)).trim();
  }
  return fileName.replace(/\.[^.]+$/i, "").trim();
}

/** Nama tampilan dari nama file installer (tanpa membuka isi paket). */
export function appDisplayNameFromFilename(fileName: string): string {
  const stem = stemFromAppFileName(fileName);
  if (!stem) return "Aplikasi";

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

const APP_MIME_HINTS = new Set([
  "application/vnd.android.package-archive",
  "application/x-msdownload",
  "application/x-msi",
  "application/vnd.ms-appx",
  "application/vnd.apple.installer+xml",
]);

export function isAppInstallFileName(fileName: string, mime?: string): boolean {
  const ext = fileExtension(fileName);
  if (APP_INSTALL_EXTENSIONS.has(ext)) return true;
  const m = (mime || "").toLowerCase();
  if (APP_MIME_HINTS.has(m)) return true;
  if (m === "application/octet-stream" && (ext === "exe" || ext === "apk" || ext === "ipa")) return true;
  return false;
}

/** @deprecated gunakan isAppInstallFileName */
export function isApkFileName(fileName: string, mime?: string): boolean {
  return isAppInstallFileName(fileName, mime);
}

/** Teks untuk model: analisis phishing dari nama aplikasi saja. */
export function buildAppFilenameAnalysisText(fileName: string, appName: string): string {
  const ext = fileExtension(fileName);
  const platform = appPlatformLabel(ext);
  return `[Pemeriksaan file aplikasi (${platform}) — hanya berdasarkan nama file / nama aplikasi, bukan isi installer]

File: ${fileName}
Nama aplikasi (diturunkan dari nama file): ${appName}

Tugas: nilai apakah aplikasi ini berpotensi phishing atau penipuan yang meniru BCA, Halo BCA, myBCA, atau layanan perbankan resmi di Indonesia. Pertimbangkan ejaan mirip, kata "BCA", "bank", "verifikasi", "CS", "klaim hadiah", dll. Jika nama aplikasi tidak terkait perbankan/BCA sama sekali, gunakan verdict "irrelevant".`;
}

/** Nilai atribut `accept` pada input file tab File. */
export function buildFileInputAccept(): string {
  const docs = [".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".json"];
  const apps = [...APP_INSTALL_EXTENSIONS].map((e) => `.${e}`);
  const mimes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.android.package-archive",
    "application/x-msdownload",
    "text/plain",
  ];
  return [...docs, ...apps, ...mimes].join(",");
}
