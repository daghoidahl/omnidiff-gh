//! Input: {"before": str, "after": str, "path": str}
//! Output: {"language": str, "structural": bool, "before": [[op, sr, sc, er, ec, dr, dc, der, dec], ...], "after": [...]}
//! Columns are byte offsets within the row, as omnidiff reports them.
use omnidiff::code::language::{language_for_path_and_content, stable_name};
use omnidiff::code::{Code, Language};
use omnidiff::diff::NodeCache;
use std::ops::Range;

use omnidiff::diff::text::{
    RangeMatch, RenderOptions, TextDiff, TextOperation, line_diff_core, plain_text_line_diff,
    plain_text_token_diff, ranges_for_options,
};
use omnidiff::diff::text_range::TextRange;

#[derive(serde::Deserialize)]
struct Input {
    before: String,
    after: String,
    path: String,
}

fn flat(r: &RangeMatch) -> (String, [usize; 8]) {
    let (s, d) = (&r.source, &r.destination);
    (format!("{:?}", r.operation), [s.start_row, s.start_column, s.end_row, s.end_column,
        d.start_row, d.start_column, d.end_row, d.end_column])
}

/// The diff of `input` (the JSON above) as JSON.
pub fn diff_json(input: &str) -> String {
    let input: Input = serde_json::from_str(input).expect("input json");
    let path = std::path::Path::new(&input.path);
    let language = language_for_path_and_content(path, &input.after).unwrap_or(Language::Unknown);
    let before = Code::from_string(&input.before, &language);
    let after = Code::from_string(&input.after, &language);
    // Without a grammar (Markdown, Dart, unknown extensions) there is no structural diff; see
    // `plain_text_diff`. Same test as the TUI's `diff_parsed`.
    let structural = before.ast.is_some() && after.ast.is_some();
    let (before_ranges, after_ranges) = if structural {
        let diff = omnidiff::diff::diff_code(&before, &after);
        let ast = diff.ast.as_ref().expect("a parsed pair has an AST diff");
        let cache = NodeCache::build(&before, &after);
        let text = TextDiff::from(&before, &after, ast, &cache);
        (text.all(0), text.all(1))
    } else {
        plain_text_diff(&input.before, &input.after)
    };
    let side = |ranges: &[RangeMatch], source: &str| -> Vec<(String, [usize; 8])> {
        ranges_for_options(ranges, source, RenderOptions::FULL).iter().map(flat).collect()
    };
    serde_json::json!({
        "language": stable_name(language),
        "structural": structural,
        "before": side(&before_ranges, &input.before),
        "after": side(&after_ranges, &input.after),
    })
    .to_string()
}

/// Byte offset of each line's start in `text`, plus `text.len()` when it ends in a newline.
fn line_starts(text: &str) -> Vec<usize> {
    std::iter::once(0).chain(text.match_indices('\n').map(|(at, _)| at + 1)).collect()
}

/// The (row, column) of byte `offset`, columns in bytes like omnidiff's.
fn position(starts: &[usize], offset: usize) -> (usize, usize) {
    let row = starts.partition_point(|&start| start <= offset) - 1;
    (row, offset - starts[row])
}

/// Rows `rows` of `text` as one line: its byte span, and the text with line breaks turned into
/// spaces (same byte length, so offsets in it are offsets in `text`).
fn block(text: &str, starts: &[usize], rows: &Range<usize>) -> (usize, usize, String) {
    let start = starts[rows.start];
    let end = starts.get(rows.end).map_or(text.len(), |&next| next - 1).max(start);
    (start, end, text[start..end].replace(['\n', '\r'], " "))
}

fn text_range(starts: &[usize], from: usize, to: usize) -> TextRange {
    let ((start_row, start_column), (end_row, end_column)) = (position(starts, from), position(starts, to));
    TextRange::new(start_row, start_column, end_row, end_column)
}

fn whole(starts: &[usize], span: (usize, usize), operation: TextOperation) -> RangeMatch {
    RangeMatch { source: text_range(starts, span.0, span.1), destination: TextRange::zero(), operation }
}

/// Token ranges of a joined block (row 0, byte columns into the block) as ranges of the text, its
/// own side starting at byte `own.1` and the other side's at `other.1`. Identical ranges are dropped.
fn unjoin(ranges: Vec<RangeMatch>, own: (&[usize], usize), other: (&[usize], usize)) -> Vec<RangeMatch> {
    ranges
        .into_iter()
        .filter(|range| range.operation != TextOperation::Identical)
        .map(|range| {
            let paired = matches!(range.operation, TextOperation::Update | TextOperation::Move);
            RangeMatch {
                source: text_range(own.0, own.1 + range.source.start_column, own.1 + range.source.end_column),
                destination: if paired {
                    text_range(other.0, other.1 + range.destination.start_column, other.1 + range.destination.end_column)
                } else {
                    TextRange::zero()
                },
                operation: range.operation,
            }
        })
        .collect()
}

/// Whether a block and its counterpart have enough text in common for a word diff to read as an
/// edit: at least a third of the shorter one's non-blank characters unchanged. Below that the two
/// blocks only happen to sit in the same gap (a section moved away, a new list item) and read
/// better as one deleted and one inserted.
fn mostly_shared(tokens_after: &[RangeMatch], after_line: &str, before_line: &str) -> bool {
    let solid = |text: &str| text.chars().filter(|c| !c.is_whitespace()).count();
    let shared: usize = tokens_after
        .iter()
        .filter(|range| range.operation == TextOperation::Identical)
        .map(|range| solid(&after_line[range.source.start_column..range.source.end_column]))
        .sum();
    shared * 3 >= solid(after_line).min(solid(before_line))
}

/// Text without a grammar: a line diff finds the changed blocks, then omnidiff's token diff runs
/// within each block, so a reworded or rewrapped paragraph shows the words that changed rather
/// than whole lines (omnidiff's own line diff only splits a line when both versions share an
/// affix). Unchanged lines get no range: nothing paints them.
fn plain_text_diff(before: &str, after: &str) -> (Vec<RangeMatch>, Vec<RangeMatch>) {
    let Some(core) = line_diff_core(before, after, 10_000) else {
        return plain_text_line_diff(before, after);
    };
    let (before_starts, after_starts) = (line_starts(before), line_starts(after));
    let (mut before_ranges, mut after_ranges) = (Vec::new(), Vec::new());
    let mut next = (0, 0);
    let anchors = core.pairs.iter().copied().chain([(core.before_line_count, core.after_line_count)]);
    for (before_row, after_row) in anchors {
        let (before_rows, after_rows) = (next.0..before_row, next.1..after_row);
        next = (before_row + 1, after_row + 1);
        match (before_rows.is_empty(), after_rows.is_empty()) {
            (true, true) => {}
            (false, true) => {
                let (from, to, _) = block(before, &before_starts, &before_rows);
                before_ranges.push(whole(&before_starts, (from, to), TextOperation::Delete));
            }
            (true, false) => {
                let (from, to, _) = block(after, &after_starts, &after_rows);
                after_ranges.push(whole(&after_starts, (from, to), TextOperation::Insert));
            }
            (false, false) => {
                let (before_from, before_to, before_line) = block(before, &before_starts, &before_rows);
                let (after_from, after_to, after_line) = block(after, &after_starts, &after_rows);
                let tokens = plain_text_token_diff(&before_line, &after_line)
                    .filter(|(_, tokens_after)| mostly_shared(tokens_after, &after_line, &before_line));
                let Some((tokens_before, tokens_after)) = tokens else {
                    before_ranges.push(whole(&before_starts, (before_from, before_to), TextOperation::Delete));
                    after_ranges.push(whole(&after_starts, (after_from, after_to), TextOperation::Insert));
                    continue;
                };
                before_ranges.extend(unjoin(tokens_before, (&before_starts, before_from), (&after_starts, after_from)));
                after_ranges.extend(unjoin(tokens_after, (&after_starts, after_from), (&before_starts, before_from)));
            }
        }
    }
    (before_ranges, after_ranges)
}

// C ABI for the browser: `omnidiff_alloc` a buffer, write the input JSON into it, call
// `omnidiff_diff`; the result is `u32 length (little endian)` then that many bytes of JSON, to be
// released with `omnidiff_free(ptr, 4 + length)`. The input buffer is consumed by `omnidiff_diff`.

#[unsafe(no_mangle)]
pub extern "C" fn omnidiff_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` must come from `omnidiff_alloc(len)` or be a result of `omnidiff_diff` with `len` = 4 + length.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn omnidiff_free(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// # Safety
/// `ptr` must come from `omnidiff_alloc(len)` and hold `len` bytes of UTF-8 JSON.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn omnidiff_diff(ptr: *mut u8, len: usize) -> *mut u8 {
    let input = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let output = diff_json(std::str::from_utf8(&input).expect("utf-8 input"));
    let mut result = Vec::with_capacity(4 + output.len());
    result.extend_from_slice(&(output.len() as u32).to_le_bytes());
    result.extend_from_slice(output.as_bytes());
    result.shrink_to_fit();
    let out = result.as_mut_ptr();
    std::mem::forget(result);
    out
}
