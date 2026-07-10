/**
 * A minimal, purpose-built PDF content-stream tokenizer. It does exactly one
 * job: walk a page's (decoded) content-stream bytes and report the byte
 * range of every text-showing operation (`Tj`, `TJ`, `'`, `"`), in the order
 * they occur — nothing else about the stream is interpreted or rebuilt.
 *
 * This is deliberately narrow. It is NOT a general PDF content-stream
 * parser: it doesn't build an object model for operands, doesn't resolve
 * resources, and bails out (`returns null`) rather than guess on anything it
 * doesn't fully recognize (inline images via `BI`, unbalanced strings/
 * arrays/dicts, stray delimiters). Callers must treat `null` as "don't
 * attempt precise redaction on this page" and fall back to whole-page
 * rasterization instead — see lib/savePdf.ts.
 *
 * Deleting a text-showing operation is then just slicing its byte range out
 * of the original buffer — no reserialization, no operand reformatting, so
 * there's no way for this to subtly corrupt operator syntax elsewhere in
 * the stream.
 */

export interface TextShowingOp {
  start: number
  end: number
}

const WHITESPACE = new Set([0x20, 0x09, 0x0d, 0x0a, 0x0c, 0x00])
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
// ( )  <  >  [  ]  {  }  /  %

function isWhitespace(b: number): boolean {
  return WHITESPACE.has(b)
}
function isDelimiter(b: number): boolean {
  return DELIMITER.has(b)
}
function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b)
}

/** Skip a balanced `( ... )` literal string, honoring `\` escapes. Returns the index just past the closing `)`, or -1 if unterminated. */
function skipLiteralString(bytes: Uint8Array, start: number): number {
  let i = start + 1 // past the opening '('
  let depth = 1
  const n = bytes.length
  while (i < n && depth > 0) {
    const b = bytes[i]
    if (b === 0x5c) {
      i += 2 // backslash escapes the next byte, whatever it is
      continue
    }
    if (b === 0x28) depth++
    else if (b === 0x29) depth--
    i++
  }
  return depth === 0 ? i : -1
}

/** Skip a balanced `<< ... >>` dict, honoring nested dicts and literal strings inside. Returns index past the closing `>>`, or -1. */
function skipDict(bytes: Uint8Array, start: number): number {
  let i = start + 2 // past '<<'
  let depth = 1
  const n = bytes.length
  while (i < n && depth > 0) {
    if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
      depth++
      i += 2
      continue
    }
    if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
      depth--
      i += 2
      continue
    }
    if (bytes[i] === 0x28) {
      const j = skipLiteralString(bytes, i)
      if (j === -1) return -1
      i = j
      continue
    }
    i++
  }
  return depth === 0 ? i : -1
}

/** Skip a `[ ... ]` array, honoring nested arrays/dicts/strings inside (as used by e.g. `TJ`'s kerning array). Returns index past the closing `]`, or -1. */
function skipArray(bytes: Uint8Array, start: number): number {
  let i = start + 1 // past '['
  let depth = 1
  const n = bytes.length
  while (i < n && depth > 0) {
    const b = bytes[i]
    if (b === 0x5b) {
      depth++
      i++
      continue
    }
    if (b === 0x5d) {
      depth--
      i++
      continue
    }
    if (b === 0x28) {
      const j = skipLiteralString(bytes, i)
      if (j === -1) return -1
      i = j
      continue
    }
    if (b === 0x3c && bytes[i + 1] === 0x3c) {
      const j = skipDict(bytes, i)
      if (j === -1) return -1
      i = j
      continue
    }
    i++
  }
  return depth === 0 ? i : -1
}

function keywordAt(bytes: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i])
  return s
}

/**
 * Returns the byte ranges of every `Tj`/`TJ`/`'`/`"` operation in the
 * stream, in encounter order, or `null` if anything in the stream isn't
 * confidently understood (malformed syntax, inline images, or any other
 * construct this tokenizer doesn't recognize).
 */
export function findTextShowingOperations(bytes: Uint8Array): TextShowingOp[] | null {
  const ops: TextShowingOp[] = []
  const n = bytes.length
  let i = 0
  let opStart = -1 // byte offset where the current pending operation's first operand began

  while (i < n) {
    while (i < n && isWhitespace(bytes[i])) i++
    if (i >= n) break

    const tokenStart = i
    const b = bytes[i]

    if (b === 0x25) {
      // % comment — runs to end of line, not part of any operation
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++
      continue
    }

    if (opStart === -1) opStart = tokenStart

    if (b === 0x2f) {
      // /Name
      i++
      while (i < n && isRegular(bytes[i])) i++
      continue
    }

    if (b === 0x28) {
      const j = skipLiteralString(bytes, i)
      if (j === -1) return null
      i = j
      continue
    }

    if (b === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        const j = skipDict(bytes, i)
        if (j === -1) return null
        i = j
      } else {
        // hex string <...>
        i++
        while (i < n && bytes[i] !== 0x3e) i++
        if (i >= n) return null
        i++
      }
      continue
    }

    if (b === 0x5b) {
      const j = skipArray(bytes, i)
      if (j === -1) return null
      i = j
      continue
    }

    if (b === 0x29 || b === 0x3e || b === 0x5d || b === 0x7b || b === 0x7d) {
      // Stray closing delimiter, or a PostScript calculator function ({...})
      // — not expected in ordinary page content, bail rather than guess.
      return null
    }

    // Bare token: a number operand, or a keyword (operator or true/false/null).
    i++
    while (i < n && isRegular(bytes[i])) i++
    const token = keywordAt(bytes, tokenStart, i)
    const c0 = token.charCodeAt(0)
    const looksNumeric = (c0 >= 0x30 && c0 <= 0x39) || token[0] === '+' || token[0] === '-' || token[0] === '.'
    if (looksNumeric || token === 'true' || token === 'false' || token === 'null') {
      continue // operand, keep accumulating into the current operation
    }

    if (token === 'BI' || token === 'ID' || token === 'EI') {
      // Inline image. Its binary data isn't reliably delimitable without
      // trusting an EI byte sequence that could coincidentally occur inside
      // the image's own raw bytes — not worth the risk. Bail.
      return null
    }

    // Any other bare keyword is an operator: it closes the current operation.
    if (token === 'Tj' || token === 'TJ' || token === "'" || token === '"') {
      ops.push({ start: opStart, end: i })
    }
    opStart = -1
  }

  // A trailing, never-closed operand run (stream ends mid-operation) means
  // something is off — bail rather than silently drop a dangling fragment.
  if (opStart !== -1) return null

  return ops
}

/** Delete the given byte ranges (must be sorted, non-overlapping) from `bytes`, returning the spliced result. */
export function removeByteRanges(bytes: Uint8Array, ranges: readonly { start: number; end: number }[]): Uint8Array {
  if (ranges.length === 0) return bytes
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out = new Uint8Array(bytes.length)
  let outPos = 0
  let cursor = 0
  for (const r of sorted) {
    out.set(bytes.subarray(cursor, r.start), outPos)
    outPos += r.start - cursor
    cursor = r.end
  }
  out.set(bytes.subarray(cursor), outPos)
  outPos += bytes.length - cursor
  return out.subarray(0, outPos)
}
