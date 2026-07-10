import { findTextShowingOperations, removeByteRanges } from '../src/lib/redactContentStream.ts'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`PASS: ${name}`)
  } else {
    failures++
    console.log(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`)
  }
}

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

// --- basic Tj / TJ / ' / " detection ---
{
  const src = `BT /F1 12 Tf 100 700 Td (Hello World) Tj ET`
  const ops = findTextShowingOperations(enc(src))!
  check('finds one Tj op', ops.length, 1)
  check('Tj op text matches', dec(enc(src)).slice(ops[0].start, ops[0].end), '(Hello World) Tj')
}

{
  const src = `BT /F1 12 Tf 100 700 Td [(Hello) -250 (World)] TJ ET`
  const ops = findTextShowingOperations(enc(src))!
  check('finds one TJ op with kerning array', ops.length, 1)
  check('TJ op range correct', dec(enc(src)).slice(ops[0].start, ops[0].end), '[(Hello) -250 (World)] TJ')
}

{
  const src = `BT (Line1) ' (Line2) " ET` // note: " normally takes 2 numeric operands too
  const src2 = `BT 0 0 0 (Line1) ' 0 0 (Line2) " ET`
  const ops = findTextShowingOperations(enc(src2))!
  check("finds ' and \" ops", ops.length, 2)
}

// --- multiple words, per-word Tj (mirrors make-sentence.mjs) ---
{
  const src = `BT /F1 18 Tf 40 700 Td (Annex) Tj 60 0 Td (A:) Tj 40 0 Td (Details) Tj 90 0 Td (on) Tj ET`
  const ops = findTextShowingOperations(enc(src))!
  check('finds 4 per-word Tj ops', ops.length, 4)
  const bytes = enc(src)
  const words = ops.map((o) => dec(bytes.slice(o.start, o.end)))
  check('word ops in order', words, ['(Annex) Tj', '(A:) Tj', '(Details) Tj', '(on) Tj'])
}

// --- escaped parens inside a literal string must not break balance ---
{
  const src = `BT (Say \\(hi\\) to me) Tj ET`
  const ops = findTextShowingOperations(enc(src))!
  check('escaped parens handled', ops.length, 1)
  check('escaped-paren string range correct', dec(enc(src)).slice(ops[0].start, ops[0].end), '(Say \\(hi\\) to me) Tj')
}

// --- nested unescaped parens (legal in PDF strings) must balance ---
{
  const src = `BT (outer (inner) text) Tj ET`
  const ops = findTextShowingOperations(enc(src))!
  check('nested unescaped parens balance', ops.length, 1)
}

// --- comments should be skipped without affecting operation boundaries ---
{
  const src = `BT % a comment\n(Hello) Tj ET`
  const ops = findTextShowingOperations(enc(src))!
  check('comment skipped, still finds Tj', ops.length, 1)
}

// --- BDC/EMC marked content with a property dict shouldn't confuse parsing ---
{
  const src = `/OC /MC0 BDC BT (Hello) Tj ET EMC`
  const ops = findTextShowingOperations(enc(src))!
  check('BDC name-operand form ok', ops.length, 1)
}
{
  const src = `BDC <</MCID 0>> BT (Hello) Tj ET EMC` // malformed order but tests dict skip in general position
  const src2 = `<< /MCID 0 >> BDC BT (Hello) Tj ET EMC`
  const ops = findTextShowingOperations(enc(src2))!
  check('BDC with inline property dict operand', ops.length, 1)
}

// --- inline images: must bail (return null), never guess ---
{
  const src = `BT (Hello) Tj ET BI /W 2 /H 2 /BPC 8 /CS /RGB ID \x00\x01\x02\xff\xfe\xfd EI Q`
  const ops = findTextShowingOperations(enc(src))
  check('inline image triggers bail (null)', ops, null)
}

// --- unterminated string must bail, not hang or misparse ---
{
  const src = `BT (unterminated Tj ET`
  const ops = findTextShowingOperations(enc(src))
  check('unterminated string triggers bail', ops, null)
}

// --- unbalanced array must bail ---
{
  const src = `BT [(a) -10 (b) TJ ET` // missing closing ]
  const ops = findTextShowingOperations(enc(src))
  check('unbalanced array triggers bail', ops, null)
}

// --- removeByteRanges: deleting ops leaves everything else byte-identical ---
{
  const src = `BT /F1 18 Tf 40 700 Td (Annex) Tj 60 0 Td (SECRET) Tj 90 0 Td (Value) Tj ET`
  const bytes = enc(src)
  const ops = findTextShowingOperations(bytes)!
  check('3 ops found for splice test', ops.length, 3)
  const toRemove = [ops[1]] // remove the middle "(SECRET) Tj"
  const spliced = removeByteRanges(bytes, toRemove)
  const result = dec(spliced)
  check('SECRET removed, other ops intact', result.includes('SECRET'), false)
  check('Annex survives', result.includes('(Annex) Tj'), true)
  check('Value survives', result.includes('(Value) Tj'), true)
  check('positioning Td calls untouched (60 0 Td still present)', result.includes('60 0 Td'), true)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
