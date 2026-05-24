"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CreditCard,
  Info,
  Landmark,
  PiggyBank,
  ShieldAlert,
  Smartphone,
} from "lucide-react";

const dummyTiles = [
  {
    icon: <Landmark className="h-8 w-8 text-sky-600" aria-hidden />,
    title: "Perbankan",
    desc: "Layanan terkait rekening, kartu debit, dan produk perbankan umum (demo).",
  },
  {
    icon: <CreditCard className="h-8 w-8 text-amber-600" aria-hidden />,
    title: "Kartu kredit",
    desc: "Informasi aktivasi, tagihan, dan limit (demo — tidak aktif).",
  },
  {
    icon: <Smartphone className="h-8 w-8 text-teal-600" aria-hidden />,
    title: "Paylater",
    desc: "Pengajuan dan informasi tagihan (demo — tidak aktif).",
  },
  {
    icon: <PiggyBank className="h-8 w-8 text-emerald-600" aria-hidden />,
    title: "Kredit konsumen",
    desc: "KPR dan pinjaman lainnya (demo — tidak aktif).",
  },
];

export default function HelpHubLanding() {
  const router = useRouter();

  return (
    <div className="min-h-full bg-[#e8ecf1] text-slate-800">
      {/* Bar atas — gaya Pusat Bantuan */}
      <header className="relative bg-[#0a3a63] pb-14 pt-3 text-white shadow-md">
        <div className="mx-auto grid max-w-lg grid-cols-[2.5rem_1fr_2.5rem] items-center px-3 py-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/10"
            aria-label="Kembali"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-center text-base font-semibold tracking-wide">Pusat Bantuan</h1>
          <span className="inline-block h-10 w-10" aria-hidden />
        </div>
      </header>

      {/* Kartu putih overlap */}
      <main className="relative z-10 mx-auto -mt-10 max-w-lg px-3 pb-12">
        <div className="rounded-t-[1.35rem] bg-white px-4 pb-8 pt-5 shadow-[0_-4px_24px_rgba(10,58,99,0.12)] ring-1 ring-slate-200/80 sm:px-5">
          <section
            className="mb-6 flex gap-3 rounded-2xl border border-sky-200/90 bg-sky-50 px-3 py-3 text-sm text-[#0a3a63]"
            role="status"
          >
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" aria-hidden />
            <p>Layanan ini bebas pulsa dan menggunakan jaringan internet.</p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-base font-bold text-[#0a3a63]">Layanan Telepon Halo BCA</h2>
            <div className="grid grid-cols-2 gap-3">
              {dummyTiles.map((t) => (
                <div
                  key={t.title}
                  className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm"
                  role="presentation"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50">{t.icon}</div>
                  <p className="text-sm font-bold text-[#0072BC]">{t.title}</p>
                  <p className="text-xs leading-snug text-slate-500">{t.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-base font-bold text-[#0a3a63]">Layanan digital</h2>
            <Link
              href="/phishing"
              className="flex gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-sky-200 hover:shadow-md active:scale-[0.99]"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-inner">
                <ShieldAlert className="h-7 w-7" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#0072BC]">TANYA AI</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Periksa pesan mencurigakan lewat teks, gambar, atau file untuk pemeriksaan cepat (demo).
                </p>
                <p className="mt-2 text-xs font-medium text-sky-700">Ketuk untuk membuka alat →</p>
              </div>
            </Link>
          </section>

          <section>
            <h2 className="text-base font-bold text-[#0a3a63]">Informasi lainnya</h2>
            <p className="mt-2 text-xs text-slate-400">Konten tambahan hanya placeholder untuk tampilan demo.</p>
          </section>
        </div>

        <p className="mt-6 text-center text-[10px] text-slate-400">
          Tampilan diilhami menu bantuan perbankan; ini PoC edukasi, bukan aplikasi resmi bank.
        </p>
      </main>
    </div>
  );
}
