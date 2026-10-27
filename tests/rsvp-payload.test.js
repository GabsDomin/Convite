import assert from "node:assert/strict";
import { test } from "node:test";

function hasFullGuestName(value) {
  const parts = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length >= 2);
}

function buildRsvpPayload(formData) {
  const guestName = String(formData.get("guestName") || "").trim().replace(/\s+/g, " ");
  const includePartner = formData.get("includePartner") === "on";
  const includeChildren = formData.get("includeChildren") === "on";
  const partnerName = String(formData.get("partnerName") || "").trim().replace(/\s+/g, " ");
  const childrenNames = formData
    .getAll("childrenNames")
    .map((name) => String(name || "").trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (!hasFullGuestName(guestName)) {
    return { error: "Informe seu nome e sobrenome." };
  }

  if (includePartner) {
    if (!hasFullGuestName(partnerName)) {
      return { error: "Informe o nome e sobrenome do seu parceiro ou parceira." };
    }
    if (includeChildren && childrenNames.length === 0) {
      return { error: "Informe o nome de pelo menos um filho." };
    }
    const additionalGuestNames = includeChildren ? [partnerName, ...childrenNames] : [partnerName];
    if (additionalGuestNames.some((name) => !hasFullGuestName(name))) {
      return { error: "Informe nome e sobrenome de cada pessoa." };
    }
    if (includeChildren) {
      return { guestName, partySize: "Família", additionalGuestNames };
    }
    return { guestName, partySize: "Casal", additionalGuestNames };
  }

  if (includeChildren) {
    if (childrenNames.length === 0) {
      return { error: "Informe o nome de pelo menos um filho." };
    }
    return { guestName, partySize: "Responsável e menores", additionalGuestNames: childrenNames };
  }

  return { guestName, partySize: "Somente eu", additionalGuestNames: [] };
}

test("payload inclui parceiro na confirmação de casal", () => {
  const formData = new FormData();
  formData.set("guestName", "Maria Silva");
  formData.set("includePartner", "on");
  formData.set("partnerName", "João Souza");
  const payload = buildRsvpPayload(formData);

  assert.equal(payload.partySize, "Casal");
  assert.deepEqual(payload.additionalGuestNames, ["João Souza"]);
});

test("payload inclui filhos na confirmação de responsável", () => {
  const formData = new FormData();
  formData.set("guestName", "Maria Silva");
  formData.set("includeChildren", "on");
  formData.append("childrenNames", "Ana Souza");
  formData.append("childrenNames", "Pedro Souza");
  const payload = buildRsvpPayload(formData);

  assert.equal(payload.partySize, "Responsável e menores");
  assert.deepEqual(payload.additionalGuestNames, ["Ana Souza", "Pedro Souza"]);
});

test("payload inclui parceiro e filhos juntos", () => {
  const formData = new FormData();
  formData.set("guestName", "Maria Silva");
  formData.set("includePartner", "on");
  formData.set("includeChildren", "on");
  formData.set("partnerName", "João Souza");
  formData.append("childrenNames", "Ana Souza");
  const payload = buildRsvpPayload(formData);

  assert.equal(payload.partySize, "Família");
  assert.deepEqual(payload.additionalGuestNames, ["João Souza", "Ana Souza"]);
});
