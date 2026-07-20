const uploadDialog = document.querySelector("[data-upload-dialog]");
const uploadForm = document.querySelector("[data-upload-form]");
const fileInput = document.querySelector("[data-memory-files]");
const selectedFiles = document.querySelector("[data-selected-files]");
const uploadError = document.querySelector("[data-upload-error]");
const memoryGrid = document.querySelector("[data-memory-grid]");
const memoryCount = document.querySelector("[data-memory-count]");
const galleryEmpty = document.querySelector("[data-gallery-empty]");
const lightbox = document.querySelector("[data-lightbox]");
const lightboxMedia = document.querySelector("[data-lightbox-media]");
const lightboxCaption = document.querySelector("[data-lightbox-caption]");
const toast = document.querySelector("[data-toast]");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const allowedVideoTypes = new Set(["video/mp4", "video/quicktime"]);
const activeObjectUrls = new Set();
let activeFilter = "Todos";
let toastTimer;

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showUploadError(message = "") {
  uploadError.textContent = message;
  uploadError.hidden = !message;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function validateFiles(files) {
  if (files.length === 0) return "Escolha pelo menos uma foto ou vídeo.";
  if (files.length > 10) return "Escolha no máximo 10 arquivos por envio.";

  for (const file of files) {
    const isImage = allowedImageTypes.has(file.type);
    const isVideo = allowedVideoTypes.has(file.type);
    if (!isImage && !isVideo) return `O arquivo “${file.name}” não possui um formato permitido.`;
    if (isImage && file.size > 15 * 1024 * 1024) return `A foto “${file.name}” ultrapassa 15 MB.`;
    if (isVideo && file.size > 50 * 1024 * 1024) return `O vídeo “${file.name}” ultrapassa 50 MB.`;
  }

  return "";
}

function renderSelectedFiles() {
  const files = Array.from(fileInput.files || []);
  selectedFiles.replaceChildren();
  const error = validateFiles(files);
  showUploadError(error);

  files.slice(0, 10).forEach((file) => {
    const chip = document.createElement("span");
    chip.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    chip.title = file.name;
    selectedFiles.append(chip);
  });
}

function updateGalleryVisibility() {
  const cards = Array.from(memoryGrid.querySelectorAll("[data-memory-category]"));
  let visibleCount = 0;

  cards.forEach((card) => {
    const visible = activeFilter === "Todos" || card.dataset.memoryCategory === activeFilter;
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  galleryEmpty.hidden = visibleCount !== 0;
  memoryCount.textContent = visibleCount === 1 ? "1 memória visível" : `${visibleCount} memórias visíveis`;
}

function setActiveFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  });
  updateGalleryVisibility();
}

function closeUploadDialog() {
  if (!uploadDialog.open) return;
  uploadDialog.close();
  uploadForm.reset();
  selectedFiles.replaceChildren();
  showUploadError();
}

function openUploadDialog() {
  if (!uploadDialog.open) uploadDialog.showModal();
  window.setTimeout(() => uploadForm.elements.guestName.focus(), 0);
}

function closeLightbox() {
  if (!lightbox.open) return;
  lightbox.close();
  lightboxMedia.replaceChildren();
  lightboxCaption.replaceChildren();
}

function openLightbox({ url, type, guestName, category }) {
  lightboxMedia.replaceChildren();
  lightboxCaption.replaceChildren();

  const media = type.startsWith("video/")
    ? document.createElement("video")
    : document.createElement("img");

  media.src = url;
  if (media instanceof HTMLVideoElement) {
    media.controls = true;
    media.playsInline = true;
  } else {
    media.alt = `Memória compartilhada por ${guestName}`;
  }

  const caption = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = guestName;
  caption.append("Compartilhada por ", name, ` · ${category}`);

  lightboxMedia.append(media);
  lightboxCaption.append(caption);
  lightbox.showModal();
}

function createMemoryCard(file, guestName, category) {
  const objectUrl = URL.createObjectURL(file);
  activeObjectUrls.add(objectUrl);

  const card = document.createElement("article");
  card.className = "memory-card";
  card.dataset.memoryCategory = category;

  const mediaButton = document.createElement("button");
  mediaButton.className = "memory-media-button";
  mediaButton.type = "button";
  mediaButton.setAttribute("aria-label", `Abrir memória compartilhada por ${guestName}`);

  const isVideo = file.type.startsWith("video/");
  const media = isVideo ? document.createElement("video") : document.createElement("img");
  media.src = objectUrl;
  if (isVideo) {
    media.muted = true;
    media.playsInline = true;
    media.preload = "metadata";
    const badge = document.createElement("span");
    badge.className = "video-badge";
    badge.textContent = "▶ Vídeo";
    mediaButton.append(media, badge);
  } else {
    media.alt = `Memória compartilhada por ${guestName}`;
    mediaButton.append(media);
  }

  mediaButton.addEventListener("click", () => {
    openLightbox({ url: objectUrl, type: file.type, guestName, category });
  });

  const caption = document.createElement("div");
  caption.className = "memory-caption";
  const categoryLabel = document.createElement("span");
  categoryLabel.textContent = category;
  const title = document.createElement("strong");
  title.textContent = isVideo ? "Vídeo compartilhado" : "Foto compartilhada";
  const author = document.createElement("small");
  author.textContent = `Por ${guestName} · agora`;
  caption.append(categoryLabel, title, author);

  card.append(mediaButton, caption);
  return card;
}

document.querySelectorAll("[data-open-upload]").forEach((button) => {
  button.addEventListener("click", openUploadDialog);
});

document.querySelectorAll("[data-close-upload]").forEach((button) => {
  button.addEventListener("click", closeUploadDialog);
});

document.querySelectorAll("[data-close-lightbox]").forEach((button) => {
  button.addEventListener("click", closeLightbox);
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => setActiveFilter(button.dataset.filter));
});

fileInput.addEventListener("change", renderSelectedFiles);

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const files = Array.from(fileInput.files || []);
  const error = validateFiles(files);
  if (error) {
    showUploadError(error);
    return;
  }

  const formData = new FormData(uploadForm);
  const guestName = String(formData.get("guestName") || "").trim();
  const category = String(formData.get("category") || "");
  if (guestName.length < 2) {
    showUploadError("Informe seu nome para publicar as memórias.");
    return;
  }

  const fragment = document.createDocumentFragment();
  files.forEach((file) => fragment.append(createMemoryCard(file, guestName, category)));
  memoryGrid.prepend(fragment);
  setActiveFilter("Todos");
  closeUploadDialog();
  document.querySelector("#galeria").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(files.length === 1
    ? "Memória publicada! Ela já aparece na galeria coletiva."
    : `${files.length} memórias publicadas! Elas já aparecem para todos.`);
});

uploadDialog.addEventListener("click", (event) => {
  if (event.target === uploadDialog) closeUploadDialog();
});

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

uploadDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeUploadDialog();
});

lightbox.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeLightbox();
});

window.addEventListener("beforeunload", () => {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
});

updateGalleryVisibility();
