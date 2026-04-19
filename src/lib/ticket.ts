const STORAGE_KEY = "hbca-ticket-seq";

/**
 * ID tiket deterministik per sesi browser & per hari kalender lokal:
 * HBCA-YYYYMMDD-001, HBCA-YYYYMMDD-002, ...
 */
export function nextHBCATicketId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  if (typeof window === "undefined") {
    return `HBCA-${ymd}-001`;
  }

  const key = `${STORAGE_KEY}:${ymd}`;
  const prev = Number.parseInt(sessionStorage.getItem(key) || "0", 10) || 0;
  const next = prev + 1;
  sessionStorage.setItem(key, String(next));
  return `HBCA-${ymd}-${String(next).padStart(3, "0")}`;
}
