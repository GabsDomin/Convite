const statsRoot = document.querySelector("[data-support-stats]");
const segmentsRoot = document.querySelector("[data-support-segments]");
const recentRsvpRoot = document.querySelector("[data-support-recent-rsvp]");
const rsvpBody = document.querySelector("[data-support-rsvp-body]");
const emptyState = document.querySelector("[data-support-empty]");
const updatedLabel = document.querySelector("[data-support-updated]");
const errorBox = document.querySelector("[data-support-error]");
const searchInput = document.querySelector("[data-support-search]");
const refreshButton = document.querySelector("[data-support-refresh]");
const logoutButton = document.querySelector("[data-support-logout]");
const exportButton = document.querySelector("[data-support-export-csv]");
const giftStatsRoot = document.querySelector("[data-support-gift-stats]");
const giftFunnelRoot = document.querySelector("[data-support-gift-funnel]");
const engagementHint = document.querySelector("[data-support-engagement-hint]");
const catalogBody = document.querySelector("[data-support-catalog-body]");
const visitorsBody = document.querySelector("[data-support-visitors-body]");
const rememberStatsRoot = document.querySelector("[data-support-remember-stats]");
const rememberHint = document.querySelector("[data-support-remember-hint]");
const rememberDevicesBody = document.querySelector("[data-support-remember-devices-body]");
const reservationsBody = document.querySelector("[data-support-reservations-body]");
const inPersonBody = document.querySelector("[data-support-in-person-body]");
const inPersonHint = document.querySelector("[data-support-in-person-hint]");
const openBody = document.querySelector("[data-support-open-body]");
const openHint = document.querySelector("[data-support-open-hint]");
const paymentsBody = document.querySelector("[data-support-payments-body]");
const noGiftVisitRoot = document.querySelector("[data-support-no-gift-visit]");
const giftMoneyRoot = document.querySelector("[data-support-gift-money]");
const exportGiftsButton = document.querySelector("[data-support-export-gifts]");
const giftViewButtons = document.querySelectorAll("[data-gift-view]");
const giftViewPanels = document.querySelectorAll("[data-gift-panel]");
const catalogFilterButtons = document.querySelectorAll("[data-catalog-filter]");
const paymentFilterButtons = document.querySelectorAll("[data-payment-filter]");
const albumStatsRoot = document.querySelector("[data-support-album-stats]");
const albumRecentRoot = document.querySelector("[data-support-album-recent]");
const billingHint = document.querySelector("[data-support-billing-hint]");
const billingGuaranteedEl = document.querySelector("[data-support-billing-guaranteed]");
const billingRemainingEl = document.querySelector("[data-support-billing-remaining]");
const billingCatalogEl = document.querySelector("[data-support-billing-catalog]");
const billingProgressBar = document.querySelector("[data-support-billing-progress-bar]");
const billingProgressLabel = document.querySelector("[data-support-billing-progress-label]");
const billingStatsRoot = document.querySelector("[data-support-billing-stats]");
const billingSplitRoot = document.querySelector("[data-support-billing-split]");
const billingCashRoot = document.querySelector("[data-support-billing-cash]");
const billingGiftsBody = document.querySelector("[data-support-billing-gifts-body]");
const tabButtons = document.querySelectorAll("[data-support-tab]");
const tabPanels = document.querySelectorAll("[data-support-panel]");
const rsvpFilterButtons = document.querySelectorAll("[data-rsvp-filter]");

let overviewCache = null;
let activeRsvpFilter = "all";
let activeTab = "resumo";
let activeGiftView = "visao";
let activeCatalogFilter = "all";
let activePaymentFilter = "all";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function supportStatCard(value, label, { tone = "", currency = false } = {}) {
  const toneClass = tone ? ` support-stat--${tone}` : "";
  const valueClass = currency ? "support-stat-value support-stat-value--currency" : "support-stat-value";
  return `<article class="support-stat${toneClass}"><strong class="${valueClass}">${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></article>`;
}

function paymentStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "pending") return "Pendente";
  if (key === "approved" || key === "paid") return "Aprovado";
  if (key === "rejected") return "Recusado";
  if (key === "cancelled") return "Cancelado";
  if (key === "error") return "Erro";
  return status || "—";
}

function giftTypeLabel(type) {
  if (type === "quota") return "Cota";
  if (type === "open") return "Valor livre";
  return "Fixo";
}

function giftModalityLabel(modality) {
  return modality === "online" ? "Online (aprovado)" : "Pessoalmente";
}

function renderGiftReservationRows(rows, { includeModality = false } = {}) {
  const colspan = includeModality ? 6 : 5;
  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.guest_name)}</td>
          <td>${escapeHtml(row.gift_name)}</td>
          <td>${giftTypeLabel(row.gift_type)}</td>
          <td>${formatMoney(row.amount)}</td>
          ${includeModality ? `<td>${escapeHtml(giftModalityLabel(row.modality))}</td>` : ""}
          <td>${escapeHtml(formatDateTime(row.created_at))}</td>
        </tr>
      `,
    )
    .join("") || `<tr><td colspan="${colspan}">Nenhum registro.</td></tr>`;
}

function setActiveGiftView(viewId) {
  activeGiftView = viewId;
  giftViewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.giftView === viewId);
  });
  giftViewPanels.forEach((panel) => {
    const active = panel.dataset.giftPanel === viewId;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

function yesNo(value) {
  return value ? "Sim" : "—";
}

function showError(message) {
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function setActiveTab(tabId) {
  activeTab = tabId;
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.supportTab === tabId);
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.supportPanel === tabId;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });
}

function renderStats(overview) {
  const { counts, segments, album, gifts, engagement } = overview;

  statsRoot.innerHTML = `
    ${supportStatCard(counts.people, "Pessoas confirmadas")}
    ${supportStatCard(counts.households, "Grupos (titulares)")}
    ${supportStatCard(segments.families.households, "Famílias")}
    ${supportStatCard(segments.couples.households, "Casais")}
    ${supportStatCard(engagement.uniqueSessions ?? 0, "Visitas à lista de presentes")}
    ${supportStatCard(formatMoney(gifts.billing?.guaranteedTotal), "Garantido (presentes)", { tone: "ok", currency: true })}
    ${supportStatCard(formatMoney(gifts.billing?.remainingTotal), "Falta na lista", { tone: "warn", currency: true })}
    ${supportStatCard(gifts.giftsReserved ?? gifts.reserved ?? 0, "Presentes reservados")}
    ${supportStatCard(album.mediaCount ?? 0, "Mídias no álbum")}
    ${supportStatCard(album.contributorCount ?? 0, "Convidados no álbum")}
  `;

  const segmentRows = [
    ["Individual (Somente eu)", segments.solo],
    ["Casal", segments.couples],
    ["Família", segments.families],
    ["Responsável e menores", segments.withMinors],
  ];

  segmentsRoot.innerHTML = segmentRows
    .map(
      ([label, data]) => `
        <li>
          <span>${escapeHtml(label)}</span>
          <strong>${data.households} grupos · ${data.people} pessoas</strong>
        </li>
      `,
    )
    .join("");

  recentRsvpRoot.innerHTML = (overview.recentConfirmations || [])
    .map(
      (household) => `
        <li>
          <strong>${escapeHtml(household.titular)}</strong>
          <span>${escapeHtml(household.partySize)} · ${household.members.length} pessoa(s) · ${escapeHtml(formatDateTime(household.updatedAt))}</span>
        </li>
      `,
    )
    .join("") || "<li><span>Nenhuma confirmação ainda.</span></li>";
}

function householdMatchesSearch(household, query) {
  if (!query) return true;
  const haystack = [
    household.titular,
    household.partySize,
    ...(household.members || []).map((member) => `${member.name} ${member.partySize}`),
  ]
    .join(" ")
    .toLocaleLowerCase("pt-BR");
  return haystack.includes(query);
}

function householdMatchesFilter(household) {
  if (activeRsvpFilter === "all") return true;
  return household.partySize === activeRsvpFilter;
}

function trashButton(rsvpId, label, extraClass = "") {
  return `
    <button class="support-trash ${extraClass}" type="button" data-delete-rsvp="${escapeHtml(rsvpId)}"
      aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
    </button>`;
}

function findRsvpMember(rsvpId) {
  for (const household of overviewCache?.households || []) {
    if (household.id === rsvpId) return { household, member: household.members[0], wholeGroup: true };
    const member = (household.members || []).find((candidate) => candidate.id === rsvpId);
    if (member) return { household, member, wholeGroup: false };
  }
  return null;
}

// Lixeira: confirma dizendo exatamente quem sai, apaga no servidor e recarrega o painel.
async function deleteRsvp(button) {
  const found = findRsvpMember(button.dataset.deleteRsvp);
  if (!found) return;
  const { household, member, wholeGroup } = found;
  const names = wholeGroup ? household.members.map((person) => person.name) : [member.name];
  const message = wholeGroup && names.length > 1
    ? `Remover a confirmação de ${household.titular}?\n\nSaem do convite: ${names.join(", ")}.\n\nIsso não pode ser desfeito.`
    : wholeGroup
      ? `Remover a confirmação de ${household.titular}?\n\nIsso não pode ser desfeito.`
      : `Remover ${member.name} do grupo de ${household.titular}?\n\nIsso não pode ser desfeito.`;
  if (!window.confirm(message)) return;

  button.disabled = true;
  try {
    const response = await fetch(`/api/support/rsvps/${encodeURIComponent(button.dataset.deleteRsvp)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("/apoio/login");
      return;
    }
    if (!response.ok) throw new Error(payload.error || "Não foi possível remover.");
    await loadOverview({ forceFresh: true });
  } catch (error) {
    button.disabled = false;
    showError(error.message || "Não foi possível remover.");
  }
}

function renderHouseholds(households, query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = households.filter(
    (household) => householdMatchesFilter(household) && householdMatchesSearch(household, normalizedQuery),
  );

  rsvpBody.innerHTML = filtered
    .map((household) => {
      const members = (household.members || [])
        .map((member) => `
          <li>
            <strong>${escapeHtml(member.name)}</strong> · ${escapeHtml(member.partySize)}
            ${member.titular || !member.id ? "" : trashButton(member.id, `Remover ${member.name} do grupo`, "support-trash-small")}
          </li>`)
        .join("");
      return `
        <tr>
          <td>${escapeHtml(household.titular)}</td>
          <td><span class="support-tag">${escapeHtml(household.partySize)}</span></td>
          <td>${household.members.length}</td>
          <td>${escapeHtml(formatDateTime(household.updatedAt))}</td>
          <td><ul class="support-members">${members}</ul></td>
          <td>${household.id ? trashButton(household.id, `Remover a confirmação de ${household.titular}`) : ""}</td>
        </tr>
      `;
    })
    .join("");

  emptyState.hidden = filtered.length > 0;
}

function renderGiftsPanel(overview) {
  const gifts = overview.gifts || {};
  const engagement = gifts.engagement || overview.engagement || {};
  const summary = gifts.summary || {};

  giftStatsRoot.innerHTML = `
    ${supportStatCard(engagement.uniqueSessions ?? 0, "Aparelhos na lista")}
    ${supportStatCard(engagement.modalOpens ?? 0, "Presentes abertos")}
    ${supportStatCard(summary.uniqueInPersonReservers ?? 0, "Escolheram pessoalmente")}
    ${supportStatCard(summary.uniquePayers ?? 0, "Iniciaram pagamento online")}
    ${supportStatCard(gifts.giftsAvailable ?? 0, "Disponíveis")}
    ${supportStatCard(gifts.giftsReserved ?? 0, "Reservados")}
    ${supportStatCard(summary.openContributionsCount ?? 0, "Contribuições valor livre", { tone: "ok" })}
    ${supportStatCard(formatMoney(summary.openContributionsTotal), "Total valor livre", { tone: "ok", currency: true })}
    ${supportStatCard(formatMoney(summary.approvedAmount), "Total aprovado (online)", { tone: "ok", currency: true })}
    ${supportStatCard(formatMoney(summary.pendingAmount), "Pendente (online)", { tone: "warn", currency: true })}
  `;

  const funnel = engagement.funnel || {};
  const funnelMax = Math.max(funnel.sawSection || 0, 1);
  giftFunnelRoot.innerHTML = [
    ["Viram a seção de presentes", funnel.sawSection],
    ["Lista carregou no aparelho", funnel.openedList],
    ["Abriram um presente (modal)", funnel.openedGiftModal],
    ["Reservaram ou pagaram", (summary.uniqueReservers || 0) + (summary.uniquePayers || 0)],
  ]
    .map(
      ([label, count]) => `
        <li>
          <div class="support-funnel-row">
            <span>${escapeHtml(label)}</span>
            <strong>${count ?? 0}</strong>
          </div>
          <div class="support-funnel-bar" style="--fill:${Math.round(((count || 0) / funnelMax) * 100)}%"></div>
        </li>
      `,
    )
    .join("");

  if (!engagement.configured) {
    engagementHint.textContent =
      "Visitas ainda não estão sendo gravadas. Confira a tabela site_engagement_events no Supabase.";
  } else {
    engagementHint.textContent =
      "Cada linha é uma sessão do navegador. Nome aparece se confirmou neste aparelho (localStorage ou cookie). “Retorno” = mesma pessoa em outra sessão.";
  }

  const guestRemember = engagement.guestRemember || {};
  const rememberSummary = guestRemember.summary || {};
  if (rememberStatsRoot) {
    if (guestRemember.configured) {
      rememberStatsRoot.hidden = false;
      rememberStatsRoot.innerHTML = `
        ${supportStatCard(rememberSummary.devices ?? 0, "Aparelhos com cookie")}
        ${supportStatCard(rememberSummary.returningDevices ?? 0, "Voltaram (cookie)", { tone: "ok" })}
        ${supportStatCard(rememberSummary.guestsWithDevice ?? 0, "Convidados distintos")}
        ${supportStatCard(engagement.uniqueSessions ?? 0, "Sessões na lista")}
      `;
    } else {
      rememberStatsRoot.hidden = true;
    }
  }

  if (rememberHint) {
    rememberHint.textContent = guestRemember.configured
      ? "Gravado ao confirmar presença (site atualizado). Quem já tinha confirmado pode usar “Ajustar confirmação” uma vez para gerar o cookie."
      : "Tabela rsvp_remember_tokens ainda indisponível.";
  }

  if (rememberDevicesBody) {
    rememberDevicesBody.innerHTML = (guestRemember.devices || [])
      .slice(0, 100)
      .map(
        (device) => `
          <tr>
            <td>${escapeHtml(device.guestName)}</td>
            <td>${escapeHtml(formatDateTime(device.createdAt))}</td>
            <td>${escapeHtml(formatDateTime(device.lastSeenAt))}</td>
            <td>${device.returned ? "Sim" : "Ainda não"}</td>
          </tr>
        `,
      )
      .join("") || `<tr><td colspan="4">Nenhum aparelho lembrado ainda. Novas confirmações aparecem aqui.</td></tr>`;
  }

  const catalog = gifts.catalog || [];
  const filteredCatalog = catalog.filter((item) => {
    if (activeCatalogFilter === "all") return true;
    if (activeCatalogFilter === "available") return item.status === "available";
    if (activeCatalogFilter === "reserved") return item.status === "reserved";
    if (activeCatalogFilter === "quota") return item.type === "quota";
    if (activeCatalogFilter === "open") return item.type === "open";
    return true;
  });

  catalogBody.innerHTML = filteredCatalog
    .map((item) => {
      const valueLabel = item.type === "quota"
        ? `${formatMoney(item.contributed)} / ${formatMoney(item.goal)} (${item.progressPercent ?? 0}%)`
        : item.type === "open"
          ? `${formatMoney(item.contributionTotal ?? item.contributed)} (${item.contributionCount ?? 0} contribuição(ões))`
          : formatMoney(item.value);
      const reservedBy = item.type === "open"
        ? item.contributionCount > 0 && item.reservedBy
          ? `Última: ${item.reservedBy.guestName} · ${formatDateTime(item.reservedBy.at)}`
          : "—"
        : item.reservedBy
          ? `${item.reservedBy.guestName} · ${formatDateTime(item.reservedBy.at)}`
          : "—";
      return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${giftTypeLabel(item.type)}</td>
          <td><span class="support-tag">${escapeHtml(item.status)}</span></td>
          <td>${escapeHtml(valueLabel)}</td>
          <td>${escapeHtml(reservedBy)}</td>
        </tr>
      `;
    })
    .join("") || `<tr><td colspan="5">Nenhum presente no catálogo.</td></tr>`;

  const sessions = engagement.visitorSessions || engagement.recentVisitors || [];
  visitorsBody.innerHTML = sessions
    .slice()
    .sort((a, b) => Date.parse(b.lastSeenAt || "") - Date.parse(a.lastSeenAt || ""))
    .slice(0, 80)
    .map(
      (session) => {
        const visitLabel = session.isReturnVisit
          ? `Retorno (#${session.visitNumber || 2})`
          : "1ª sessão";
        const rsvpLabel = session.guestName
          ? session.confirmedInRsvp
            ? "Confirmado"
            : "Nome não bate"
          : "—";
        return `
        <tr>
          <td>${escapeHtml(session.guestName || "Anônimo")}</td>
          <td><span class="support-tag">${escapeHtml(rsvpLabel)}</span></td>
          <td>${escapeHtml(visitLabel)}</td>
          <td>${yesNo(session.areaViewAt)}</td>
          <td>${yesNo(session.listOpenedAt)}</td>
          <td>${session.modalOpens > 0 ? `Sim (${session.modalOpens})` : "—"}</td>
          <td>${escapeHtml(formatDateTime(session.firstSeenAt || session.lastSeenAt))}</td>
          <td>${escapeHtml(formatDateTime(session.lastSeenAt))}</td>
        </tr>
      `;
      },
    )
    .join("") || `<tr><td colspan="8">Nenhuma visita registrada ainda.</td></tr>`;

  reservationsBody.innerHTML = renderGiftReservationRows(gifts.reservations || [], { includeModality: true });

  const inPersonRows = gifts.inPersonReservations || (gifts.reservations || []).filter((row) => row.modality === "in_person");
  const inPersonPeople = summary.uniqueInPersonReservers ?? new Set(inPersonRows.map((row) => row.guest_name)).size;
  if (inPersonHint) {
    inPersonHint.textContent =
      inPersonRows.length === 0
        ? "Quando alguém confirma um presente escolhendo “Pessoalmente” no modal, o nome aparece aqui. Pagamentos online ficam na aba Pagamentos online."
        : `${inPersonPeople} pessoa(s) escolheram ${inPersonRows.length} presente(s) pessoalmente. Se alguém escolher mais de um item, aparece em várias linhas.`;
  }
  if (inPersonBody) {
    inPersonBody.innerHTML = renderGiftReservationRows(inPersonRows);
  }

  const openRows = gifts.openContributions || (gifts.reservations || []).filter((row) => row.gift_type === "open");
  if (openHint) {
    openHint.textContent =
      openRows.length === 0
        ? "Quando alguém contribuir em “Contribua com o valor que quiser” (pessoalmente ou com pagamento online aprovado), cada contribuição aparece aqui em uma linha."
        : `${openRows.length} contribuição(ões) registrada(s), total ${formatMoney(summary.openContributionsTotal)}. Pagamentos online só entram aqui depois de aprovados; pendentes ficam em Pagamentos online.`;
  }
  if (openBody) {
    openBody.innerHTML = renderGiftReservationRows(openRows, { includeModality: true });
  }

  const payments = (gifts.payments || []).filter((row) => {
    if (activePaymentFilter === "all") return true;
    const status = String(row.status || "").toLowerCase();
    if (activePaymentFilter === "approved") return status === "approved" || status === "paid";
    if (activePaymentFilter === "pending") return status === "pending";
    if (activePaymentFilter === "rejected") return status === "rejected" || status === "cancelled";
    return true;
  });

  paymentsBody.innerHTML = payments
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.guest_name)}</td>
          <td>${escapeHtml(row.gift_name)}</td>
          <td>${formatMoney(row.amount)}</td>
          <td>${escapeHtml(paymentStatusLabel(row.status))}</td>
          <td>${escapeHtml(row.buyer_email || "—")}</td>
          <td>${escapeHtml(row.message || "—")}</td>
          <td>${escapeHtml(formatDateTime(row.paid_at || row.approved_at || row.created_at))}</td>
        </tr>
      `,
    )
    .join("") || `<tr><td colspan="7">Nenhum pagamento online.</td></tr>`;

  const withoutVisit = gifts.insights?.confirmedWithoutGiftVisit || [];
  noGiftVisitRoot.innerHTML = withoutVisit
    .map(
      (name) => `
        <li><strong>${escapeHtml(name)}</strong><span>Ainda não apareceu na área de presentes (neste aparelho ou anônimo)</span></li>
      `,
    )
    .join("") || "<li><span>Todos os titulares confirmados já apareceram na lista ou ainda não há dados.</span></li>";

  giftMoneyRoot.innerHTML = `
    <li><span>Valor simbólico reservado (fixos)</span><strong>${formatMoney(summary.reservedAmount)}</strong></li>
    <li><span>Contribuições valor livre</span><strong>${formatMoney(summary.openContributionsTotal)}</strong></li>
    <li><span>Pagamentos aprovados online</span><strong>${formatMoney(summary.approvedAmount)}</strong></li>
    <li><span>Pagamentos pendentes</span><strong>${formatMoney(summary.pendingAmount)}</strong></li>
    <li><span>Cotas em andamento</span><strong>${summary.quotaInProgress ?? 0}</strong></li>
    <li><span>Confirmados que visitaram presentes</span><strong>${gifts.insights?.confirmedWhoVisitedGifts ?? 0}</strong></li>
  `;
}

function renderBillingPanel(overview) {
  const billing = overview.gifts?.billing || {};
  const services = overview.services || {};

  if (billingHint) {
    billingHint.textContent =
      "Valores simbólicos da lista (R$). Garantido = itens fixos já reservados + total arrecadado em cotas. Falta = meta total menos garantido. Recebido online conta só pagamentos aprovados no Mercado Pago.";
  }

  if (billingGuaranteedEl) billingGuaranteedEl.textContent = formatMoney(billing.guaranteedTotal);
  if (billingRemainingEl) billingRemainingEl.textContent = formatMoney(billing.remainingTotal);
  if (billingCatalogEl) billingCatalogEl.textContent = formatMoney(billing.catalogTotal);
  if (billingProgressBar) billingProgressBar.style.setProperty("--fill", `${billing.progressPercent ?? 0}%`);
  if (billingProgressLabel) {
    billingProgressLabel.textContent = `${billing.progressPercent ?? 0}% da meta da lista`;
  }

  if (billingStatsRoot) {
    billingStatsRoot.innerHTML = `
      ${supportStatCard(formatMoney(billing.fixedGuaranteed), "Fixos garantidos", { currency: true })}
      ${supportStatCard(formatMoney(billing.fixedRemaining), "Fixos ainda livres", { currency: true })}
      ${supportStatCard(formatMoney(billing.quotaGuaranteed), "Cotas arrecadadas", { tone: "ok", currency: true })}
      ${supportStatCard(formatMoney(billing.quotaRemaining), "Cotas ainda faltando", { tone: "warn", currency: true })}
      ${supportStatCard(formatMoney(billing.openGuaranteed), "Valor livre arrecadado", { tone: "ok", currency: true })}
    `;
  }

  if (billingSplitRoot) {
    billingSplitRoot.innerHTML = `
      <li><span>Meta em presentes fixos</span><strong>${formatMoney(billing.fixedCatalogTotal)}</strong></li>
      <li><span>Garantido em fixos</span><strong>${formatMoney(billing.fixedGuaranteed)}</strong></li>
      <li><span>Falta em fixos</span><strong>${formatMoney(billing.fixedRemaining)}</strong></li>
      <li><span>Meta em cotas</span><strong>${formatMoney(billing.quotaCatalogTotal)}</strong></li>
      <li><span>Garantido em cotas</span><strong>${formatMoney(billing.quotaGuaranteed)}</strong></li>
      <li><span>Falta em cotas</span><strong>${formatMoney(billing.quotaRemaining)}</strong></li>
      <li><span>Valor livre (sem meta)</span><strong>${formatMoney(billing.openGuaranteed)}</strong></li>
    `;
  }

  if (billingCashRoot) {
    billingCashRoot.innerHTML = `
      <li><span>Recebido online (aprovado)</span><strong>${formatMoney(billing.receivedOnline)}</strong></li>
      <li><span>Comprometido pessoalmente</span><strong>${formatMoney(billing.committedInPerson)}</strong></li>
      <li><span>Valor livre registrado</span><strong>${formatMoney(billing.openGuaranteed)}</strong></li>
      <li><span>Pagamentos online pendentes</span><strong>${formatMoney(billing.pendingOnline)}</strong></li>
      <li><span>Mercado Pago</span><strong>${services.mercadoPagoConfigured ? "Configurado" : "Não configurado"}</strong></li>
    `;
  }

  if (billingGiftsBody) {
    billingGiftsBody.innerHTML = (billing.giftRows || [])
      .map((row) => {
        const statusLabel = row.type === "open"
          ? `${row.contributionCount ?? 0} contribuição(ões)`
          : row.type === "quota"
          ? row.remainingAmount <= 0
            ? "Meta atingida"
            : `${row.progressPercent ?? 0}% da meta`
          : row.status === "reserved"
            ? "Reservado"
            : "Disponível";
        return `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${giftTypeLabel(row.type)}</td>
            <td>${formatMoney(row.catalogAmount)}</td>
            <td>${formatMoney(row.guaranteedAmount)}</td>
            <td>${formatMoney(row.remainingAmount)}</td>
            <td><span class="support-tag">${escapeHtml(statusLabel)}</span></td>
          </tr>
        `;
      })
      .join("") || `<tr><td colspan="6">Nenhum presente na lista.</td></tr>`;
  }
}

function renderAlbumPanel(overview) {
  const { album } = overview;

  albumStatsRoot.innerHTML = `
    <article class="support-stat"><strong>${album.mediaCount ?? 0}</strong><span>Fotos e vídeos</span></article>
    <article class="support-stat"><strong>${album.contributorCount ?? 0}</strong><span>Convidados que enviaram</span></article>
    <article class="support-stat"><strong>${album.publicOpen ? "Aberto" : "Fechado"}</strong><span>Álbum para convidados</span></article>
  `;

  albumRecentRoot.innerHTML = (album.recentUploads || [])
    .map(
      (item) => `
        <li>
          <strong>${escapeHtml(item.guest_name)} · ${escapeHtml(item.category || "Sem categoria")}</strong>
          <span>${escapeHtml(formatDateTime(item.created_at))}</span>
        </li>
      `,
    )
    .join("") || "<li><span>Nenhuma mídia no álbum ainda.</span></li>";
}

function renderAll(overview) {
  renderStats(overview);
  renderHouseholds(overview.households || [], searchInput.value);
  renderGiftsPanel(overview);
  renderBillingPanel(overview);
  renderAlbumPanel(overview);
}

async function requireSession() {
  const response = await fetch("/api/support/session", { credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.authenticated) {
    window.location.replace("/apoio/login");
    return false;
  }
  const operator = document.querySelector("[data-support-operator]");
  if (operator && payload.guestName) {
    operator.hidden = false;
    operator.textContent = `Conectado como ${payload.guestName}`;
  }
  return true;
}

async function loadOverview({ forceFresh = false } = {}) {
  clearError();
  const showFullLoading = !overviewCache;
  if (showFullLoading) {
    updatedLabel.textContent = "Carregando…";
  } else {
    updatedLabel.textContent = "Atualizando…";
  }
  refreshButton.disabled = true;

  try {
    const url = forceFresh ? "/api/support/overview?fresh=1" : "/api/support/overview";
    const response = await fetch(url, { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      window.location.replace("/apoio/login");
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível carregar o painel.");
    }

    overviewCache = payload;
    renderAll(payload);
    updatedLabel.textContent = `Atualizado ${formatDateTime(payload.generatedAt)}`;
  } catch (error) {
    showError(error.message || "Erro ao carregar dados.");
    updatedLabel.textContent = "Falha ao atualizar";
  } finally {
    refreshButton.disabled = false;
  }
}

function exportGiftsCsv() {
  if (!overviewCache?.gifts) return;
  const gifts = overviewCache.gifts;
  const rows = [["Tipo registro", "Convidado", "Presente", "Valor", "Modalidade", "Status", "E-mail", "Mensagem", "Data"]];

  for (const row of gifts.openContributions || gifts.reservations?.filter((item) => item.gift_type === "open") || []) {
    rows.push([
      "Valor livre",
      row.guest_name,
      row.gift_name,
      row.amount,
      row.modality === "online" ? "Online" : "Pessoalmente",
      "registrado",
      "",
      "",
      row.created_at || "",
    ]);
  }
  for (const row of gifts.reservations || []) {
    if (row.gift_type === "open") continue;
    rows.push([
      "Reserva",
      row.guest_name,
      row.gift_name,
      row.amount,
      row.modality === "online" ? "Online" : "Pessoalmente",
      "reservado",
      "",
      "",
      row.created_at || "",
    ]);
  }
  for (const row of gifts.payments || []) {
    rows.push([
      "Pagamento",
      row.guest_name,
      row.gift_name,
      row.amount,
      "Online",
      row.status,
      row.buyer_email || "",
      row.message || "",
      row.paid_at || row.created_at || "",
    ]);
  }
  for (const item of gifts.catalog || []) {
    rows.push([
      "Catalogo",
      item.reservedBy?.guestName || "",
      item.name,
      item.value || item.goal || "",
      "",
      item.status,
      "",
      "",
      item.reservedBy?.at || "",
    ]);
  }

  downloadCsv(rows, `presentes-gab-naia-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadCsv(rows, filename) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  if (!overviewCache?.households?.length) return;

  const rows = [["Titular", "Tipo", "Membro", "Papel do membro", "Atualizado"]];
  for (const household of overviewCache.households) {
    for (const member of household.members || []) {
      rows.push([
        household.titular,
        household.partySize,
        member.name,
        member.partySize,
        household.updatedAt || "",
      ]);
    }
  }

  downloadCsv(rows, `confirmacoes-gab-naia-${new Date().toISOString().slice(0, 10)}.csv`);
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.supportTab || "resumo");
  });
});

rsvpFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeRsvpFilter = button.dataset.rsvpFilter || "all";
    rsvpFilterButtons.forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });
    if (overviewCache) renderHouseholds(overviewCache.households || [], searchInput.value);
  });
});

searchInput.addEventListener("input", () => {
  if (!overviewCache) return;
  renderHouseholds(overviewCache.households || [], searchInput.value);
});

refreshButton.addEventListener("click", () => {
  loadOverview({ forceFresh: true });
});

rsvpBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-rsvp]");
  if (button) deleteRsvp(button);
});

exportButton.addEventListener("click", exportCsv);
exportGiftsButton?.addEventListener("click", exportGiftsCsv);

giftViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveGiftView(button.dataset.giftView || "visao");
  });
});

catalogFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeCatalogFilter = button.dataset.catalogFilter || "all";
    catalogFilterButtons.forEach((chip) => chip.classList.toggle("is-active", chip === button));
    if (overviewCache) renderGiftsPanel(overviewCache);
  });
});

paymentFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activePaymentFilter = button.dataset.paymentFilter || "all";
    paymentFilterButtons.forEach((chip) => chip.classList.toggle("is-active", chip === button));
    if (overviewCache) renderGiftsPanel(overviewCache);
  });
});

logoutButton.addEventListener("click", async () => {
  try {
    await fetch("/api/support/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    window.location.replace("/apoio/login");
  }
});

(async () => {
  if (!(await requireSession())) return;
  setActiveTab(activeTab);
  setActiveGiftView(activeGiftView);
  await loadOverview();
})();
