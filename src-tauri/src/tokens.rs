//! Calibrated token accounting, token-budgeted history fitting and
//! deterministic local compaction of dropped conversation turns.
//!
//! There is no bundled BPE vocabulary, so counts are calibrated estimates,
//! not tokenizer guarantees. The estimate is content-aware: CJK characters
//! cost about one token each, punctuation-dense text (code, JSON, HTML) runs
//! about 3 characters per token, and ordinary prose about 4. Estimates err on
//! the high side so a fitted history stays under the advertised model window.

use crate::model::ChatMessage;

/// Default conversation budget: roughly the 15k tokens the old 60k-character
/// budget approximated, now measured in estimated tokens directly.
pub const DEFAULT_HISTORY_BUDGET_TOKENS: usize = 15_000;
/// Hard ceiling even when a model advertises a much larger window, so an
/// optimistic provider metadata entry cannot produce an unbounded prompt.
pub const MAX_HISTORY_TOKENS: usize = 60_000;
/// Per-message framing overhead (role tokens and separators in chat formats).
const MESSAGE_OVERHEAD: usize = 4;

fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' |
        '\u{3040}'..='\u{30FF}' | '\u{AC00}'..='\u{D7AF}' |
        '\u{F900}'..='\u{FAFF}' | '\u{20000}'..='\u{2A6DF}')
}

/// Estimated token count for one text span. Never returns 0 for non-empty
/// input; an empty string estimates to 0.
pub fn estimate_tokens(text: &str) -> usize {
    let mut cjk = 0usize;
    let mut punct = 0usize;
    let mut other = 0usize;
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk += 1;
        } else if ch.is_ascii_punctuation() {
            punct += 1;
        } else {
            other += 1;
        }
    }
    let non_cjk = punct + other;
    if non_cjk == 0 {
        return cjk;
    }
    // Dense markup/code tokenizes worse than prose; pick the ratio by density.
    let ratio = if punct * 4 > non_cjk { 3.0 } else { 4.0 };
    cjk + (non_cjk as f64 / ratio).ceil() as usize
}

/// Estimated tokens for one stored message, including tool calls and framing.
pub fn estimate_message_tokens(m: &ChatMessage) -> usize {
    MESSAGE_OVERHEAD
        + estimate_tokens(&m.content)
        + estimate_tokens(&m.reasoning_content)
        + m.tool_calls
            .iter()
            .map(|c| estimate_tokens(&c.name) + estimate_tokens(&c.args) + MESSAGE_OVERHEAD)
            .sum::<usize>()
}

/// Keeps the newest whole turns that fit `budget_tokens`. A turn starts at a
/// user message, so tool results never get separated from the call that
/// produced them. The latest turn is always kept even when it alone exceeds
/// the budget; per-message clipping downstream bounds that case.
pub fn fit_history_tokens(history: &[ChatMessage], budget_tokens: usize) -> &[ChatMessage] {
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
        let cost: usize = history[s..end].iter().map(estimate_message_tokens).sum();
        if total > 0 && total + cost > budget_tokens {
            break;
        }
        total += cost;
        start = s;
    }
    &history[start..]
}

fn clip_chars(input: &str, max: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max).collect();
    format!("{cut}…")
}

/// Deterministic local compaction of dropped turns: one short line per
/// message with the user's ask and the assistant's tool names, so the model
/// keeps the gist of what was cut without any extra inference call. The
/// summary stops growing once it would exceed `max_tokens` and says how many
/// further messages were not summarized.
pub fn summarize_dropped(dropped: &[ChatMessage], max_tokens: usize) -> String {
    if dropped.is_empty() {
        return String::new();
    }
    let header = format!(
        "Ringkasan lokal dari {} pesan lama yang dipotong (bukan verbatim; gunakan read_deck dan memori proyek untuk fakta saat ini):",
        dropped.len()
    );
    let mut lines: Vec<String> = Vec::new();
    let mut used = estimate_tokens(&header);
    let mut summarized = 0usize;
    for m in dropped {
        let line = match m.role.as_str() {
            "user" => format!("- Pengguna: \"{}\"", clip_chars(&m.content, 80)),
            "assistant" if !m.tool_calls.is_empty() => {
                let names: Vec<&str> = m.tool_calls.iter().map(|c| c.name.as_str()).collect();
                let mut line = format!("- Asisten memanggil {}", names.join(", "));
                let text = m.content.trim();
                if !text.is_empty() {
                    line.push_str(&format!(" (\"{}\")", clip_chars(text, 60)));
                }
                line
            }
            "assistant" => format!("- Asisten: \"{}\"", clip_chars(&m.content, 80)),
            "tool" => format!("- Hasil tool: \"{}\"", clip_chars(&m.content, 60)),
            _ => continue,
        };
        let cost = estimate_tokens(&line);
        if used + cost > max_tokens && summarized > 0 {
            break;
        }
        used += cost;
        summarized += 1;
        lines.push(line);
    }
    if summarized < dropped.len() {
        lines.push(format!(
            "- … dan {} pesan lagi yang tidak sempat diringkas.",
            dropped.len() - summarized
        ));
    }
    let mut out = header;
    for line in lines {
        out.push('\n');
        out.push_str(&line);
    }
    out
}
