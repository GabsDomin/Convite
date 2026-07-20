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
const storiesRail = document.querySelector("[data-stories-rail]");
const storyDialog = document.querySelector("[data-story-dialog]");
const storyProgress = document.querySelector("[data-story-progress]");
const storyAvatar = document.querySelector("[data-story-avatar]");
const storyName = document.querySelector("[data-story-name]");
const storyStage = document.querySelector("[data-story-stage]");
const storyCaption = document.querySelector("[data-story-caption]");
const toast = document.querySelector("[data-toast]");
const cameraLaunchButton = document.querySelector("[data-open-camera]");
const cameraPanel = document.querySelector("[data-camera-panel]");
const cameraVideo = document.querySelector("[data-camera-video]");
const cameraStatus = document.querySelector("[data-camera-status]");
const cameraCanvas = document.querySelector("[data-camera-canvas]");
const cameraCaptureButton = document.querySelector("[data-capture-camera]");
const cameraSwitchButton = document.querySelector("[data-switch-camera]");
const cameraCloseButton = document.querySelector("[data-close-camera]");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const allowedVideoTypes = new Set(["video/mp4", "video/quicktime"]);
const activeObjectUrls = new Set();
const capturedFiles = [];
const storyGroups = new Map([
  ["Gabriel", {
    slides: [
      { kind: "placeholder", theme: "story-theme-blue", title: "Um novo capítulo", caption: "Preparativos para o nosso grande dia" },
      { kind: "placeholder", theme: "story-theme-light", title: "Cada detalhe", caption: "Tudo sendo preparado com carinho" },
    ],
  }],
  ["Halanaia", {
    slides: [
      { kind: "placeholder", theme: "story-theme-light", title: "Contando os dias", caption: "28 de novembro de 2026" },
      { kind: "placeholder", theme: "story-theme-blue", title: "Nosso sonho", caption: "Uma noite para guardar para sempre" },
    ],
  }],
  ["Convidada", {
    slides: [
      { kind: "placeholder", theme: "story-theme-night", title: "Outro olhar", caption: "Os convidados também contam essa história" },
    ],
  }],
  ["Convidado", {
    slides: [
      { kind: "placeholder", theme: "story-theme-blue", title: "Memórias juntos", caption: "Cada registro encontra seu lugar aqui" },
    ],
  }],
]);
let activeFilter = "Todos";
let activeStoryPerson = "";
let activeStoryIndex = 0;
let storyTimer;
let toastTimer;
let cameraStream;
let cameraFacingMode = "environment";

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "♡";
}

function getStoryPreview(group) {
  return group.slides.find((slide) => slide.kind === "media" && slide.type?.startsWith("image/"));
}

function renderAvatar(target, person, group) {
  target.replaceChildren();
  const preview = getStoryPreview(group);
  if (preview) {
    const image = document.createElement("img");
    image.src = preview.url;
    image.alt = "";
    target.append(image);
    return;
  }
  target.textContent = getInitials(person);
}

function renderStories() {
  storiesRail.replaceChildren();

  const addWrapper = document.createElement("div");
  addWrapper.setAttribute("role", "listitem");
  const addButton = document.createElement("button");
  addButton.className = "story-item story-add";
  addButton.type = "button";
  addButton.setAttribute("aria-label", "Adicionar seu story");
  const addRing = document.createElement("span");
  addRing.className = "story-ring";
  const addAvatar = document.createElement("span");
  addAvatar.className = "story-avatar";
  addAvatar.textContent = "+";
  const addLabel = document.createElement("span");
  addLabel.textContent = "Seu story";
  addRing.append(addAvatar);
  addButton.append(addRing, addLabel);
  addButton.addEventListener("click", openUploadDialog);
  addWrapper.append(addButton);
  storiesRail.append(addWrapper);

  storyGroups.forEach((group, person) => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.className = "story-item";
    button.type = "button";
    button.setAttribute("aria-label", `Ver stories de ${person}`);
    const ring = document.createElement("span");
    ring.className = "story-ring";
    const avatar = document.createElement("span");
    avatar.className = "story-avatar";
    renderAvatar(avatar, person, group);
    const label = document.createElement("span");
    label.textContent = person;
    ring.append(avatar);
    button.append(ring, label);
    button.addEventListener("click", () => openStory(person));
    wrapper.append(button);
    storiesRail.append(wrapper);
  });
}

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

function getPendingFiles() {
  return [...Array.from(fileInput.files || []), ...capturedFiles];
}

function renderSelectedFiles() {
  const files = getPendingFiles();
  selectedFiles.replaceChildren();
  const error = validateFiles(files);
  showUploadError(error);

  files.slice(0, 10).forEach((file) => {
    const chip = document.createElement("span");
    const source = capturedFiles.includes(file) ? "Foto da câmera · " : "";
    chip.textContent = `${source}${file.name} · ${formatFileSize(file.size)}`;
    chip.title = file.name;
    selectedFiles.append(chip);
  });
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
  }
  cameraVideo.srcObject = null;
  cameraVideo.classList.remove("is-mirrored");
  cameraPanel.hidden = true;
  cameraLaunchButton.hidden = false;
  cameraStatus.hidden = false;
  cameraStatus.textContent = "Preparando a câmera...";
}

function getCameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Permita o acesso à câmera no navegador para tirar a foto.";
  }
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return "Nenhuma câmera compatível foi encontrada neste aparelho.";
  }
  if (error?.name === "NotReadableError") {
    return "A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.";
  }
  return "Não foi possível abrir a câmera. Você ainda pode escolher uma foto da galeria.";
}

async function startCamera() {
  showUploadError();
  if (!navigator.mediaDevices?.getUserMedia) {
    showUploadError("A câmera não está disponível neste navegador. Escolha uma foto da galeria.");
    return;
  }

  stopCamera();
  cameraPanel.hidden = false;
  cameraLaunchButton.hidden = true;
  cameraStatus.hidden = false;
  cameraStatus.textContent = "Preparando a câmera...";
  cameraVideo.classList.toggle("is-mirrored", cameraFacingMode === "user");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraStatus.hidden = true;
  } catch (error) {
    const message = getCameraErrorMessage(error);
    stopCamera();
    showUploadError(message);
  }
}

async function captureCameraPhoto() {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    showUploadError("Aguarde a imagem da câmera aparecer antes de tirar a foto.");
    return;
  }

  cameraCaptureButton.disabled = true;
  showUploadError();
  try {
    cameraCanvas.width = cameraVideo.videoWidth;
    cameraCanvas.height = cameraVideo.videoHeight;
    const context = cameraCanvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível");
    context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
    const blob = await new Promise((resolve) => cameraCanvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Falha ao gerar a foto");

    const capturedAt = Date.now();
    capturedFiles.push(new File([blob], `foto-${capturedAt}.jpg`, {
      type: "image/jpeg",
      lastModified: capturedAt,
    }));
    renderSelectedFiles();
    stopCamera();
    showToast("Foto pronta! Preencha seu nome e toque em Publicar agora.");
  } catch {
    showUploadError("Não foi possível salvar a foto. Tente novamente ou escolha uma imagem da galeria.");
  } finally {
    cameraCaptureButton.disabled = false;
  }
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
  stopCamera();
  if (!uploadDialog.open) return;
  uploadDialog.close();
  uploadForm.reset();
  capturedFiles.length = 0;
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

function clearStoryTimer() {
  window.clearTimeout(storyTimer);
  storyTimer = undefined;
}

function closeStory() {
  clearStoryTimer();
  const video = storyStage.querySelector("video");
  video?.pause();
  storyStage.replaceChildren();
  if (storyDialog.open) storyDialog.close();
}

function showNextStory() {
  const group = storyGroups.get(activeStoryPerson);
  if (!group) return closeStory();
  if (activeStoryIndex >= group.slides.length - 1) return closeStory();
  activeStoryIndex += 1;
  renderActiveStory();
}

function showPreviousStory() {
  if (activeStoryIndex === 0) return;
  activeStoryIndex -= 1;
  renderActiveStory();
}

function renderActiveStory() {
  clearStoryTimer();
  const group = storyGroups.get(activeStoryPerson);
  const slide = group?.slides[activeStoryIndex];
  if (!group || !slide) return closeStory();

  storyName.textContent = activeStoryPerson;
  renderAvatar(storyAvatar, activeStoryPerson, group);
  storyStage.replaceChildren();
  storyProgress.replaceChildren();

  group.slides.forEach((_, index) => {
    const progressItem = document.createElement("span");
    if (index < activeStoryIndex) progressItem.className = "complete";
    if (index === activeStoryIndex) progressItem.className = "active";
    storyProgress.append(progressItem);
  });

  if (slide.kind === "media") {
    const media = slide.type.startsWith("video/")
      ? document.createElement("video")
      : document.createElement("img");
    media.src = slide.url;
    if (media instanceof HTMLVideoElement) {
      media.controls = true;
      media.playsInline = true;
      media.addEventListener("ended", showNextStory, { once: true });
    } else {
      media.alt = `Story compartilhado por ${activeStoryPerson}`;
      storyTimer = window.setTimeout(showNextStory, 6000);
    }
    storyStage.append(media);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = `story-placeholder ${slide.theme}`;
    const title = document.createElement("span");
    title.textContent = slide.title;
    const detail = document.createElement("small");
    detail.textContent = slide.caption;
    placeholder.append(title, detail);
    storyStage.append(placeholder);
    storyTimer = window.setTimeout(showNextStory, 6000);
  }

  storyCaption.textContent = slide.caption || "Memória compartilhada no álbum";
}

function openStory(person) {
  if (!storyGroups.has(person)) return;
  activeStoryPerson = person;
  activeStoryIndex = 0;
  if (!storyDialog.open) storyDialog.showModal();
  renderActiveStory();
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
  return {
    card,
    slide: {
      kind: "media",
      url: objectUrl,
      type: file.type,
      caption: `${category} · compartilhado por ${guestName}`,
    },
  };
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

document.querySelector("[data-close-story]").addEventListener("click", closeStory);
document.querySelector("[data-story-previous]").addEventListener("click", showPreviousStory);
document.querySelector("[data-story-next]").addEventListener("click", showNextStory);

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => setActiveFilter(button.dataset.filter));
});

fileInput.addEventListener("change", renderSelectedFiles);
cameraLaunchButton.addEventListener("click", startCamera);
cameraCaptureButton.addEventListener("click", captureCameraPhoto);
cameraSwitchButton.addEventListener("click", async () => {
  cameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
  await startCamera();
});
cameraCloseButton.addEventListener("click", stopCamera);

uploadForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const files = getPendingFiles();
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
  const newStorySlides = [];
  files.forEach((file) => {
    const memory = createMemoryCard(file, guestName, category);
    fragment.append(memory.card);
    newStorySlides.push(memory.slide);
  });
  memoryGrid.prepend(fragment);
  const existingStoryGroup = storyGroups.get(guestName);
  if (existingStoryGroup) {
    existingStoryGroup.slides.push(...newStorySlides);
  } else {
    storyGroups.set(guestName, { slides: newStorySlides });
  }
  renderStories();
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

storyDialog.addEventListener("click", (event) => {
  if (event.target === storyDialog) closeStory();
});

uploadDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeUploadDialog();
});

lightbox.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeLightbox();
});

storyDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeStory();
});

window.addEventListener("beforeunload", () => {
  stopCamera();
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
});

renderStories();
updateGalleryVisibility();
