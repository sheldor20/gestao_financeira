/** Read API responses without exposing HTML error pages as JSON parse errors. */
export async function readApiResponse<T extends object>(
  response: Response,
  fallback: string,
): Promise<T> {
  if (response.redirected || response.status === 401) {
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // Hosting errors (including timeouts and oversized uploads) may return HTML.
  }

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("O arquivo excede o limite de envio do servidor. Envie um PDF menor.");
    }
    if (response.status === 504 || response.status === 408) {
      throw new Error("O servidor excedeu o tempo de processamento. Consulte Documentos para verificar o resultado antes de tentar novamente.");
    }
    if (payload && typeof payload === "object" && "error" in payload &&
        typeof payload.error === "string" && payload.error.trim()) {
      throw new Error(payload.error);
    }
    throw new Error(`${fallback} O servidor retornou um erro (HTTP ${response.status}).`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("O servidor retornou uma resposta inválida. Atualize a página e consulte Documentos antes de tentar novamente.");
  }
  return payload as T;
}
