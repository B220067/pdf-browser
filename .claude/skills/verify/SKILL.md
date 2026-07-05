---
name: verify
description: Build, launch and drive InkPDF (client-side PDF editor) end-to-end with headless Chromium; verify edits are baked into the downloaded PDF.
---

# Verifying InkPDF

Surface: browser GUI (Vite SPA). Everything runs locally; no server code.

## Recipe that works

```powershell
npm run build                 # tsc -b && vite build
npm run preview               # serves dist/ on http://localhost:4173 (run in background)
node e2e/make-sample.mjs      # writes e2e/sample.pdf (page 1 normal, page 2 /Rotate 90)
node e2e/drive.mjs            # Playwright: upload → add text → draw → download → reopen
node e2e/check-text.mjs       # asserts typed strings exist in e2e/edited.pdf per page
node e2e/shots.mjs            # full-page element screenshots of the reopened file

# Encryption guard (see Gotchas below):
python e2e/make-encrypted.py  # needs `pip install pypdf`; writes e2e/encrypted-owner.pdf
node e2e/drive-encrypted.mjs  # asserts encrypted PDFs are rejected at upload, not at save

# Feature suites (run against dev server via APP_URL=http://localhost:5173/):
node e2e/phase1-check.mjs     # undo/redo (incl. coalesced typing) + reusable signature stamp
node e2e/make-3page.mjs && node e2e/phase2-check.mjs   # page delete/rotate/reorder + export
node e2e/make-form.mjs && node e2e/phase3-check.mjs    # AcroForm fill + flatten + reorder interplay
node e2e/signature-move-check.mjs                      # stamped signature selects/moves as one group
node e2e/fonts-colors-check.mjs && node e2e/fonts-verify.mjs  # font list, color swatches, Great Vibes embed
node e2e/signature-resize-check.mjs                    # corner-handle resize scales group uniformly
```

Prereqs: `playwright` is a devDependency; run `npx playwright install chromium` once.

## Gotchas learned the hard way

- **Use a tall viewport (e.g. 1100x2600) in Playwright.** Pages render ~1336px
  tall; `page.mouse.click()` at coordinates below the viewport silently hits
  nothing and the test "types into the void".
- The typed text must be verified in the DOWNLOADED file (`check-text.mjs`
  extracts text via pdfjs-dist legacy build in Node), not just on screen —
  the overlay and the baked PDF are separate code paths.
- Reopening the downloaded PDF in the app is the best visual check: edits then
  come from the file itself, rendered by pdf.js onto canvas.
- Node scripts must live inside the project tree (ESM resolves `pdf-lib` /
  `pdfjs-dist` relative to the script's own path, not cwd).
- pdf.js in Node warns `standardFontDataUrl` — harmless for text extraction.
- Flows worth driving: text box on a normal page, text box on the ROTATED
  page 2 (coordinate mapping regression), freehand stroke, non-PDF upload
  (expects role=alert), keyboard shortcuts v/t/d/e + Escape.
- **Reopened-file assertions must check canvas pixels, not overlay DOM.**
  After export+reopen, ink/text is baked into the PDF and rendered onto the
  canvas; the SVG/textarea overlays are empty by design. phase1-check.mjs
  scans canvas pixels for the pen color instead of counting `svg path`.
- **pdf-lib-created radio groups use appearance-state names ('0','1') as
  widget on-values**, with human labels in /Opt. pdf.js reports the state
  name as `buttonValue`; savePdf.ts maps state-name → option label by index
  before calling `PDFRadioGroup.select()`.
- **Form fill+flatten must run BEFORE any page copy/reorder** in savePdf.ts:
  `copyPages` doesn't carry the document-level AcroForm to a new document,
  so live fields would be silently lost. Flattened content copies fine.
- **useCallback dep lists in PdfEditor**: `handleDownload` must depend on
  every state slice it exports (texts, strokes, pageOrder, formFieldValues)
  — a missing dep exports a stale snapshot (this bit us with pageOrder).
- **Font names can't be grepped from saved PDFs** — pdf-lib's default
  `useObjectStreams` compresses dictionaries, so assert embedded fonts via
  pdf.js: `getOperatorList()` then `page.commonObjs.get(fontId).name`.
- **fontkit (~700 kB) is dynamically imported** in savePdf.ts so only
  exports using Great Vibes load it; keep it out of static imports.
- **pdf-lib has no encryption/decryption support.** `PDFDocument.load(bytes,
  { ignoreEncryption: true })` reads encrypted streams as-is and `.save()`
  re-emits the original `/Encrypt` trailer entry verbatim — confirmed by
  testing (`make-encrypted.py` builds an owner-password-only PDF that needs
  NO password to view; after a round-trip through `exportEditedPdf` it
  suddenly demands a password pdf.js can't satisfy — i.e. `.save()` produces
  a strictly worse, unopenable file). Don't try to add an "export anyway"
  path for encrypted PDFs — [savePdf.ts](../../../src/lib/savePdf.ts)
  rejects them via `isPdfEncrypted`/`EncryptedPdfError` at upload time
  instead, before the user invests any editing effort.
