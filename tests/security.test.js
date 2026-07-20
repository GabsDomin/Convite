import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const projectFile = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("funções sensíveis do Supabase não são liberadas para clientes públicos", async () => {
  const [functionsSql, paymentsSql, restrictedGuestsSql, rsvpGuestsSql] = await Promise.all([
    projectFile("supabase-functions.sql"),
    projectFile("supabase-payments.sql"),
    projectFile("supabase-restricted-guests.sql"),
    projectFile("supabase-rsvp-guests.sql"),
  ]);
  const sql = `${functionsSql}\n${paymentsSql}\n${restrictedGuestsSql}\n${rsvpGuestsSql}`;

  assert.doesNotMatch(sql, /grant\s+execute[^;]*\bto\s+(?:anon|authenticated)\b/i);
  assert.match(sql, /grant execute on function public\.confirm_mercadopago_payment[\s\S]*?to service_role/i);
  assert.match(sql, /revoke execute on function public\.confirm_mercadopago_payment[\s\S]*?from public, anon, authenticated/i);
});

test("migração de acompanhantes mantém a RPC restrita ao servidor", async () => {
  const sql = await projectFile("supabase-rsvp-guests.sql");

  assert.match(sql, /revoke execute on function public\.confirm_rsvp\(text, text, text\[\]\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.confirm_rsvp\(text, text, text\[\]\) to service_role/i);
  assert.match(sql, /restricted_guests[\s\S]*?additional_guest_names/i);
});

test("lista restrita é privada e bloqueia a confirmação antes de salvar", async () => {
  const [restrictedGuestsSql, server, script] = await Promise.all([
    projectFile("supabase-restricted-guests.sql"),
    projectFile("server.js"),
    projectFile("script.js"),
  ]);

  assert.match(restrictedGuestsSql, /alter table public\.restricted_guests enable row level security/i);
  assert.match(restrictedGuestsSql, /revoke all on table public\.restricted_guests from public, anon, authenticated/i);
  assert.match(restrictedGuestsSql, /if exists[\s\S]*?restricted_guests[\s\S]*?raise exception 'Infelizmente, seu nome não está na lista de convidados\.'/i);
  assert.ok(restrictedGuestsSql.indexOf("if exists") < restrictedGuestsSql.indexOf("insert into public.rsvps"));
  assert.match(server, /code: "guest_not_invited"/);
  assert.match(script, /error\.code === "guest_not_invited"/);
  assert.match(script, /Infelizmente, seu nome não está na lista de convidados\./);
});

test("frontend escapa conteúdo remoto e não contém manipulador inline", async () => {
  const script = await projectFile("script.js");

  assert.doesNotMatch(script, /onerror\s*=/i);
  assert.match(script, /escapeHtml\(gift\.name\)/);
  assert.match(script, /escapeHtml\(gift\.text\)/);
  assert.match(script, /document\.addEventListener\("error"/);
});
