const uploadDialog = document.querySelector("[data-upload-dialog]");
const uploadForm = document.querySelector("[data-upload-form]");
const fileInput = document.querySelector("[data-memory-files]");
const selectedFiles = document.querySelector("[data-selected-files]");
const uploadError = document.querySelector("[data-upload-error]");
const memoryGrid = document.querySelector("[data-memory-grid]");
const galleryEmpty = document.querySelector("[data-gallery-empty]");
const lightbox = document.querySelector("[data-lightbox]");
const lightboxMedia = document.querySelector("[data-lightbox-media]");
const lightboxCaption = document.querySelector("[data-lightbox-caption]");
const lightboxDownloadButton = document.querySelector("[data-download-media]");
const lightboxDeleteButton = document.querySelector("[data-delete-media]");
const storiesRail = document.querySelector("[data-stories-rail]");
const storyDialog = document.querySelector("[data-story-dialog]");
const storyProgress = document.querySelector("[data-story-progress]");
const storyAvatar = document.querySelector("[data-story-avatar]");
const storyName = document.querySelector("[data-story-name]");
const storyStage = document.querySelector("[data-story-stage]");
const storyCaption = document.querySelector("[data-story-caption]");
const storyShareButton = document.querySelector("[data-share-story]");
const storyShareLabel = document.querySelector("[data-story-share-label]");
const storyShareHint = document.querySelector("[data-story-share-hint]");
const toast = document.querySelector("[data-toast]");
const heroCarousel = document.querySelector("[data-hero-carousel]");
const heroSlides = document.querySelectorAll("[data-hero-slide]");
const heroDots = document.querySelectorAll("[data-hero-dot]");
const heroPreviousButton = document.querySelector("[data-hero-previous]");
const heroNextButton = document.querySelector("[data-hero-next]");
const cameraLaunchButton = document.querySelector("[data-open-camera]");
const cameraPanel = document.querySelector("[data-camera-panel]");
const cameraPreview = document.querySelector("[data-camera-preview]");
const cameraVideo = document.querySelector("[data-camera-video]");
const cameraStatus = document.querySelector("[data-camera-status]");
const cameraCanvas = document.querySelector("[data-camera-canvas]");
const cameraCaptureButton = document.querySelector("[data-capture-camera]");
const cameraSwitchButton = document.querySelector("[data-switch-camera]");
const cameraGalleryButton = document.querySelector("[data-camera-gallery]");
const cameraCloseButton = document.querySelector("[data-close-camera]");
const cameraRecording = document.querySelector("[data-camera-recording]");
const recordingTime = document.querySelector("[data-recording-time]");
const cameraTools = document.querySelector("[data-camera-tools]");
const cameraZoom = document.querySelector("[data-camera-zoom]");
const cameraZoomInput = document.querySelector("[data-camera-zoom-input]");
const cameraZoomValue = document.querySelector("[data-camera-zoom-value]");
const cameraTorchButton = document.querySelector("[data-camera-torch]");
const cameraModeButtons = document.querySelectorAll("[data-camera-mode]");
const uploadProgress = document.querySelector("[data-upload-progress]");
const uploadProgressLabel = document.querySelector("[data-upload-progress-label]");
const uploadProgressValue = document.querySelector("[data-upload-progress-value]");
const uploadProgressBar = document.querySelector("[data-upload-progress-bar]");
const uploadSubmitButton = document.querySelector("[data-upload-submit]");

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const allowedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const activeObjectUrls = new Set();
const capturedFiles = [];
const maximumAlbumFileSize = 500 * 1024 * 1024;
const storyGroups = new Map();
let activeFilter = "Todos";
let albumIsAdmin = false;
let activeLightboxMediaId = null;
let activeStoryPerson = "";
let activeStoryIndex = 0;
let storyTimer;
let toastTimer;
let activeHeroSlide = 0;
let heroTimer;
let heroTouchStartX;
let cameraStream;
let cameraFacingMode = "environment";
let cameraMode = "photo";
let cameraVideoTrack;
let cameraImageCapture;
let cameraPhotoSettings;
let activeRecording;
let torchEnabled = false;
let albumStorageConfigured = false;
let uploadInProgress = false;
const maximumRecordingDuration = 30_000;
const localCameraPreview = ["127.0.0.1", "localhost"].includes(location.hostname)
  && new URLSearchParams(location.search).has("camera-preview");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function stopHeroRotation() {
  window.clearTimeout(heroTimer);
  heroTimer = undefined;
}

function scheduleHeroRotation() {
  stopHeroRotation();
  if (reducedMotion.matches || document.hidden) return;
  heroTimer = window.setTimeout(() => {
    showHeroSlide(activeHeroSlide + 1);
  }, 5500);
}

function showHeroSlide(index, shouldSchedule = true) {
  activeHeroSlide = (index + heroSlides.length) % heroSlides.length;
  heroSlides.forEach((slide, slideIndex) => {
    const isActive = slideIndex === activeHeroSlide;
    slide.classList.toggle("is-active", isActive);
    slide.setAttribute("aria-hidden", String(!isActive));
  });
  heroDots.forEach((dot, dotIndex) => {
    dot.setAttribute("aria-pressed", String(dotIndex === activeHeroSlide));
  });
  if (shouldSchedule) scheduleHeroRotation();
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "♡";
}

function capitalizeNamePart(part) {
  if (!part) return "";
  return part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1).toLocaleLowerCase("pt-BR");
}

function parsePersonName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  return {
    person: fullName,
    firstName,
    lastName,
    firstKey: firstName.toLocaleLowerCase("pt-BR"),
    lastInitial: lastName.charAt(0).toLocaleUpperCase("pt-BR") || "",
  };
}

function buildStoryDisplayNameMap(people) {
  const parsed = people.map(parsePersonName);
  const byFirstName = new Map();

  parsed.forEach((entry) => {
    const group = byFirstName.get(entry.firstKey) || [];
    group.push(entry);
    byFirstName.set(entry.firstKey, group);
  });

  const displayNames = new Map();
  parsed.forEach((entry) => {
    const shortName = capitalizeNamePart(entry.firstName);
    const group = byFirstName.get(entry.firstKey) || [entry];

    if (group.length === 1) {
      displayNames.set(entry.person, shortName);
      return;
    }

    const sorted = [...group].sort((left, right) => (
      left.person.localeCompare(right.person, "pt-BR", { sensitivity: "base" })
    ));
    const keepShortName = sorted[0].person === entry.person;

    if (keepShortName || !entry.lastInitial) {
      displayNames.set(entry.person, shortName);
      return;
    }

    displayNames.set(entry.person, `${shortName} ${entry.lastInitial}.`);
  });

  return displayNames;
}

let storyDisplayNames = new Map();

function refreshStoryDisplayNames() {
  storyDisplayNames = buildStoryDisplayNameMap(Array.from(storyGroups.keys()));
}

function getStoryDisplayName(person) {
  return storyDisplayNames.get(person) || person;
}

function getStoryPreview(group) {
  return group.slides.find((slide) => slide.kind === "media" && slide.type?.startsWith("image/"));
}

function storyGroupHasMedia(group) {
  return group.slides.some((slide) => slide.kind === "media");
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
  refreshStoryDisplayNames();

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
    if (!storyGroupHasMedia(group)) return;

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
    label.textContent = getStoryDisplayName(person);
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

function setUploadProgress(percent = 0, label = "Enviando memórias...") {
  const normalized = Math.max(0, Math.min(100, Math.round(percent)));
  uploadProgress.hidden = false;
  uploadProgressLabel.textContent = label;
  uploadProgressValue.textContent = `${normalized}%`;
  uploadProgressBar.style.width = `${normalized}%`;
}

function resetUploadProgress() {
  uploadProgress.hidden = true;
  uploadProgressLabel.textContent = "Enviando memórias...";
  uploadProgressValue.textContent = "0%";
  uploadProgressBar.style.width = "0%";
}

function setUploadBusy(isBusy) {
  uploadInProgress = isBusy;
  uploadSubmitButton.disabled = isBusy;
  uploadSubmitButton.textContent = isBusy ? "Enviando..." : "Publicar agora";
  uploadForm.querySelectorAll("input, select, button").forEach((control) => {
    if (control !== uploadSubmitButton) control.disabled = isBusy;
  });
  if (!isBusy && !window.MediaRecorder) {
    document.querySelector('[data-camera-mode="video"]').disabled = true;
  }
}

function validateFiles(files) {
  if (files.length === 0) return "Escolha pelo menos uma foto ou vídeo.";
  if (files.length > 10) return "Escolha no máximo 10 arquivos por envio.";

  for (const file of files) {
    const isImage = allowedImageTypes.has(file.type);
    const isVideo = allowedVideoTypes.has(file.type);
    if (!isImage && !isVideo) return `O arquivo “${file.name}” não possui um formato permitido.`;
    if (file.size > maximumAlbumFileSize) return `O arquivo “${file.name}” ultrapassa 500 MB.`;
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
    const source = capturedFiles.includes(file)
      ? `${file.type.startsWith("video/") ? "Vídeo" : "Foto"} da câmera · `
      : "";
    chip.textContent = `${source}${file.name} · ${formatFileSize(file.size)}`;
    chip.title = file.name;
    selectedFiles.append(chip);
  });
}

function clearRecordingTimers(session) {
  if (!session) return;
  window.clearInterval(session.timer);
  window.clearTimeout(session.stopTimer);
}

function resetRecordingInterface() {
  cameraRecording.hidden = true;
  recordingTime.textContent = "00:00";
  cameraCaptureButton.classList.remove("is-recording");
  cameraCaptureButton.setAttribute("aria-label", cameraMode === "video" ? "Iniciar gravação" : "Capturar foto");
  cameraModeButtons.forEach((button) => {
    button.disabled = button.dataset.cameraMode === "video" && !window.MediaRecorder;
  });
  cameraSwitchButton.disabled = false;
  cameraGalleryButton.disabled = false;
}

function stopActiveRecording(shouldSave = true) {
  if (!activeRecording || activeRecording.recorder.state === "inactive") return;
  const session = activeRecording;
  session.discard = !shouldSave;
  session.recorder.stop();
  if (!shouldSave) activeRecording = undefined;
}

function resetCameraCapabilities() {
  cameraVideoTrack = undefined;
  cameraImageCapture = undefined;
  cameraPhotoSettings = undefined;
  torchEnabled = false;
  cameraTools.hidden = true;
  cameraZoom.hidden = true;
  cameraTorchButton.hidden = true;
  cameraTorchButton.classList.remove("is-active");
  cameraTorchButton.setAttribute("aria-pressed", "false");
}

function stopCamera() {
  stopActiveRecording(false);
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
  }
  resetCameraCapabilities();
  resetRecordingInterface();
  cameraVideo.srcObject = null;
  cameraVideo.hidden = false;
  cameraVideo.classList.remove("is-mirrored");
  cameraPreview.classList.remove("is-demo");
  cameraPanel.hidden = true;
  uploadDialog.classList.remove("is-camera-open");
  document.body.classList.remove("camera-active");
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
  stopCamera();
  cameraPanel.hidden = false;
  uploadDialog.classList.add("is-camera-open");
  document.body.classList.add("camera-active");
  cameraLaunchButton.hidden = true;
  cameraStatus.hidden = false;
  cameraStatus.textContent = "Preparando a câmera...";
  cameraVideo.classList.toggle("is-mirrored", cameraFacingMode === "user");

  if (localCameraPreview) {
    cameraPreview.classList.add("is-demo");
    cameraVideo.hidden = true;
    cameraStatus.hidden = true;
    cameraTools.hidden = false;
    cameraZoom.hidden = false;
    cameraZoomInput.min = "1";
    cameraZoomInput.max = "3";
    cameraZoomInput.value = "1";
    cameraZoomValue.textContent = "1×";
    cameraTorchButton.hidden = false;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    stopCamera();
    showUploadError("A câmera não está disponível neste navegador. Escolha uma foto da galeria.");
    return;
  }

  try {
    const photoMode = cameraMode === "photo";
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: photoMode ? 4096 : 3840 },
        height: { ideal: photoMode ? 3072 : 2160 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });

    if (cameraMode === "video") {
      try {
        const microphoneStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        microphoneStream.getAudioTracks().forEach((track) => cameraStream.addTrack(track));
      } catch {
        showToast("Microfone não autorizado. O vídeo será gravado sem som.");
      }
    }

    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    await configureCameraCapabilities();
    cameraStatus.hidden = true;
  } catch (error) {
    const message = getCameraErrorMessage(error);
    stopCamera();
    showUploadError(message);
  }
}

function getPreferredCapabilityValue(capability, preferredValue) {
  if (!Array.isArray(capability)) return undefined;
  return capability.includes(preferredValue) ? preferredValue : undefined;
}

async function configureNativePhotoCapture() {
  if (cameraMode !== "photo" || typeof window.ImageCapture !== "function" || !cameraVideoTrack) return;

  try {
    cameraImageCapture = new ImageCapture(cameraVideoTrack);
  } catch {
    cameraImageCapture = undefined;
    return;
  }

  if (typeof cameraImageCapture.getPhotoCapabilities !== "function") return;
  try {
    const photoCapabilities = await cameraImageCapture.getPhotoCapabilities();
    const imageWidth = photoCapabilities.imageWidth;
    const imageHeight = photoCapabilities.imageHeight;
    cameraPhotoSettings = {};

    if (Number.isFinite(imageWidth?.max)) cameraPhotoSettings.imageWidth = Math.min(imageWidth.max, 4096);
    if (Number.isFinite(imageHeight?.max)) cameraPhotoSettings.imageHeight = Math.min(imageHeight.max, 4096);
    if (photoCapabilities.fillLightMode?.includes("auto")) cameraPhotoSettings.fillLightMode = "auto";
    if (Object.keys(cameraPhotoSettings).length === 0) cameraPhotoSettings = undefined;
  } catch {
    cameraPhotoSettings = undefined;
  }
}

async function configureCameraCapabilities() {
  cameraVideoTrack = cameraStream?.getVideoTracks()[0];
  if (!cameraVideoTrack) return;

  const capabilities = typeof cameraVideoTrack.getCapabilities === "function"
    ? cameraVideoTrack.getCapabilities()
    : {};
  const settings = typeof cameraVideoTrack.getSettings === "function"
    ? cameraVideoTrack.getSettings()
    : {};

  if ("contentHint" in cameraVideoTrack) {
    cameraVideoTrack.contentHint = cameraMode === "photo" ? "detail" : "motion";
  }

  const advancedQualityConstraints = {};
  const focusMode = getPreferredCapabilityValue(capabilities.focusMode, "continuous");
  const exposureMode = getPreferredCapabilityValue(capabilities.exposureMode, "continuous");
  const whiteBalanceMode = getPreferredCapabilityValue(capabilities.whiteBalanceMode, "continuous");
  if (focusMode) advancedQualityConstraints.focusMode = focusMode;
  if (exposureMode) advancedQualityConstraints.exposureMode = exposureMode;
  if (whiteBalanceMode) advancedQualityConstraints.whiteBalanceMode = whiteBalanceMode;
  if (Object.keys(advancedQualityConstraints).length > 0) {
    try {
      await cameraVideoTrack.applyConstraints({ advanced: [advancedQualityConstraints] });
    } catch {
      // The requested quality controls are optional and vary between devices.
    }
  }

  await configureNativePhotoCapture();

  const zoom = capabilities.zoom;
  const supportsZoom = zoom
    && Number.isFinite(zoom.min)
    && Number.isFinite(zoom.max)
    && zoom.max > zoom.min;

  if (supportsZoom) {
    const zoomStep = Number.isFinite(zoom.step) && zoom.step > 0 ? zoom.step : 0.1;
    const currentZoom = Number.isFinite(settings.zoom) ? settings.zoom : zoom.min;
    cameraZoomInput.min = String(zoom.min);
    cameraZoomInput.max = String(zoom.max);
    cameraZoomInput.step = String(zoomStep);
    cameraZoomInput.value = String(currentZoom);
    cameraZoomValue.textContent = `${Number(currentZoom.toFixed(1))}×`;
    cameraZoom.hidden = false;
  }

  const torch = capabilities.torch;
  const supportsTorch = torch === true || (Array.isArray(torch) && torch.includes(true));
  cameraTorchButton.hidden = !supportsTorch;
  cameraTools.hidden = !supportsZoom && !supportsTorch;
}

async function applyCameraZoom() {
  if (!cameraVideoTrack) return;
  const zoom = Number(cameraZoomInput.value);
  cameraZoomValue.textContent = `${Number(zoom.toFixed(1))}×`;
  try {
    await cameraVideoTrack.applyConstraints({ advanced: [{ zoom }] });
  } catch {
    showUploadError("O zoom não pôde ser aplicado nesta câmera.");
  }
}

async function toggleCameraTorch() {
  if (!cameraVideoTrack) return;
  const nextValue = !torchEnabled;
  try {
    await cameraVideoTrack.applyConstraints({ advanced: [{ torch: nextValue }] });
    torchEnabled = nextValue;
    cameraTorchButton.classList.toggle("is-active", torchEnabled);
    cameraTorchButton.setAttribute("aria-pressed", String(torchEnabled));
  } catch {
    showUploadError("A lanterna não está disponível neste modo de câmera.");
  }
}

async function setCameraMode(mode, restartCamera = true) {
  if (mode === "video" && !window.MediaRecorder) {
    showUploadError("A gravação de vídeo não está disponível neste navegador.");
    return;
  }
  if (activeRecording) return;

  cameraMode = mode;
  cameraModeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.cameraMode === cameraMode));
  });
  cameraCaptureButton.classList.toggle("is-video-mode", cameraMode === "video");
  cameraCaptureButton.setAttribute("aria-label", cameraMode === "video" ? "Iniciar gravação" : "Capturar foto");

  if (restartCamera && (cameraStream || localCameraPreview)) await startCamera();
}

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getRecordingVideoBitrate() {
  const settings = typeof cameraVideoTrack?.getSettings === "function"
    ? cameraVideoTrack.getSettings()
    : {};
  const pixels = Number(settings.width || cameraVideo.videoWidth) * Number(settings.height || cameraVideo.videoHeight);
  if (pixels >= 3840 * 2160) return 20_000_000;
  if (pixels >= 1920 * 1080) return 12_000_000;
  return 8_000_000;
}

function updateRecordingClock(session) {
  const elapsedSeconds = Math.min(
    Math.floor((Date.now() - session.startedAt) / 1000),
    maximumRecordingDuration / 1000,
  );
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  recordingTime.textContent = `${minutes}:${seconds}`;
}

function finishVideoRecording(session) {
  clearRecordingTimers(session);
  if (activeRecording === session) activeRecording = undefined;
  resetRecordingInterface();
  if (session.discard || session.chunks.length === 0) return;

  const recorderType = session.recorder.mimeType || session.chunks[0]?.type || "video/webm";
  const baseType = recorderType.split(";")[0] || "video/webm";
  const blob = new Blob(session.chunks, { type: baseType });
  if (blob.size === 0) {
    showUploadError("A gravação ficou vazia. Tente novamente.");
    return;
  }
  if (blob.size > maximumAlbumFileSize) {
    showUploadError("O vídeo ultrapassou 500 MB. Grave um trecho mais curto.");
    return;
  }

  const capturedAt = Date.now();
  const extension = baseType === "video/mp4" ? "mp4" : "webm";
  capturedFiles.push(new File([blob], `video-${capturedAt}.${extension}`, {
    type: baseType,
    lastModified: capturedAt,
  }));
  renderSelectedFiles();
  stopCamera();
  setCameraMode("photo", false);
  showToast("Vídeo pronto! Agora é só publicar na galeria.");
}

function startVideoRecording() {
  if (!cameraStream || activeRecording) return;
  try {
    const mimeType = getSupportedRecordingMimeType();
    const recorderOptions = {
      videoBitsPerSecond: getRecordingVideoBitrate(),
      audioBitsPerSecond: 192_000,
    };
    if (mimeType) recorderOptions.mimeType = mimeType;
    const recorder = new MediaRecorder(cameraStream, recorderOptions);
    const session = {
      recorder,
      chunks: [],
      discard: false,
      startedAt: Date.now(),
      timer: undefined,
      stopTimer: undefined,
    };
    activeRecording = session;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => finishVideoRecording(session), { once: true });
    recorder.addEventListener("error", () => {
      session.discard = true;
      showUploadError("A gravação foi interrompida pelo aparelho.");
    }, { once: true });
    recorder.start(1000);
    cameraRecording.hidden = false;
    cameraCaptureButton.classList.add("is-recording");
    cameraCaptureButton.setAttribute("aria-label", "Parar gravação");
    cameraModeButtons.forEach((button) => {
      button.disabled = true;
    });
    cameraSwitchButton.disabled = true;
    cameraGalleryButton.disabled = true;
    updateRecordingClock(session);
    session.timer = window.setInterval(() => updateRecordingClock(session), 250);
    session.stopTimer = window.setTimeout(() => stopActiveRecording(true), maximumRecordingDuration);
  } catch {
    activeRecording = undefined;
    resetRecordingInterface();
    showUploadError("Não foi possível iniciar a gravação neste aparelho.");
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
    let blob;
    if (cameraImageCapture) {
      try {
        blob = cameraPhotoSettings
          ? await cameraImageCapture.takePhoto(cameraPhotoSettings)
          : await cameraImageCapture.takePhoto();
      } catch {
        try {
          blob = await cameraImageCapture.takePhoto();
        } catch {
          blob = undefined;
        }
      }
    }

    if (blob && !allowedImageTypes.has(blob.type)) blob = undefined;

    if (!blob) {
      cameraCanvas.width = cameraVideo.videoWidth;
      cameraCanvas.height = cameraVideo.videoHeight;
      const context = cameraCanvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível");
      context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
      blob = await new Promise((resolve) => cameraCanvas.toBlob(resolve, "image/jpeg", 0.96));
    }
    if (!blob) throw new Error("Falha ao gerar a foto");

    const capturedAt = Date.now();
    const photoType = allowedImageTypes.has(blob.type) ? blob.type : "image/jpeg";
    const extensionByType = {
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    const extension = extensionByType[photoType] || "jpg";
    capturedFiles.push(new File([blob], `foto-${capturedAt}.${extension}`, {
      type: photoType,
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

function handleCameraCapture() {
  if (cameraMode === "video") {
    if (activeRecording) stopActiveRecording(true);
    else startVideoRecording();
    return;
  }
  captureCameraPhoto();
}

function updateGalleryVisibility() {
  const cards = Array.from(memoryGrid.querySelectorAll("[data-memory-category], [data-memory-categories]"));
  let visibleCount = 0;

  cards.forEach((card) => {
    const categories = String(card.dataset.memoryCategories || card.dataset.memoryCategory || "")
      .split("|")
      .filter(Boolean);
    const visible = activeFilter === "Todos" || categories.includes(activeFilter);
    card.hidden = !visible;
    if (visible) visibleCount += Number(card.dataset.memoryCount || 1);
  });

  galleryEmpty.hidden = visibleCount !== 0;
}

function setActiveFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
  });
  updateGalleryVisibility();
}

function closeUploadDialog() {
  if (uploadInProgress) return;
  stopCamera();
  setCameraMode("photo", false);
  if (!uploadDialog.open) return;
  uploadDialog.close();
  uploadForm.reset();
  capturedFiles.length = 0;
  selectedFiles.replaceChildren();
  showUploadError();
  resetUploadProgress();
}

function openUploadDialog() {
  if (!uploadDialog.open) uploadDialog.showModal();
  window.setTimeout(() => uploadForm.elements.guestName.focus(), 0);
}

let activeLightboxDownload = null;

function closeLightbox() {
  if (!lightbox.open) return;
  lightbox.close();
  lightboxMedia.replaceChildren();
  lightboxCaption.replaceChildren();
  activeLightboxDownload = null;
  activeLightboxMediaId = null;
  if (lightboxDownloadButton) {
    lightboxDownloadButton.hidden = true;
    lightboxDownloadButton.disabled = false;
    lightboxDownloadButton.textContent = "Baixar original";
  }
  if (lightboxDeleteButton) {
    lightboxDeleteButton.hidden = true;
    lightboxDeleteButton.disabled = false;
    lightboxDeleteButton.textContent = "Excluir memória";
  }
}

function extensionForMimeType(type) {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("avif")) return "avif";
  if (type.includes("heic") || type.includes("heif")) return "heic";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4") || type.startsWith("video/")) return "mp4";
  return "jpg";
}

function buildDownloadFileName({ guestName, category, type }) {
  const safeGuest = String(guestName || "memoria")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "memoria";
  const safeCategory = String(category || "album")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "album";
  return `${safeGuest}-${safeCategory}.${extensionForMimeType(type || "")}`;
}

async function downloadMediaFile({ url, type, guestName, category, fileName }) {
  if (!url) throw new Error("Arquivo indisponível para download.");
  const resolvedName = fileName || buildDownloadFileName({ guestName, category, type });

  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error("Não foi possível baixar o arquivo.");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = resolvedName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    return;
  } catch {
    const link = document.createElement("a");
    link.href = url;
    link.download = resolvedName;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
  }
}

function openLightbox({ url, type, guestName, category, originalUrl, mediaId }) {
  lightboxMedia.replaceChildren();
  lightboxCaption.replaceChildren();

  const downloadUrl = originalUrl || url;
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
  activeLightboxMediaId = mediaId || null;
  activeLightboxDownload = {
    url: downloadUrl,
    type,
    guestName,
    category,
    fileName: buildDownloadFileName({ guestName, category, type }),
  };
  if (lightboxDownloadButton) {
    lightboxDownloadButton.hidden = !downloadUrl;
    lightboxDownloadButton.disabled = false;
    lightboxDownloadButton.textContent = "Baixar original";
  }
  if (lightboxDeleteButton) {
    lightboxDeleteButton.hidden = !albumIsAdmin || !mediaId;
    lightboxDeleteButton.disabled = false;
    lightboxDeleteButton.textContent = "Excluir memória";
  }
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

const storyExportWidth = 1080;
const storyExportHeight = 1920;

function getWrappedCanvasLines(context, text, maxWidth, maxLines = 4) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !currentLine) {
      currentLine = candidate;
      return;
    }
    lines.push(currentLine);
    currentLine = word;
  });
  if (currentLine) lines.push(currentLine);

  if (lines.length > maxLines) {
    const visibleLines = lines.slice(0, maxLines);
    visibleLines[maxLines - 1] = `${visibleLines[maxLines - 1].replace(/[.…]+$/, "")}…`;
    return visibleLines;
  }
  return lines;
}

function drawCenteredCanvasText(context, text, centerY, maxWidth, lineHeight, maxLines = 4) {
  const lines = getWrappedCanvasLines(context, text, maxWidth, maxLines);
  const firstLineY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, storyExportWidth / 2, firstLineY + index * lineHeight));
}

function paintStoryTheme(context, theme) {
  const lightTheme = theme === "story-theme-light";
  const gradient = context.createLinearGradient(0, 0, storyExportWidth, storyExportHeight);
  if (lightTheme) {
    gradient.addColorStop(0, "#fffdfb");
    gradient.addColorStop(1, "#dfe7f5");
  } else if (theme === "story-theme-night") {
    gradient.addColorStop(0, "#102954");
    gradient.addColorStop(0.68, "#00152f");
    gradient.addColorStop(1, "#000b1d");
  } else {
    gradient.addColorStop(0, "#7090c8");
    gradient.addColorStop(0.62, "#003f98");
    gradient.addColorStop(1, "#001f4d");
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, storyExportWidth, storyExportHeight);

  const highlight = context.createRadialGradient(260, 330, 0, 260, 330, 460);
  highlight.addColorStop(0, lightTheme ? "rgba(143,161,205,0.34)" : "rgba(255,255,255,0.25)");
  highlight.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = highlight;
  context.fillRect(0, 0, storyExportWidth, storyExportHeight);
}

function drawCoverImage(context, image) {
  const imageWidth = image.width || image.naturalWidth;
  const imageHeight = image.height || image.naturalHeight;
  const scale = Math.max(storyExportWidth / imageWidth, storyExportHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  context.drawImage(image, (storyExportWidth - width) / 2, (storyExportHeight - height) / 2, width, height);
}

function drawStoryExportChrome(context, person, caption, lightTheme = false) {
  const topGradient = context.createLinearGradient(0, 0, 0, 360);
  topGradient.addColorStop(0, lightTheme ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.52)");
  topGradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = topGradient;
  context.fillRect(0, 0, storyExportWidth, 360);

  const bottomGradient = context.createLinearGradient(0, 1450, 0, storyExportHeight);
  bottomGradient.addColorStop(0, "rgba(0,0,0,0)");
  bottomGradient.addColorStop(1, lightTheme ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.72)");
  context.fillStyle = bottomGradient;
  context.fillRect(0, 1450, storyExportWidth, 470);

  const foreground = lightTheme ? "#002f73" : "#ffffff";
  context.fillStyle = lightTheme ? "#003f98" : "rgba(255,255,255,0.96)";
  context.beginPath();
  context.arc(100, 115, 48, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = '700 32px "Cormorant Garamond", Georgia, serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(getInitials(person), 100, 118);

  context.fillStyle = foreground;
  context.textAlign = "left";
  context.font = '800 34px Inter, Arial, sans-serif';
  context.fillText(person, 170, 104);
  context.globalAlpha = 0.72;
  context.font = '600 22px Inter, Arial, sans-serif';
  context.fillText("Compartilhado no álbum", 170, 142);
  context.globalAlpha = 1;

  context.fillStyle = foreground;
  context.textAlign = "center";
  context.font = '700 30px Inter, Arial, sans-serif';
  drawCenteredCanvasText(context, caption || "Memória compartilhada no álbum", 1720, 850, 40, 3);
  context.globalAlpha = 0.78;
  context.font = '700 22px Inter, Arial, sans-serif';
  context.fillText("GABRIEL & HALANAIA  ·  28.11.2026", storyExportWidth / 2, 1840);
  context.globalAlpha = 1;
}

async function loadStoryImage(source) {
  const file = source instanceof Blob
    ? source
    : await fetch(source, { mode: "cors" }).then((response) => {
      if (!response.ok) throw new Error("Não foi possível carregar a foto.");
      return response.blob();
    });
  if (typeof window.createImageBitmap === "function") {
    const bitmap = await window.createImageBitmap(file);
    return { image: bitmap, release: () => bitmap.close() };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;
  try {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return { image, release: () => URL.revokeObjectURL(objectUrl) };
}

function canvasToStoryFile(canvas, person) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Não foi possível criar a imagem do story."));
        return;
      }
      const safeName = person.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-");
      resolve(new File([blob], `story-${safeName || "convidado"}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }));
    }, "image/jpeg", 0.92);
  });
}

async function createStoryShareFile(slide, person) {
  if (slide.kind === "media" && slide.type.startsWith("video/")) {
    if (slide.file) return slide.file;
    const response = await fetch(slide.originalUrl || slide.url, { mode: "cors" });
    if (!response.ok) throw new Error("Não foi possível preparar o vídeo.");
    const blob = await response.blob();
    const extension = slide.type.includes("mp4") ? "mp4" : "webm";
    return new File([blob], `story-${Date.now()}.${extension}`, { type: slide.type });
  }
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = storyExportWidth;
  canvas.height = storyExportHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível.");

  if (slide.kind === "media" && (slide.file || slide.url)) {
    let resource;
    try {
      resource = await loadStoryImage(slide.file || slide.url);
      drawCoverImage(context, resource.image);
      drawStoryExportChrome(context, person, slide.caption, false);
    } catch {
      return slide.file;
    } finally {
      resource?.release();
    }
  } else {
    const lightTheme = slide.theme === "story-theme-light";
    paintStoryTheme(context, slide.theme);
    context.fillStyle = lightTheme ? "#002f73" : "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 118px "Cormorant Garamond", Georgia, serif';
    drawCenteredCanvasText(context, slide.title, 920, 850, 112, 4);
    context.globalAlpha = 0.82;
    context.font = '800 28px Inter, Arial, sans-serif';
    drawCenteredCanvasText(context, String(slide.caption || "").toUpperCase(), 1120, 820, 42, 3);
    context.globalAlpha = 1;
    drawStoryExportChrome(context, person, slide.caption, lightTheme);
  }

  return canvasToStoryFile(canvas, person);
}

function prepareStoryShareFile(slide, person) {
  if (slide.shareFile) return Promise.resolve(slide.shareFile);
  if (slide.shareFilePromise) return slide.shareFilePromise;
  slide.shareFilePromise = createStoryShareFile(slide, person)
    .then((file) => {
      slide.shareFile = file;
      return file;
    })
    .catch((error) => {
      slide.shareFilePromise = undefined;
      throw error;
    });
  return slide.shareFilePromise;
}

function renderActiveStory() {
  clearStoryTimer();
  const group = storyGroups.get(activeStoryPerson);
  const slide = group?.slides[activeStoryIndex];
  if (!group || !slide) return closeStory();

  storyName.textContent = getStoryDisplayName(activeStoryPerson);
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
  storyShareButton.disabled = true;
  storyShareLabel.textContent = "Preparando story...";
  storyShareHint.textContent = "o mesmo conteúdo será enviado como foto ou vídeo";
  if (slide.kind === "media" && slide.type.startsWith("video/") && !slide.file) {
    storyShareButton.disabled = false;
    storyShareLabel.textContent = "Compartilhar no Instagram";
    storyShareHint.textContent = "o vídeo será preparado quando você tocar";
    return;
  }
  prepareStoryShareFile(slide, activeStoryPerson)
    .then(() => {
      const currentSlide = storyGroups.get(activeStoryPerson)?.slides[activeStoryIndex];
      if (currentSlide !== slide) return;
      storyShareButton.disabled = false;
      storyShareLabel.textContent = "Compartilhar no Instagram";
      storyShareHint.textContent = "no celular, escolha Instagram → Stories";
    })
    .catch(() => {
      const currentSlide = storyGroups.get(activeStoryPerson)?.slides[activeStoryIndex];
      if (currentSlide !== slide) return;
      storyShareLabel.textContent = "Story indisponível para compartilhar";
      storyShareHint.textContent = "tente novamente em outro navegador";
    });
}

async function shareActiveStory() {
  clearStoryTimer();
  const group = storyGroups.get(activeStoryPerson);
  const slide = group?.slides[activeStoryIndex];
  if (!slide) return;

  try {
    const shareFile = slide.shareFile || await prepareStoryShareFile(slide, activeStoryPerson);
    if (!navigator.canShare?.({ files: [shareFile] })) {
      showToast("Este navegador não permite compartilhar o story como arquivo.");
      return;
    }
    await navigator.share({ files: [shareFile] });
    showToast("Story enviado ao compartilhamento. Agora escolha Instagram → Stories.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    showToast("Não foi possível abrir o compartilhamento neste navegador.");
  }
}

function openStory(person) {
  const group = storyGroups.get(person);
  if (!group || !storyGroupHasMedia(group)) return;
  activeStoryPerson = person;
  activeStoryIndex = 0;
  if (!storyDialog.open) storyDialog.showModal();
  renderActiveStory();
}

function resolveMemoryEntry(entry) {
  let localUrl = "";
  if (entry.file) {
    localUrl = URL.createObjectURL(entry.file);
    activeObjectUrls.add(localUrl);
  }
  const resolvedType = entry.type || entry.file?.type || "image/jpeg";
  const resolvedDisplayUrl = entry.displayUrl || localUrl;
  const resolvedPreviewUrl = entry.previewUrl || resolvedDisplayUrl;
  const resolvedOriginalUrl = entry.originalUrl || resolvedDisplayUrl;
  return {
    ...entry,
    resolvedType,
    resolvedDisplayUrl,
    resolvedPreviewUrl,
    resolvedOriginalUrl,
    isVideo: resolvedType.startsWith("video/"),
  };
}

function openMemoryLightbox(entry) {
  openLightbox({
    url: entry.resolvedDisplayUrl,
    originalUrl: entry.resolvedOriginalUrl,
    type: entry.resolvedType,
    guestName: entry.guestName,
    category: entry.category,
    mediaId: entry.id,
  });
}

function createMediaElement(entry) {
  const media = entry.isVideo && !entry.previewUrl
    ? document.createElement("video")
    : document.createElement("img");
  media.src = entry.resolvedPreviewUrl;
  if (media instanceof HTMLVideoElement) {
    media.muted = true;
    media.playsInline = true;
    media.preload = "metadata";
  } else {
    media.alt = `Memória compartilhada por ${entry.guestName}`;
    media.loading = "lazy";
  }
  return media;
}

function createMemoryCard(rawEntry, variant = "default") {
  const entry = resolveMemoryEntry(rawEntry);
  const card = document.createElement("article");
  card.className = "memory-card";
  if (variant === "tall") card.classList.add("memory-card-tall");
  if (variant === "wide" || entry.isVideo) card.classList.add("memory-card-wide");
  if (entry.isVideo) card.classList.add("memory-card-video");
  card.dataset.memoryCategory = entry.category;
  card.dataset.memoryCount = "1";
  if (entry.id) card.dataset.memoryId = entry.id;

  const mediaButton = document.createElement("button");
  mediaButton.className = "memory-media-button";
  mediaButton.type = "button";
  mediaButton.setAttribute("aria-label", `Abrir memória de ${entry.guestName}`);
  mediaButton.append(createMediaElement(entry));
  if (entry.isVideo) {
    const badge = document.createElement("span");
    badge.className = "video-badge";
    badge.textContent = "▶";
    mediaButton.append(badge);
  }
  mediaButton.addEventListener("click", () => openMemoryLightbox(entry));
  card.append(mediaButton);

  return {
    card,
    slide: {
      kind: "media",
      url: entry.resolvedDisplayUrl,
      originalUrl: entry.resolvedOriginalUrl,
      type: entry.resolvedType,
      file: entry.file,
      caption: `${entry.category} · compartilhado por ${entry.guestName}`,
    },
    entry,
  };
}

function createCarouselCard(rawEntries) {
  const entries = rawEntries.map(resolveMemoryEntry);
  const card = document.createElement("article");
  card.className = "memory-card memory-card-carousel memory-card-wide";
  card.dataset.memoryCategories = entries.map((entry) => entry.category).join("|");
  card.dataset.memoryCategory = entries[0]?.category || "";
  card.dataset.memoryCount = String(entries.length);

  const viewport = document.createElement("div");
  viewport.className = "memory-carousel";
  viewport.setAttribute("role", "group");
  viewport.setAttribute("aria-label", "Carrossel de memórias");

  const track = document.createElement("div");
  track.className = "memory-carousel-track";

  entries.forEach((entry, index) => {
    const slide = document.createElement("button");
    slide.className = "memory-carousel-slide";
    slide.type = "button";
    slide.hidden = index !== 0;
    slide.setAttribute("aria-label", `Abrir memória ${index + 1} de ${entries.length}`);
    slide.append(createMediaElement(entry));
    slide.addEventListener("click", () => openMemoryLightbox(entry));
    track.append(slide);
  });

  const dots = document.createElement("div");
  dots.className = "memory-carousel-dots";
  dots.setAttribute("role", "tablist");
  dots.setAttribute("aria-label", "Slides do carrossel");

  let activeIndex = 0;
  const slides = Array.from(track.children);
  let autoplayTimer;
  let carouselVisible = true;

  function clearAutoplay() {
    window.clearInterval(autoplayTimer);
    autoplayTimer = undefined;
  }

  function startAutoplay() {
    clearAutoplay();
    if (reducedMotion.matches || slides.length < 2 || !carouselVisible) return;
    autoplayTimer = window.setInterval(() => {
      showSlide(activeIndex + 1);
    }, 4500);
  }

  function showSlide(nextIndex) {
    activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      slide.hidden = index !== activeIndex;
    });
    Array.from(dots.children).forEach((dot, index) => {
      dot.setAttribute("aria-selected", String(index === activeIndex));
    });
  }

  entries.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "memory-carousel-dot";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Ir para memória ${index + 1}`);
    dot.setAttribute("aria-selected", String(index === 0));
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      showSlide(index);
      startAutoplay();
    });
    dots.append(dot);
  });

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "memory-carousel-nav memory-carousel-prev";
  previous.setAttribute("aria-label", "Memória anterior");
  previous.textContent = "‹";
  previous.addEventListener("click", (event) => {
    event.stopPropagation();
    showSlide(activeIndex - 1);
    startAutoplay();
  });

  const next = document.createElement("button");
  next.type = "button";
  next.className = "memory-carousel-nav memory-carousel-next";
  next.setAttribute("aria-label", "Próxima memória");
  next.textContent = "›";
  next.addEventListener("click", (event) => {
    event.stopPropagation();
    showSlide(activeIndex + 1);
    startAutoplay();
  });

  let touchStartX = 0;
  viewport.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0]?.clientX || 0;
    clearAutoplay();
  }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    const delta = (event.changedTouches[0]?.clientX || 0) - touchStartX;
    if (Math.abs(delta) >= 40) showSlide(activeIndex + (delta < 0 ? 1 : -1));
    startAutoplay();
  }, { passive: true });

  viewport.addEventListener("mouseenter", clearAutoplay);
  viewport.addEventListener("mouseleave", startAutoplay);
  viewport.addEventListener("focusin", clearAutoplay);
  viewport.addEventListener("focusout", startAutoplay);

  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver((entries) => {
      carouselVisible = entries.some((entry) => entry.isIntersecting);
      if (carouselVisible) startAutoplay();
      else clearAutoplay();
    }, { threshold: 0.35 });
    observer.observe(card);
  }

  startAutoplay();

  viewport.append(track, previous, next, dots);
  card.append(viewport);

  return {
    card,
    slides: entries.map((entry) => ({
      kind: "media",
      url: entry.resolvedDisplayUrl,
      originalUrl: entry.resolvedOriginalUrl,
      type: entry.resolvedType,
      file: entry.file,
      caption: `${entry.category} · compartilhado por ${entry.guestName}`,
      guestName: entry.guestName,
    })),
    entries,
  };
}

const MAX_CAROUSEL_PHOTOS = 4;

function buildGalleryTiles(entries) {
  const tiles = [];
  let index = 0;
  let step = 0;
  const pattern = ["carousel4", "single", "tall", "carousel2", "wide", "single", "tall", "single"];

  while (index < entries.length) {
    const kind = pattern[step % pattern.length];
    step += 1;
    const current = entries[index];
    const currentIsVideo = String(current.type || current.file?.type || "").startsWith("video/");

    if (kind.startsWith("carousel") && !currentIsVideo) {
      const requestedSize = kind === "carousel4" ? 4 : 2;
      const size = Math.min(requestedSize, MAX_CAROUSEL_PHOTOS);
      const bundle = [];
      while (bundle.length < size && index < entries.length) {
        const candidate = entries[index];
        if (String(candidate.type || candidate.file?.type || "").startsWith("video/")) break;
        bundle.push(candidate);
        index += 1;
      }
      if (bundle.length >= 2) {
        tiles.push({ kind: "carousel", entries: bundle });
        continue;
      }
      if (bundle.length === 1) {
        tiles.push({ kind: "single", entry: bundle[0], variant: "default" });
        continue;
      }
    }

    tiles.push({
      kind: "single",
      entry: current,
      variant: currentIsVideo || kind === "wide" ? "wide" : kind === "tall" ? "tall" : "default",
    });
    index += 1;
  }

  return tiles;
}

function addMemoriesToGallery(entries, { prepend = true } = {}) {
  if (!entries.length) return;
  memoryGrid.querySelectorAll("[data-demo-memory]").forEach((card) => card.remove());
  const fragment = document.createDocumentFragment();
  const groupedSlides = new Map();
  const tiles = buildGalleryTiles(entries);

  tiles.forEach((tile) => {
    if (tile.kind === "carousel") {
      const carousel = createCarouselCard(tile.entries);
      fragment.append(carousel.card);
      carousel.entries.forEach((entry, index) => {
        const slides = groupedSlides.get(entry.guestName) || [];
        slides.push(carousel.slides[index]);
        groupedSlides.set(entry.guestName, slides);
      });
      return;
    }

    const memory = createMemoryCard(tile.entry, tile.variant);
    fragment.append(memory.card);
    const slides = groupedSlides.get(tile.entry.guestName) || [];
    slides.push(memory.slide);
    groupedSlides.set(tile.entry.guestName, slides);
  });

  if (prepend) memoryGrid.prepend(fragment);
  else memoryGrid.append(fragment);

  groupedSlides.forEach((slides, guestName) => {
    const existingStoryGroup = storyGroups.get(guestName);
    if (existingStoryGroup) existingStoryGroup.slides.push(...slides);
    else storyGroups.set(guestName, { slides });
  });
  renderStories();
  setActiveFilter("Todos");
}

async function requestAlbumJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível acessar o álbum.");
  return payload;
}

async function reloadAlbumGallery() {
  const payload = await requestAlbumJson("/api/album/media");
  memoryGrid.replaceChildren();
  storyGroups.clear();
  if (payload.configured && payload.media?.length) {
    const entries = payload.media.map((media) => ({
      id: media.id,
      guestName: media.guestName,
      category: media.category,
      previewUrl: media.thumbnailUrl,
      displayUrl: media.displayUrl,
      originalUrl: media.originalUrl,
      type: media.mimeType,
      createdAt: media.createdAt,
    }));
    addMemoriesToGallery(entries, { prepend: false });
  }
  updateGalleryVisibility();
  renderStories();
}

async function deleteActiveMedia() {
  if (!albumIsAdmin || !activeLightboxMediaId) return;
  if (!window.confirm("Excluir esta memória do álbum? Essa ação não pode ser desfeita.")) return;

  lightboxDeleteButton.disabled = true;
  lightboxDeleteButton.textContent = "Excluindo...";

  try {
    await requestAlbumJson(`/api/album/media/${activeLightboxMediaId}`, { method: "DELETE" });
    closeLightbox();
    await reloadAlbumGallery();
    showToast("Memória excluída do álbum.");
  } catch (error) {
    showToast(error.message || "Não foi possível excluir esta memória.");
    lightboxDeleteButton.disabled = false;
    lightboxDeleteButton.textContent = "Excluir memória";
  }
}

function showLocalAlbumStatus() {
  albumStorageConfigured = false;
}

async function initializeAlbumStorage() {
  try {
    const payload = await requestAlbumJson("/api/album/media");
    if (!payload.configured) {
      showLocalAlbumStatus();
      return;
    }

    albumStorageConfigured = true;
    memoryGrid.querySelectorAll("[data-demo-memory]").forEach((card) => card.remove());
    const entries = payload.media.map((media) => ({
      id: media.id,
      guestName: media.guestName,
      category: media.category,
      previewUrl: media.thumbnailUrl,
      displayUrl: media.displayUrl,
      originalUrl: media.originalUrl,
      type: media.mimeType,
      createdAt: media.createdAt,
    }));
    storyGroups.clear();
    addMemoriesToGallery(entries, { prepend: false });
    updateGalleryVisibility();
  } catch {
    showLocalAlbumStatus();
  }
}

function uploadFileToR2(file, upload, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.uploadUrl);
    Object.entries(upload.headers || {}).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value);
    });
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new Error("O armazenamento recusou o arquivo."));
    });
    xhr.addEventListener("error", () => reject(new Error("A conexão caiu durante o envio.")));
    xhr.addEventListener("abort", () => reject(new Error("O envio foi cancelado.")));
    xhr.send(file);
  });
}

async function persistAlbumFile(file, guestName, category, onProgress) {
  const upload = await requestAlbumJson("/api/album/upload-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guestName,
      category,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    }),
  });
  await uploadFileToR2(file, upload, onProgress);
  const registered = await requestAlbumJson("/api/album/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadToken: upload.uploadToken,
    }),
  });
  return {
    id: registered.media.id,
    guestName: registered.media.guestName,
    category: registered.media.category,
    previewUrl: registered.media.thumbnailUrl,
    displayUrl: registered.media.displayUrl,
    originalUrl: registered.media.originalUrl,
    type: registered.media.mimeType,
    createdAt: registered.media.createdAt,
    file,
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

lightboxDeleteButton?.addEventListener("click", deleteActiveMedia);

lightboxDownloadButton?.addEventListener("click", async () => {
  if (!activeLightboxDownload || !lightboxDownloadButton) return;
  lightboxDownloadButton.disabled = true;
  lightboxDownloadButton.textContent = "Baixando...";
  try {
    await downloadMediaFile(activeLightboxDownload);
    lightboxDownloadButton.textContent = "Baixar original";
  } catch (error) {
    lightboxDownloadButton.textContent = "Tentar de novo";
    showToast(error.message || "Não foi possível baixar a mídia.");
  } finally {
    lightboxDownloadButton.disabled = false;
  }
});

document.querySelector("[data-close-story]").addEventListener("click", closeStory);
document.querySelector("[data-story-previous]").addEventListener("click", showPreviousStory);
document.querySelector("[data-story-next]").addEventListener("click", showNextStory);
storyShareButton.addEventListener("click", shareActiveStory);

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => setActiveFilter(button.dataset.filter));
});

heroPreviousButton.addEventListener("click", () => showHeroSlide(activeHeroSlide - 1));
heroNextButton.addEventListener("click", () => showHeroSlide(activeHeroSlide + 1));
heroDots.forEach((dot) => {
  dot.addEventListener("click", () => showHeroSlide(Number(dot.dataset.heroDot)));
});
heroCarousel.addEventListener("mouseenter", stopHeroRotation);
heroCarousel.addEventListener("mouseleave", scheduleHeroRotation);
heroCarousel.addEventListener("focusin", stopHeroRotation);
heroCarousel.addEventListener("focusout", scheduleHeroRotation);
heroCarousel.addEventListener("touchstart", (event) => {
  heroTouchStartX = event.changedTouches[0]?.clientX;
  stopHeroRotation();
}, { passive: true });
heroCarousel.addEventListener("touchend", (event) => {
  const endX = event.changedTouches[0]?.clientX;
  if (Number.isFinite(heroTouchStartX) && Number.isFinite(endX)) {
    const distance = endX - heroTouchStartX;
    if (Math.abs(distance) > 45) showHeroSlide(activeHeroSlide + (distance < 0 ? 1 : -1), false);
  }
  heroTouchStartX = undefined;
  scheduleHeroRotation();
}, { passive: true });
document.addEventListener("visibilitychange", scheduleHeroRotation);
reducedMotion.addEventListener?.("change", scheduleHeroRotation);

fileInput.addEventListener("change", renderSelectedFiles);
cameraLaunchButton.addEventListener("click", startCamera);
cameraCaptureButton.addEventListener("click", handleCameraCapture);
cameraSwitchButton.addEventListener("click", async () => {
  cameraFacingMode = cameraFacingMode === "environment" ? "user" : "environment";
  await startCamera();
});
cameraGalleryButton.addEventListener("click", () => {
  stopCamera();
  fileInput.click();
});
cameraCloseButton.addEventListener("click", stopCamera);
cameraZoomInput.addEventListener("input", applyCameraZoom);
cameraTorchButton.addEventListener("click", toggleCameraTorch);
cameraModeButtons.forEach((button) => {
  if (button.dataset.cameraMode === "video" && !window.MediaRecorder) {
    button.disabled = true;
    button.title = "Gravação indisponível neste navegador";
  }
  button.addEventListener("click", async () => {
    await setCameraMode(button.dataset.cameraMode);
  });
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (uploadInProgress) return;
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
  const nameParts = guestName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || nameParts.some((part) => part.length < 2)) {
    showUploadError("Informe nome e sobrenome para publicar as memórias.");
    return;
  }

  let entries;
  if (albumStorageConfigured) {
    entries = [];
    setUploadBusy(true);
    setUploadProgress(0, `Enviando 1 de ${files.length}...`);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const entry = await persistAlbumFile(file, guestName, category, (fileProgress) => {
          const overallProgress = ((index + fileProgress) / files.length) * 100;
          setUploadProgress(overallProgress, `Enviando ${index + 1} de ${files.length}...`);
        });
        entries.push(entry);
      }
      setUploadProgress(100, "Memórias salvas com qualidade original");
    } catch (uploadFailure) {
      if (entries.length) addMemoriesToGallery(entries);
      showUploadError(uploadFailure.message || "Não foi possível concluir o envio.");
      setUploadBusy(false);
      return;
    }
    setUploadBusy(false);
  } else {
    entries = files.map((file) => ({ file, guestName, category, type: file.type }));
  }

  addMemoriesToGallery(entries);
  closeUploadDialog();
  document.querySelector("#galeria").scrollIntoView({ behavior: "smooth", block: "start" });
  const persistentMessage = albumStorageConfigured ? " e foi salva com o original preservado" : " neste navegador";
  showToast(files.length === 1
    ? `Memória publicada${persistentMessage}!`
    : `${files.length} memórias publicadas${persistentMessage}!`);
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
scheduleHeroRotation();

async function ensureAlbumSession() {
  const logoutButton = document.querySelector("[data-album-logout]");
  try {
    const response = await fetch("/api/album/session", { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.authenticated) {
      window.location.replace("/album/login");
      return false;
    }
    albumIsAdmin = Boolean(payload.isAlbumAdmin);
    if (logoutButton) {
      logoutButton.hidden = false;
      logoutButton.addEventListener("click", async () => {
        await fetch("/api/album/logout", { method: "POST", credentials: "same-origin" });
        window.location.replace("/album/login");
      });
    }
    return true;
  } catch {
    window.location.replace("/album/login");
    return false;
  }
}

ensureAlbumSession().then((ok) => {
  if (ok) initializeAlbumStorage();
});
