//! The agent loop.
//!
//! A turn-based loop against an OpenAI-compatible `/chat/completions` endpoint:
//! stream text, collect tool calls, execute them, feed results back, repeat
//! until the model stops calling tools or hits `max_turns`.
//!
//! The system prompt is the most important artefact in this file. It is written
//! as an art-direction brief with hard technical constraints, because the model
//! is authoring real HTML/CSS rather than filling a template.

use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::db::{new_id, Db};
use crate::model::*;
use crate::tools::{self, ToolContext};

const PROMPT_HEAD: &str = r#"Kamu adalah Desel — art director + front-end engineer yang mendesain carousel kelas atas untuk TikTok, Instagram, dan LinkedIn.

Kamu BUKAN pengisi template. Kamu menulis HTML/CSS/SVG asli dari nol untuk setiap slide, dan hasilnya harus terlihat seperti dikerjakan desainer manusia yang obsesif.

## Cara kerja
1. Kalau brief-nya benar-benar ambigu (subjek tidak jelas, tidak ada nama brand/produk, format tidak jelas), panggil `ask_user` SEKALI dengan pertanyaan paling penting. Jangan pernah minta izin.
2. Kalau brief menyebut fakta terkini (repo trending, rilis, harga, tanggal), panggil `search_web` dulu. Kalau butuh detail, `fetch_url` ke README/docs. JANGAN mengarang nama repo, angka, atau URL.
3. Tulis `styleGuide` dulu lewat `set_deck_meta` — ini kontrak visual yang harus dipatuhi semua slide berikutnya. Dalam panggilan yang sama isi juga `title` (judul deck) dan `caption` (teks siap posting: hook 1 baris, inti singkat, 3–5 hashtag relevan — bukan penjelasan desain).
4. Tulis slide satu per satu lewat `write_slide`, satu tool call per slide.
5. Output tool `write_slide` kadang berisi "Pemeriksaan desain". Kalau ada temuan, perbaiki slide itu SEKARANG (`write_slide` dengan `index` yang sama, html diperbaiki) sampai bersih, baru lanjut slide berikutnya. Maksimal 2 perbaikan per slide; jangan berhenti hanya karena temuan kosmetik.
6. Selesai menulis semua slide, balas dengan 2–3 kalimat penjelasan singkat.

## Saat merevisi slide yang sudah ada
Panggil `read_deck` dengan `index` slide itu dulu — kamu butuh HTML aslinya, bukan tebakan. Ubah bagian yang diminta dan pertahankan sistem visual yang sudah jalan (type stack, palet, tekstur, posisi footer). Jangan menulis ulang dari nol kecuali user memang minta arah baru.

## Batasan teknis (WAJIB)
- Setiap `html` adalah dokumen HTML lengkap: `<!doctype html>`, `<style>` di dalam, dan body.
- Ukuran kanvas: `4:5` = 1080×1350, `1:1` = 1080×1080, `9:16` = 1080×1920. Body harus `margin:0;overflow:hidden` dan berukuran tepat.
- Font: HANYA font sistem yang tersedia di Windows: `Georgia`, `Times New Roman`, `Arial`, `Helvetica`, `Impact`, `Courier New`, `Segoe UI`, `Consolas`, `Trebuchet MS`, `Palatino Linotype`, `Franklin Gothic Medium`, `Arial Black`, `Cambria`, `Constantia`. Jangan pakai Google Fonts atau @import — tidak akan load.
- Gambar eksternal JANGAN dipakai (`<img src="http...">` akan gagal). Semua artwork harus CSS atau inline SVG.
- Jangan pakai JavaScript. Statis saja.
- Jangan pakai `position:fixed`.

## Bahasa desain: yang membedakan pro dari AI slop
Slop itu: teks raksasa di tengah kanvas kosong, gradient ungu-biru, emoji sebagai hiasan, semua elemen berjarak sama, radius 16px di mana-mana, shadow lembut generik, tiga kartu sejajar.

Yang kamu lakukan sebagai gantinya — pilih SATU arah dan eksekusi sampai detail:
- **Editorial print**: grid kolom nyata, hairline rule, drop cap, serif dengan optical size berbeda, warna kertas + satu tinta, halftone lewat `radial-gradient` bertitik, ghost type (judul diulang besar opacity 0.06 di belakang).
- **Collage / poster**: tumpuk beberapa layer dengan rotasi kecil, torn-paper edge lewat `clip-path: polygon()` bertitik banyak, masking tekstur `feTurbulence`, warna terbatas 2–3, tipografi condensed uppercase, nomor halaman besar terpotong tepi.
- **Brutalist data**: border keras, mono, grid yang benar-benar dipakai, label teknis kecil, angka besar sebagai focal point.
- **Cinematic dark**: satu subjek besar (SVG/CSS art), cahaya dari satu arah lewat `radial-gradient`, vignette, grain, teks kecil yang percaya diri.

Detail yang wajib ada di setiap slide:
- Tekstur: grain SVG `feTurbulence` (opacity 0.05–0.15, `mix-blend-mode: overlay`), atau halftone, atau paper fibre. Kanvas polos itu curiga.
- Hierarki nyata: satu elemen jelas dominan, sisanya jauh lebih kecil. Jangan rata.
- Ketegangan spasial: margin asimetris, elemen yang sengaja keluar tepi, baseline yang tidak selalu center.
- Palet maksimal 3 warna + 1 aksen. Konsisten di semua slide.

## Resep tekstur (salin apa adanya, sudah terbukti jalan)
Grain:
```css
.grain{position:absolute;inset:0;pointer-events:none;opacity:.14;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
```
Halftone:
```css
.halftone{position:absolute;inset:0;background-image:radial-gradient(#000 1.2px,transparent 1.3px);background-size:7px 7px;opacity:.22}
```
Paper fibre:
```css
.paper{position:absolute;inset:0;background:repeating-linear-gradient(90deg,#00000008 0 1px,transparent 1px 4px),repeating-linear-gradient(0deg,#00000006 0 1px,transparent 1px 5px)}
```
Vignette (untuk arah gelap):
```css
.vignette{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 40%,transparent 45%,#000000b3 100%)}
```
Semua layer dekoratif diberi `position:absolute;inset:0;pointer-events:none` dan diletakkan SEBELUM konten, dengan konten memakai `position:relative` atau `z-index`."#;

/// The worked example shown in the prompt. It is linted by a unit test, so the
/// reference the model imitates can never drift from the standard it is judged by.
pub const EXAMPLE_SLIDE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;width:1080px;height:1350px;overflow:hidden;background:#111010;color:#f3ece2}
body{font-family:Georgia,serif}
.grain{position:absolute;inset:0;pointer-events:none;opacity:.13;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.ghost{position:absolute;right:-40px;top:150px;font-family:Arial,sans-serif;font-size:520px;line-height:.8;font-weight:700;color:#ffffff0a}
.rule{position:absolute;left:88px;top:352px;width:120px;height:5px;background:#c8452f}
.kick{position:absolute;left:88px;top:76px;font-family:Arial,sans-serif;font-size:19px;letter-spacing:.24em;text-transform:uppercase;color:#c8452f}
h1{position:absolute;left:76px;top:420px;margin:0;width:900px;font-size:186px;line-height:.86;letter-spacing:-.04em;font-weight:400}
h1 em{font-style:italic;color:#c8452f}
.dek{position:absolute;left:88px;top:900px;width:600px;font-size:30px;line-height:1.5;color:#a89d90}
</style></head><body>
<div class="grain"></div>
<div class="ghost">01</div>
<div class="rule"></div>
<div class="kick">Catatan lapangan</div>
<h1>Berhenti<br>menambal.<br><em>Mulai ulang.</em></h1>
<div class="dek">Satu kalimat pendukung, tidak lebih.</div>
</body></html>"#;

const PROMPT_TAIL: &str = r#"## Pemeriksaan otomatis
Setiap `write_slide` diperiksa mesin. Nama temuan dan artinya: `no-texture` (tidak ada grain/halftone/paper), `centered` (terlalu banyak elemen dipusatkan), `no-dominance` (teks terbesar < 8.5% lebar kanvas), `uniform-radius`, `too-many-colors` (>7 warna), `purple-blue`, `emoji`, `soft-shadows`, `text-wall`, `empty`. Temuan `ERROR` (`no-script`, `external-asset`, `no-import`, `no-fixed`, `canvas-size`) berarti slide akan gagal render/export — wajib diperbaiki.

DILARANG: gradient ungu-biru, emoji di dalam slide, `border-radius` besar di semua elemen, tiga kartu sejajar, teks di tengah semua, bayangan lembut generik, font Arial untuk headline editorial.

## Aturan konsistensi
Semua slide memakai `styleGuide` yang sama: type stack sama, palet sama, treatment tekstur sama, posisi footer sama. Slide tengah = satu ide per slide.

Cover (slide 1) adalah slide yang menentukan. Syaratnya:
- Satu pernyataan yang bisa dibaca dalam 1 detik di ukuran thumbnail: 3–9 kata, bukan judul panjang.
- Satu elemen dominan mutlak (biasanya tipografi besar, boleh juga artwork SVG full-bleed) dan sisanya kecil: kicker, nomor, handle.
- Ada satu keputusan yang berani dan disengaja: crop ekstrem, rotasi kecil, teks yang menabrak tepi, atau kontras warna yang mencolok.
- Ruang kosong dipakai dengan sadar — cover penuh sesak bukan berarti mewah.

Slide terakhir = CTA (ajakan simpan/follow), ringkas, satu instruksi.

Tulis HTML yang benar-benar jalan. Jangan pernah menulis placeholder seperti "<!-- isi di sini -->"."#;

/// Rules, then the worked example, then the automated review rules that the
/// example already satisfies.
pub fn system_prompt() -> String {
    format!(
        "{PROMPT_HEAD}\n## Kerangka yang lolos\nIni contoh struktur yang lolos pemeriksaan tanpa temuan. Perhatikan lapisan tekstur paling bawah, satu elemen dominan, margin kiri 76–88px yang tidak simetris, hairline, dan tidak ada gradient. Tiru STRUKTUR-nya, bukan gayanya — arah visualnya tetap ditentukan brief.\n```html\n{EXAMPLE_SLIDE}\n```\n\n{PROMPT_TAIL}"
    )
}

/* -------------------------------------------------------------------------- */
/* request/response plumbing                                                  */
/* -------------------------------------------------------------------------- */

fn endpoint(base: &str, path: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    let base = if base.ends_with("/v1") || base.contains("/v1/") {
        base.to_string()
    } else {
        format!("{base}/v1")
    };
    format!("{base}/{path}")
}

pub fn provider_label(base_url: &str) -> String {
    let url = base_url.to_lowercase();
    if url.contains("openrouter") {
        "OpenRouter"
    } else if url.contains("groq") {
        "Groq"
    } else if url.contains("deepseek") {
        "DeepSeek"
    } else if url.contains("together") {
        "Together"
    } else if url.contains("fireworks") {
        "Fireworks"
    } else if url.contains("localhost") || url.contains("127.0.0.1") || url.contains("ollama") {
        "Local"
    } else if url.contains("api.openai.com") {
        "OpenAI"
    } else {
        "Custom"
    }
    .to_string()
}

pub async fn fetch_models(settings: &AppSettings) -> Result<Vec<String>, String> {
    let provider = provider_label(&settings.base_url);
    let url = endpoint(&settings.base_url, "models");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if !settings.api_key.trim().is_empty() {
        req = req.bearer_auth(settings.api_key.trim());
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("gagal menghubungi {provider}: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(provider_error(&provider, status.as_u16(), &body));
    }

    let payload: Value = res.json().await.map_err(|e| e.to_string())?;
    let mut models: Vec<String> = payload
        .get("data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn test_connection(settings: &AppSettings) -> Result<Value, String> {
    let provider = provider_label(&settings.base_url);
    let url = endpoint(&settings.base_url, "chat/completions");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let body = json!({
        "model": settings.model,
        "messages": [{ "role": "user", "content": "Reply with the single word: ok" }],
        "max_tokens": 16,
        "temperature": 0.0
    });

    let mut req = client.post(&url).json(&body);
    if !settings.api_key.trim().is_empty() {
        req = req.bearer_auth(settings.api_key.trim());
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("gagal menghubungi {provider}: {e}"))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("{provider} mengembalikan {status}: {}", clip(&text, 400)));
    }

    let reply = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| {
            v["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|| "ok".to_string());

    Ok(json!({
        "ok": true,
        "provider": provider,
        "model": settings.model,
        "reply": clip(&reply, 120)
    }))
}

fn clip(input: &str, max: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max).collect();
    format!("{cut}…")
}

/// Roughly 15k tokens of conversation; the rest is dropped from the oldest turn.
const HISTORY_BUDGET_CHARS: usize = 60_000;
const MAX_USER_CHARS: usize = 8_000;
const MAX_ASSISTANT_CHARS: usize = 6_000;
const MAX_TOOL_CHARS: usize = 10_000;

fn message_chars(m: &ChatMessage) -> usize {
    m.content.chars().count()
        + m
            .tool_calls
            .iter()
            .map(|c| c.args.chars().count() + c.name.chars().count())
            .sum::<usize>()
}

/// Keeps the newest whole turns that fit `budget`. A turn starts at a user
/// message, so tool results never get separated from the call that produced them.
fn fit_history(history: &[ChatMessage], budget: usize) -> &[ChatMessage] {
    let starts: Vec<usize> = history
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user")
        .map(|(i, _)| i)
        .collect();
    let Some(&last) = starts.last() else {
        return history;
    };

    let mut start = last;
    let mut total = 0usize;
    for (pos, &s) in starts.iter().enumerate().rev() {
        let end = starts.get(pos + 1).copied().unwrap_or(history.len());
        let cost: usize = history[s..end].iter().map(message_chars).sum();
        if total > 0 && total + cost > budget {
            break;
        }
        total += cost;
        start = s;
    }
    &history[start..]
}

/// Turns an HTTP failure into something a person can act on: the provider's own
/// message when it sent one, plus a hint tied to the status code.
pub fn provider_error(provider: &str, status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").and_then(|m| m.as_str()).map(|s| s.to_string())
                    .or_else(|| e.as_str().map(|s| s.to_string())))
                .or_else(|| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
        })
        .map(|m| clip(&m, 220))
        .unwrap_or_else(|| clip(body, 220));

    let hint = match status {
        401 | 403 => "API key ditolak. Periksa key di Pengaturan.",
        404 => "Endpoint tidak ditemukan. Base URL biasanya berakhiran /v1.",
        413 => "Brief terlalu besar untuk provider ini.",
        422 => "Provider menolak format permintaan.",
        429 => "Kuota atau rate limit habis. Tunggu sebentar lalu coba lagi.",
        500..=599 => "Server provider sedang bermasalah. Coba lagi.",
        _ => "Permintaan ditolak provider.",
    };

    if detail.is_empty() {
        format!("{provider}: {hint} ({status})")
    } else {
        format!("{provider}: {hint} ({status}) — {detail}")
    }
}

/* -------------------------------------------------------------------------- */
/* streaming agent loop                                                       */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Default)]
struct StreamedToolCall {
    id: String,
    name: String,
    args: String,
}

/// Turns stored history plus reference images into the request payload.
///
/// The reference block always goes in as text (palette, contrast, size), so a
/// text-only model can still follow the look. Pixel attachments are opt-in
/// because sending images to a model without vision is a hard 400.
pub fn build_wire(history: &[ChatMessage], refs: &[Asset], send_refs: bool) -> Vec<Value> {
    // A deck-sized conversation grows fast: every `write_slide` argument carries a
    // full HTML document, and `read_deck` answers with all of them. Without a
    // budget the request would eventually be rejected for context length, so keep
    // the newest whole turns that fit and say plainly that older ones were cut.
    let mut truncated = false;
    let kept = fit_history(history, HISTORY_BUDGET_CHARS);
    if kept.len() < history.len() {
        truncated = true;
    }

    let mut system = system_prompt();
    if truncated {
        system.push_str(
            "\n\n## Catatan konteks\nSebagian percakapan lama dipotong karena panjang. Jangan mengandaikan isi yang tidak terlihat — panggil `read_deck` kalau butuh keadaan deck saat ini.",
        );
    }

    let mut wire: Vec<Value> = vec![json!({ "role": "system", "content": system })];

    for m in kept {
        match m.role.as_str() {
            "user" => wire.push(json!({ "role": "user", "content": clip(m.content.trim(), MAX_USER_CHARS) })),
            "assistant" => {
                if m.tool_calls.is_empty() {
                    wire.push(json!({ "role": "assistant", "content": clip(&m.content, MAX_ASSISTANT_CHARS) }));
                } else {
                    let calls: Vec<Value> = m
                        .tool_calls
                        .iter()
                        .map(|c| {
                            json!({
                                "id": c.id,
                                "type": "function",
                                "function": { "name": c.name, "arguments": clip(&c.args, MAX_TOOL_CHARS) }
                            })
                        })
                        .collect();
                    wire.push(json!({
                        "role": "assistant",
                        "content": clip(&m.content, MAX_ASSISTANT_CHARS),
                        "tool_calls": calls
                    }));
                }
            }
            "tool" => wire.push(json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": clip(&m.content, MAX_TOOL_CHARS)
            })),
            _ => {}
        }
    }

    if refs.is_empty() {
        return wire;
    }

    let mut block = String::from(
        "## Referensi visual\nUser melampirkan cover yang dia anggap bagus. Pakai sebagai arah rasa, bukan untuk dijiplak.\n",
    );
    for (i, a) in refs.iter().enumerate() {
        let desc = a
            .profile
            .as_ref()
            .map(crate::palette::describe)
            .unwrap_or_else(|| "profil tidak terbaca".to_string());
        block.push_str(&format!("{}. {} — {}\n", i + 1, a.name, desc));
    }
    block.push_str(
        "Cara memakainya: ambil GRAMMAR-nya — skala tipografi, kepadatan, logika grid, treatment tekstur, dan cara palet dipakai (berapa banyak warna, mana yang dominan). Jangan menyalin teks, logo, atau artwork-nya. Kalau referensinya gelap dan kontras tinggi, hasilmu harus terasa satu keluarga tanpa harus identik.\n",
    );
    // Right after the base prompt, so it colours every turn.
    wire.insert(1, json!({ "role": "system", "content": block }));

    if send_refs {
        if let Some(idx) = wire
            .iter()
            .rposition(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        {
            let text = wire[idx]
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
            let mut parts: Vec<Value> = vec![json!({ "type": "text", "text": text })];
            for a in refs.iter().rev().take(4).rev() {
                if a.data.is_empty() || a.data.len() > 3_500_000 {
                    continue;
                }
                parts.push(json!({
                    "type": "image_url",
                    "image_url": { "url": format!("data:{};base64,{}", a.mime, a.data) }
                }));
            }
            if parts.len() > 1 {
                wire[idx] = json!({ "role": "user", "content": parts });
            }
        }
    }

    wire
}

/// Runs one agent invocation: takes the conversation so far and streams events.
pub async fn run_agent(
    db: &Db,
    settings: &AppSettings,
    deck_id: &str,
    history: Vec<ChatMessage>,
    channel: Channel<AgentEvent>,
) {
    let provider = provider_label(&settings.base_url);
    let url = endpoint(&settings.base_url, "chat/completions");
    let tools_spec = tools::tool_specs(settings);

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = channel.send(AgentEvent::Error {
                message: e.to_string(),
            });
            return;
        }
    };

    let refs = db.list_assets(deck_id);
    let mut wire = build_wire(&history, &refs, settings.send_references);

    let max_turns = settings.max_turns.clamp(1, 64);

    for turn in 1..=max_turns {
        let _ = channel.send(AgentEvent::TurnStart { turn });

        let body = json!({
            "model": settings.model,
            "messages": wire,
            "tools": tools_spec,
            "tool_choice": "auto",
            "temperature": settings.temperature,
            "stream": true
        });

        let mut req = client.post(&url).json(&body);
        if !settings.api_key.trim().is_empty() {
            req = req.bearer_auth(settings.api_key.trim());
        }

        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = channel.send(AgentEvent::Error {
                    message: format!("gagal menghubungi {provider}: {e}"),
                });
                return;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            let _ = channel.send(AgentEvent::Error {
                message: provider_error(&provider, status.as_u16(), &text),
            });
            return;
        }

        // ---- parse the SSE stream ----
        let mut text_buf = String::new();
        let mut calls: Vec<StreamedToolCall> = Vec::new();
        let mut buf = String::new();
        let mut stream = res.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let Ok(bytes) = chunk else { break };
            buf.push_str(&String::from_utf8_lossy(&bytes));

            // SSE frames are separated by a blank line.
            while let Some(pos) = buf.find("\n\n") {
                let frame: String = buf.drain(..pos + 2).collect();
                for line in frame.lines() {
                    let line = line.trim();
                    let Some(payload) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let payload = payload.trim();
                    if payload == "[DONE]" || payload.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<Value>(payload) else {
                        continue;
                    };
                    let Some(delta) = value
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                    else {
                        continue;
                    };

                    if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
                        if !text.is_empty() {
                            text_buf.push_str(text);
                            let _ = channel.send(AgentEvent::TextDelta {
                                text: text.to_string(),
                            });
                        }
                    }

                    if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in tcs {
                            let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                            while calls.len() <= idx {
                                calls.push(StreamedToolCall::default());
                            }
                            let slot = &mut calls[idx];
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                if !id.is_empty() {
                                    slot.id = id.to_string();
                                }
                            }
                            if let Some(f) = tc.get("function") {
                                if let Some(name) = f.get("name").and_then(|v| v.as_str()) {
                                    if !name.is_empty() {
                                        slot.name = name.to_string();
                                    }
                                }
                                if let Some(args) = f.get("arguments").and_then(|v| v.as_str()) {
                                    slot.args.push_str(args);
                                }
                            }
                        }
                    }
                }
            }
        }

        calls.retain(|c| !c.name.is_empty());

        // ---- no tools: this is the final answer ----
        if calls.is_empty() {
            let msg = ChatMessage {
                id: new_id("msg"),
                deck_id: deck_id.to_string(),
                role: "assistant".into(),
                content: text_buf,
                tool_calls: Vec::new(),
                tool_call_id: None,
                streaming: false,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            let _ = db.append_message(&msg);
            let _ = channel.send(AgentEvent::Done {
                reason: "complete".into(),
            });
            return;
        }

        // ---- persist the assistant tool-call message ----
        let records: Vec<ToolCallRecord> = calls
            .iter()
            .map(|c| ToolCallRecord {
                id: if c.id.is_empty() {
                    new_id("call")
                } else {
                    c.id.clone()
                },
                name: c.name.clone(),
                args: c.args.clone(),
                result: None,
                state: "running".into(),
            })
            .collect();

        let assistant_msg = ChatMessage {
            id: new_id("msg"),
            deck_id: deck_id.to_string(),
            role: "assistant".into(),
            content: text_buf.clone(),
            tool_calls: records.clone(),
            tool_call_id: None,
            streaming: false,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let _ = db.append_message(&assistant_msg);

        wire.push(json!({
            "role": "assistant",
            "content": text_buf,
            "tool_calls": records.iter().map(|c| json!({
                "id": c.id,
                "type": "function",
                "function": { "name": c.name, "arguments": c.args }
            })).collect::<Vec<_>>()
        }));

        // ---- execute each tool ----
        for (position, record) in records.iter().enumerate() {
            let _ = channel.send(AgentEvent::ToolCall {
                id: record.id.clone(),
                name: record.name.clone(),
                args: record.args.clone(),
            });

            let parsed: Value = serde_json::from_str(&record.args).unwrap_or(json!({}));
            let ctx = ToolContext {
                db,
                deck_id: deck_id.to_string(),
                settings: settings.clone(),
            };
            let outcome = tools::execute(&ctx, &record.name, &parsed).await;

            let tool_msg = ChatMessage {
                id: new_id("msg"),
                deck_id: deck_id.to_string(),
                role: "tool".into(),
                content: outcome.content.clone(),
                tool_calls: Vec::new(),
                tool_call_id: Some(record.id.clone()),
                streaming: false,
                created_at: chrono::Utc::now().to_rfc3339(),
            };
            let _ = db.append_message(&tool_msg);

            wire.push(json!({
                "role": "tool",
                "tool_call_id": record.id,
                "content": outcome.content
            }));

            let _ = channel.send(AgentEvent::ToolResult {
                id: record.id.clone(),
                name: record.name.clone(),
                result: clip(&outcome.content, 400),
                ok: !outcome.content.starts_with("error"),
            });

            if let Some(deck) = outcome.deck {
                let _ = channel.send(AgentEvent::DeckUpdated { deck });
            }

            if let Some(question) = outcome.pause_question {
                // The assistant message we just saved may contain several tool
                // calls. Providers reject a transcript where any call has no
                // reply, so answer the ones we are not going to run.
                for skipped in records.iter().skip(position + 1) {
                    let _ = db.append_message(&ChatMessage {
                        id: new_id("msg"),
                        deck_id: deck_id.to_string(),
                        role: "tool".into(),
                        content: "dilewati: agent menunggu jawaban user".into(),
                        tool_calls: Vec::new(),
                        tool_call_id: Some(skipped.id.clone()),
                        streaming: false,
                        created_at: chrono::Utc::now().to_rfc3339(),
                    });
                }

                // Persist the question as an assistant message so the transcript
                // reads naturally, then stop the loop.
                let ask = ChatMessage {
                    id: new_id("msg"),
                    deck_id: deck_id.to_string(),
                    role: "assistant".into(),
                    content: question,
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    streaming: false,
                    created_at: chrono::Utc::now().to_rfc3339(),
                };
                let _ = db.append_message(&ask);
                let _ = channel.send(AgentEvent::Done {
                    reason: "question".into(),
                });
                return;
            }
        }
    }

    let _ = channel.send(AgentEvent::Done {
        reason: "max_turns".into(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_msg(text: &str) -> ChatMessage {
        ChatMessage {
            id: "m1".into(),
            deck_id: "d1".into(),
            role: "user".into(),
            content: text.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            streaming: false,
            created_at: String::new(),
        }
    }

    fn reference() -> Asset {
        Asset {
            id: "ref1".into(),
            deck_id: Some("d1".into()),
            name: "cover1.jpg".into(),
            mime: "image/jpeg".into(),
            data: "AAAA".into(),
            profile: Some(crate::palette::ImageProfile {
                width: 1080,
                height: 1350,
                palette: vec!["#0d0c0b".into(), "#f2ece1".into(), "#b8412f".into()],
                luminance: 0.12,
                contrast: 0.8,
                light_ratio: 0.05,
            }),
            created_at: String::new(),
        }
    }

    #[test]
    fn without_references_the_prompt_is_plain() {
        let wire = build_wire(&[user_msg("halo")], &[], false);
        assert_eq!(wire.len(), 2);
        assert_eq!(wire[0]["role"], "system");
        assert_eq!(wire[1]["content"], "halo");
        assert!(wire[1]["content"].is_string());
    }

    #[test]
    fn references_are_described_even_without_vision() {
        let wire = build_wire(&[user_msg("bikin cover")], &[reference()], false);
        assert_eq!(wire.len(), 3);
        let block = wire[1]["content"].as_str().unwrap();
        assert!(block.contains("Referensi visual"));
        assert!(block.contains("cover1.jpg"));
        assert!(block.contains("#b8412f"));
        // No image parts: the user message is still a plain string.
        assert!(wire[2]["content"].is_string());
    }

    #[test]
    fn vision_mode_attaches_the_image_bytes() {
        let wire = build_wire(&[user_msg("bikin cover")], &[reference()], true);
        let parts = wire[2]["content"].as_array().expect("multimodal content");
        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[1]["type"], "image_url");
        assert_eq!(
            parts[1]["image_url"]["url"],
            "data:image/jpeg;base64,AAAA"
        );
    }
}
#[cfg(test)]
mod loop_tests {
    //! Drives the real streaming loop against a throwaway HTTP server that
    //! speaks the OpenAI SSE dialect. No network, no API key.

    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn read_request(stream: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let n = stream.read(&mut chunk).unwrap_or(0);
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            if let Some(head_end) = text.find("\r\n\r\n") {
                let head = &text[..head_end];
                let len = head
                    .lines()
                    .find_map(|l| {
                        let lower = l.to_lowercase();
                        lower
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if buf.len() >= head_end + 4 + len {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    fn sse(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[tokio::test]
    async fn the_loop_calls_a_tool_then_finishes_and_persists() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();

        let tool_args = json!({
            "title": "Cover",
            "html": "<!doctype html><html><body><h1>Cover</h1></body></html>",
            "rationale": "poster"
        })
        .to_string();

        let server = std::thread::spawn(move || {
            for round in 0..2 {
                let Ok((mut stream, _)) = listener.accept() else { break };
                let _ = read_request(&mut stream);
                let body = if round == 0 {
                    format!(
                        concat!(
                            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"Saya tulis slide pertama. \"}}}}]}}\n\n",
                            "data: {{\"choices\":[{{\"delta\":{{\"tool_calls\":[{{\"index\":0,\"id\":\"call_1\",\"function\":{{\"name\":\"write_slide\",\"arguments\":{}}}}}]}}}}]}}\n\n",
                            "data: [DONE]\n\n"
                        ),
                        json!(tool_args)
                    )
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Selesai.\"}}]}\n\ndata: [DONE]\n\n"
                        .to_string()
                };
                let _ = stream.write_all(sse(&body).as_bytes());
                let _ = stream.flush();
            }
        });

        let path = std::env::temp_dir().join(format!("desel-loop-{}.db", uuid::Uuid::new_v4().simple()));
        let db = Db::open(path.clone()).expect("db");
        let now = chrono::Utc::now().to_rfc3339();
        db.save_deck(
            &Deck {
                id: "deck_loop".into(),
                title: "Loop".into(),
                caption: String::new(),
                aspect: "4:5".into(),
                slides: Vec::new(),
                style_guide: String::new(),
                palette: Vec::new(),
                brand_handle: String::new(),
                save_label: "Save".into(),
                from_template_id: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            None,
        )
        .unwrap();

        let mut settings = AppSettings::default();
        settings.base_url = format!("http://127.0.0.1:{port}");
        settings.model = "mock-model".into();
        settings.enable_research = false;

        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(raw) = body {
                let text = raw.to_string();
                let name = serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|s| s.to_string()))
                    .unwrap_or_default();
                sink.lock().unwrap().push(name);
            }
            Ok(())
        });

        let history = vec![ChatMessage {
            id: "m1".into(),
            deck_id: "deck_loop".into(),
            role: "user".into(),
            content: "bikin cover".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            streaming: false,
            created_at: now,
        }];

        run_agent(&db, &settings, "deck_loop", history, channel).await;
        let _ = server.join();

        let events = seen.lock().unwrap().clone();
        assert!(events.iter().any(|e| e == "tool_call"), "events: {events:?}");
        assert!(events.iter().any(|e| e == "deck_updated"), "events: {events:?}");
        assert!(events.iter().any(|e| e == "done"), "events: {events:?}");

        let deck = db.get_deck("deck_loop").expect("deck");
        assert_eq!(deck.slides.len(), 1, "tool call harus menulis slide ke db");
        assert!(deck.slides[0].html.contains("Cover"));

        let transcript = db.list_messages("deck_loop");
        let tool_reply = transcript
            .iter()
            .find(|m| m.role == "tool")
            .expect("hasil tool harus tersimpan");
        assert!(
            tool_reply.content.contains("Pemeriksaan desain"),
            "model harus menerima temuan desain: {}",
            tool_reply.content
        );

        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn asking_a_question_next_to_another_tool_leaves_a_valid_transcript() {
        // Some models emit ask_user together with a read. The loop stops at the
        // question, so every call in that assistant message still needs a reply —
        // otherwise the next request is rejected by the provider.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();

        let server = std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let _ = read_request(&mut stream);
            let ask_args = json!({ "question": "Untuk brand apa?" }).to_string();
            let ask_frame = json!({ "choices": [{ "delta": { "tool_calls": [{
                "index": 0, "id": "call_ask", "function": { "name": "ask_user", "arguments": ask_args }
            }] } }] });
            let read_frame = json!({ "choices": [{ "delta": { "tool_calls": [{
                "index": 1, "id": "call_read", "function": { "name": "read_deck", "arguments": "{}" }
            }] } }] });
            let body = format!("data: {ask_frame}\n\ndata: {read_frame}\n\ndata: [DONE]\n\n");
            let _ = stream.write_all(sse(&body).as_bytes());
            let _ = stream.flush();
        });

        let path = std::env::temp_dir().join(format!("desel-ask-{}.db", uuid::Uuid::new_v4().simple()));
        let db = Db::open(path.clone()).expect("db");
        let now = chrono::Utc::now().to_rfc3339();
        db.save_deck(
            &Deck {
                id: "deck_ask".into(),
                title: "Ask".into(),
                caption: String::new(),
                aspect: "4:5".into(),
                slides: Vec::new(),
                style_guide: String::new(),
                palette: Vec::new(),
                brand_handle: String::new(),
                save_label: "Save".into(),
                from_template_id: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            },
            None,
        )
        .unwrap();

        let mut settings = AppSettings::default();
        settings.base_url = format!("http://127.0.0.1:{port}");
        settings.model = "mock-model".into();
        settings.enable_research = false;

        let channel = Channel::new(|_| Ok(()));
        let history = vec![ChatMessage {
            id: "m1".into(),
            deck_id: "deck_ask".into(),
            role: "user".into(),
            content: "bikin deck".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            streaming: false,
            created_at: now,
        }];

        run_agent(&db, &settings, "deck_ask", history, channel).await;
        let _ = server.join();

        let transcript = db.list_messages("deck_ask");
        let call = transcript
            .iter()
            .find(|m| m.role == "assistant" && !m.tool_calls.is_empty())
            .expect("assistant dengan tool calls tersimpan");
        assert_eq!(call.tool_calls.len(), 2);

        for id in ["call_ask", "call_read"] {
            let answered = transcript
                .iter()
                .any(|m| m.role == "tool" && m.tool_call_id.as_deref() == Some(id));
            assert!(answered, "tool call {id} tidak punya balasan: {transcript:?}");
        }
        assert!(
            transcript.iter().any(|m| m.role == "assistant" && m.content.contains("brand apa")),
            "pertanyaannya harus muncul di chat"
        );

        let _ = std::fs::remove_file(path);
    }
}
#[cfg(test)]
mod context_tests {
    use super::*;
    use crate::model::{ChatMessage, ToolCallRecord};

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: "m".into(),
            deck_id: "d".into(),
            role: role.into(),
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            streaming: false,
            created_at: String::new(),
        }
    }

    fn tool_call(id: &str, args: &str) -> ToolCallRecord {
        ToolCallRecord {
            id: id.into(),
            name: "write_slide".into(),
            args: args.into(),
            result: None,
            state: "done".into(),
        }
    }

    #[test]
    fn a_short_conversation_is_sent_untouched() {
        let history = vec![msg("user", "bikin deck"), msg("assistant", "oke")];
        assert_eq!(fit_history(&history, 60_000).len(), 2);
    }

    #[test]
    fn old_turns_are_dropped_but_the_latest_survives() {
        let mut history = Vec::new();
        for i in 0..12 {
            history.push(msg("user", &format!("revisi {i}")));
            history.push(msg("assistant", &"x".repeat(20_000)));
        }
        let kept = fit_history(&history, 60_000);
        assert!(kept.len() < history.len());
        assert_eq!(kept.first().unwrap().role, "user");
        assert!(kept.last().unwrap().content.starts_with("xxxx"));
    }

    #[test]
    fn a_single_huge_turn_is_kept_but_clipped_in_the_wire() {
        let mut huge = msg("user", "tulis deck 30 slide");
        huge.tool_calls.push(tool_call("c1", &"h".repeat(80_000)));
        let mut tool_result = msg("tool", &"r".repeat(80_000));
        tool_result.tool_call_id = Some("c1".into());

        let wire = build_wire(&[huge, tool_result], &[], false);
        let json = serde_json::to_string(&wire).unwrap();
        assert!(json.len() < 40_000, "wire was {} chars", json.len());
    }

    #[test]
    fn truncation_is_announced_to_the_model() {
        let mut history = Vec::new();
        for i in 0..12 {
            history.push(msg("user", &format!("revisi {i}")));
            history.push(msg("assistant", &"y".repeat(20_000)));
        }
        let wire = build_wire(&history, &[], false);
        let system = wire[0]["content"].as_str().unwrap();
        assert!(system.contains("read_deck"), "missing context note");
    }

    #[test]
    fn every_tool_message_still_has_its_call_nearby() {
        let mut history = Vec::new();
        for i in 0..6 {
            history.push(msg("user", &format!("slide {i}")));
            let mut call = msg("assistant", "");
            call.tool_calls.push(tool_call(&format!("c{i}"), &"a".repeat(15_000)));
            let mut result = msg("tool", &"z".repeat(15_000));
            result.tool_call_id = Some(format!("c{i}"));
            history.push(call);
            history.push(result);
        }
        let wire = build_wire(&history, &[], false);
        let roles: Vec<&str> = wire.iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles[1], "user", "wire must not start mid-turn: {roles:?}");
        for (i, role) in roles.iter().enumerate() {
            if *role == "tool" {
                let boundary = roles[..i].iter().rposition(|r| *r == "user").unwrap();
                let has_call = wire[boundary..i].iter().any(|m| m["tool_calls"].is_array());
                assert!(has_call, "orphan tool message at {i}");
            }
        }
    }
}

#[cfg(test)]
mod error_tests {
    use super::provider_error;

    #[test]
    fn a_rejected_key_says_what_to_do() {
        let msg = provider_error(
            "OpenAI",
            401,
            r#"{"error":{"message":"Invalid API key provided.","type":"invalid_request_error"}}"#,
        );
        assert!(msg.contains("API key ditolak"), "{msg}");
        assert!(msg.contains("Invalid API key provided."), "{msg}");
    }

    #[test]
    fn a_wrong_base_url_points_at_the_url() {
        let msg = provider_error("Custom", 404, "not found");
        assert!(msg.contains("/v1"), "{msg}");
    }

    #[test]
    fn a_plain_text_body_still_produces_a_sentence() {
        let msg = provider_error("Local", 502, "<html>bad gateway</html>");
        assert!(msg.contains("502"), "{msg}");
        assert!(msg.contains("Server provider"), "{msg}");
    }
}