import { useCallback, useState } from 'react'
import { DropZone } from './components/DropZone'
import { MergePdfs } from './components/MergePdfs'
import { PdfEditor } from './components/PdfEditor'

interface LoadedFile {
  /** Monotonic id so re-opening the same file fully remounts the editor. */
  id: number
  bytes: ArrayBuffer
  name: string
}

export default function App() {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [showMerge, setShowMerge] = useState(false)

  const handleFile = useCallback((bytes: ArrayBuffer, name: string) => {
    setFile((prev) => ({ id: (prev?.id ?? 0) + 1, bytes, name }))
  }, [])

  if (file) {
    return (
      <PdfEditor
        key={file.id}
        bytes={file.bytes}
        fileName={file.name}
        onClose={() => setFile(null)}
      />
    )
  }

  if (showMerge) {
    return <MergePdfs onBack={() => setShowMerge(false)} />
  }

  return <DropZone onFile={handleFile} onMergeClick={() => setShowMerge(true)} />
}
