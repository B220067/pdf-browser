/** Loose PDF check for drag/drop and file-picker input: real MIME type, or a .pdf extension as a fallback for browsers/OSes that report an empty type. */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}
