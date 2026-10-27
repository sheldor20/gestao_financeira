import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../lib/api-response.ts";

test("retorna os resultados de uma importação concluída", async () => {
  const data = { documentId: "document", imported: 3 };
  assert.deepEqual(await readApiResponse(Response.json(data, { status: 201 }), "Falha"), data);
});

test("preserva a mensagem de validação do servidor", async () => {
  await assert.rejects(readApiResponse(Response.json({ error: "Este documento já foi importado." }, { status: 409 }), "Falha"), /já foi importado/);
});

test("página HTML de erro não causa Unexpected token", async () => {
  await assert.rejects(readApiResponse(new Response('<!--# r3N4--><html>Erro</html>', { status: 500 }), "Falha na importação."), /HTTP 500/);
});

test("HTML com status 200 nunca é considerado uma importação concluída", async () => {
  await assert.rejects(readApiResponse(new Response('<html>Login</html>'), "Falha"), /resposta inválida/);
});

test("respostas JSON vazias, nulas e listas são rejeitadas", async () => {
  for (const response of [new Response(null, { status: 204 }), Response.json(null), Response.json([])]) {
    await assert.rejects(readApiResponse(response, "Falha"), /resposta inválida/);
  }
});

test("sessão expirada e redirecionamento orientam novo login", async () => {
  const redirected = new Response('<html>Login</html>');
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const response of [redirected, new Response(null, { status: 401 })]) {
    await assert.rejects(readApiResponse(response, "Falha"), /sessão expirou/);
  }
});

test("identifica limite de upload e timeout mesmo sem JSON", async () => {
  await assert.rejects(readApiResponse(new Response("too large", { status: 413 }), "Falha"), /PDF menor/);
  await assert.rejects(readApiResponse(new Response("timeout", { status: 504 }), "Falha"), /Consulte Documentos/);
});
