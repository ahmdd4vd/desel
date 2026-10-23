import { readFileSync, writeFileSync } from "node:fs";

const path = "src-tauri/src/agent.rs";
const src = readFileSync(path, "utf8");
const lines = src.split("\n");

const headStart = lines.findIndex((l) => l.startsWith("pub const SYSTEM_PROMPT"));
const kerangka = lines.findIndex((l) => l === "## Kerangka yang lolos");
const pem = lines.findIndex((l) => l === "## Pemeriksaan otomatis");
let end = -1;
for (let i = pem; i < lines.length; i++) {
  if (lines[i].includes('"#;')) {
    end = i;
    break;
  }
}
if (headStart < 0 || kerangka < 0 || pem < 0 || end < 0) throw new Error(`anchors: ${headStart} ${kerangka} ${pem} ${end}`);

// head: content after the literal opening, up to the blank line before the exemplar
const head = lines
  .slice(headStart, kerangka)
  .map((l, i) => (i === 0 ? l.replace('pub const SYSTEM_PROMPT: &str = r#"', "") : l))
  .join("\n")
  .replace(/\n+$/, "");

// exemplar html between ```html and ```
const blockStart = lines.findIndex((l, i) => i > kerangka && i < pem && l === "```html");
const blockEnd = lines.findIndex((l, i) => i > blockStart && i < pem && l === "```");
const exemplar = lines.slice(blockStart + 1, blockEnd).join("\n");

// tail: from "## Pemeriksaan otomatis" to the closing quote, minus the terminator
const tailLines = lines.slice(pem, end + 1);
tailLines[tailLines.length - 1] = tailLines[tailLines.length - 1].replace(/"#;$/, "");
const tail = tailLines.join("\n");

const replacement = `const PROMPT_HEAD: &str = r#"${head}"#;

/// The worked example shown in the prompt. It is linted by a unit test, so the
/// reference the model imitates can never drift from the standard it is judged by.
pub const EXAMPLE_SLIDE: &str = r#"${exemplar}"#;

const PROMPT_TAIL: &str = r#"${tail}"#;

/// Rules, then the worked example, then the automated review rules that the
/// example already satisfies.
pub fn system_prompt() -> String {
    format!(
        "{PROMPT_HEAD}\\n## Kerangka yang lolos\\nIni contoh struktur yang lolos pemeriksaan tanpa temuan. Perhatikan lapisan tekstur paling bawah, satu elemen dominan, margin kiri 76–88px yang tidak simetris, hairline, dan tidak ada gradient. Tiru STRUKTUR-nya, bukan gayanya — arah visualnya tetap ditentukan brief.\\n\\\`\\\`\\\`html\\n{EXAMPLE_SLIDE}\\n\\\`\\\`\\\`\\n\\n{PROMPT_TAIL}"
    )
}`;

// fix the escaped backticks used only to keep this generator readable
const clean = replacement.replace(/\\`/g, "`");

const out = [...lines.slice(0, headStart), ...clean.split("\n"), ...lines.slice(end + 1)].join("\n");
writeFileSync(path, out, "utf8");
console.log("rewrote prompt: head", head.length, "exemplar", exemplar.length, "tail", tail.length);
