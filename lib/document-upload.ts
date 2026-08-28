const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
};

const CANONICAL_MIME_TYPES: Record<string, string> = {
  "application/pdf": "application/pdf",
  "text/csv": "text/csv",
  "text/plain": "text/plain",
  "application/vnd.ms-excel": "text/csv",
};

export function normalizeFinancialDocumentContentType(input: {
  name: string;
  type: string;
}) {
  const extension = input.name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension = MIME_BY_EXTENSION[extension];
  if (byExtension) return byExtension;

  return CANONICAL_MIME_TYPES[input.type.toLowerCase()] ?? null;
}
