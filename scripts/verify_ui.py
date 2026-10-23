"""Visual verification harness for Desel.

Seeds a realistic carousel into the browser-only store, screenshots the shell,
and exports every theme so the design system can be reviewed as images.
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path("shots")
OUT.mkdir(exist_ok=True)

SAMPLE = {
    "title": "10 Repo GitHub Paling Trending Hari Ini",
    "caption": "10 repo yang lagi naik daun minggu ini.\n\nSimpen dulu, dipake kapan-kapan.\n\n#github #coding #devtools",
    "themeId": "editorial",
    "aspect": "4:5",
    "brandHandle": "@desel.studio",
    "showSlideNumbers": True,
    "slides": [
        {
            "kind": "cover",
            "kicker": "SWIPE",
            "headline": "10 repo yang bakal *ngubah* cara lo ngoding",
            "subhead": "Semua open source. Semua gratis. Cek sampai habis.",
            "body": "",
            "items": [],
            "stat": None,
            "footer": "",
        },
        {
            "kind": "point",
            "kicker": "POIN 01",
            "headline": "Framework yang ngegabungin frontend dan backend",
            "subhead": "Satu repo, satu bahasa, nggak perlu mikir dua stack.",
            "body": "Cocok buat yang males setup server terpisah tapi tetap mau kontrol penuh.",
            "items": [],
            "stat": None,
            "footer": "",
        },
        {
            "kind": "list",
            "kicker": "BAGIAN 02",
            "headline": "Empat repo yang wajib lo bookmark",
            "subhead": "",
            "body": "",
            "items": [
                "vercel/next.js — React full-stack dengan server components",
                "tauri-apps/tauri — app desktop super ringan pakai Rust",
                "shadcn-ui/ui — komponen siap copy-paste, bukan library",
                "biomejs/biome — linter dan formatter dalam satu binary",
            ],
            "stat": None,
            "footer": "",
        },
        {
            "kind": "stat",
            "kicker": "DATA",
            "headline": "Repo paling banyak di-star minggu ini",
            "subhead": "Naik 40 persen dibanding minggu lalu, tanpa rilis besar.",
            "body": "",
            "items": [],
            "stat": {"value": "12.4k", "label": "star dalam 7 hari"},
            "footer": "",
        },
        {
            "kind": "quote",
            "kicker": "CATATAN",
            "headline": "Repo bagus itu yang bikin lo berhenti nulis kode sendiri",
            "subhead": "",
            "body": "Kalau ada yang udah nyelesaiin masalah lo dengan rapi, pakai aja. Waktu lo lebih berharga buat hal yang belum ada solusinya.",
            "items": [],
            "stat": None,
            "footer": "",
        },
        {
            "kind": "steps",
            "kicker": "CARA PAKAI",
            "headline": "Cara cek repo layak dipakai atau nggak",
            "subhead": "",
            "body": "",
            "items": [
                "Lihat commit terakhir, jangan yang nganggur setahun",
                "Baca issue terbuka, cek seberapa cepat maintainer jawab",
                "Coba di project kecil dulu sebelum masuk produksi",
            ],
            "stat": None,
            "footer": "",
        },
        {
            "kind": "cta",
            "kicker": "SIMPAN",
            "headline": "Simpen post ini biar nggak lupa",
            "subhead": "Follow buat list repo baru tiap minggu",
            "body": "",
            "items": [],
            "stat": None,
            "footer": "",
        },
    ],
}


def seed(page, doc):
    page.evaluate(
        """(doc) => {
            const raw = JSON.stringify(doc);
            localStorage.setItem('desel.seed', raw);
        }""",
        doc,
    )


def run(url: str):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1560, "height": 960}, device_scale_factor=1)
        errors = []
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(800)

        # Inject the sample doc through the store's public setter.
        page.evaluate(
            """(doc) => {
                const w = window;
                if (!w.__desel) { console.warn('no store handle'); return; }
                w.__desel.getState().replaceWith(doc);
                w.__desel.getState().setBrandHandle(doc.brandHandle);
                w.__desel.getState().setTheme(doc.themeId);
            }""",
            SAMPLE,
        )
        page.wait_for_timeout(700)
        page.screenshot(path=str(OUT / "01-shell.png"), full_page=False)

        # Slide rail tab
        page.get_by_role("button", name=lambda n: n and "Slides" in n).first.click()
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "02-slides.png"))

        # Style tab
        page.get_by_role("button", name="Style").first.click()
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "03-style.png"))

        print("errors:", errors[:10] if errors else "none")
        browser.close()


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:1420")
