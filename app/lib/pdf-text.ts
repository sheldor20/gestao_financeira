import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(bytes: Uint8Array) {
  // PDF.js transfers the supplied buffer to its worker and detaches it. Parse a
  // copy so the original bytes remain available if the document needs the AI
  // extraction fallback.
  const pdf = await getDocumentProxy(bytes.slice());
  return (await extractText(pdf, { mergePages: true })).text;
}
