# InkPDF

Free browser PDF editor. Add/ resize text, draw/sign, and download. Everything runs locally in your browser: your file is never uploaded or sent anywhere. 

## Stack

- Vite + React + TypeScript + Tailwind
- `pdfjs-dist` — renders pages to canvas
- `pdf-lib` — writes edits into the file on save
- Standard PDF fonts only (Helvetica, Times New Roman, Courier)

## Run

```bash
npm install
npm run dev        
npm run build
npm run preview
```

## Structure

```
src/
  types.ts            shared types + constants
  lib/
    coords.ts          screen <-> PDF coordinate mapping
    smoothing.ts        polyline -> smooth SVG path
    pdfjs.ts             pdf.js worker + loading
    savePdf.ts            pdf-lib export
    editorState.ts        reducer for tools/text/strokes
  components/
    DropZone.tsx        upload screen
    PdfEditor.tsx        doc loading, zoom, shortcuts, save
    PdfPage.tsx          per-page canvas + overlays
    TextBoxItem.tsx      draggable text box
    InkLayer.tsx         drawing/erasing layer
    Toolbar.tsx          tools, zoom, download
```