import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const projectFile = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("funções sensíveis do Supabase não são liberadas para clientes públicos", async () => {
  const [functionsSql, paymentsSql] = await Promise.all([
    projectFile("supabase-functions.sql"),
    projectFile("supabase-payments.sql"),
  ]);
  const sql = `${functionsSql}\n${paymentsSql}`;

  assert.doesNotMatch(sql, /grant\s+execute[^;]*\bto\s+(?:anon|authenticated)\b/i);
  assert.match(sql, /grant execute on function public\.confirm_mercadopago_payment[\s\S]*?to service_role/i);
  assert.match(sql, /revoke execute on function public\.confirm_mercadopago_payment[\s\S]*?from public, anon, authenticated/i);
});

test("frontend escapa conteúdo remoto e não contém manipulador inline", async () => {
  const script = await projectFile("script.js");

  assert.doesNotMatch(script, /onerror\s*=/i);
  assert.match(script, /escapeHtml\(gift\.name\)/);
  assert.match(script, /escapeHtml\(gift\.text\)/);
  assert.match(script, /document\.addEventListener\("error"/);
});
