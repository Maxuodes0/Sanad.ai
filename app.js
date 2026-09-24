const API_BASE = "https://production-back.sanad.ai";
const MAX_FILE_SIZE = 30 * 1024 * 1024;

const $ = (selector) => document.querySelector(selector);
const fileInput = $("#fileInput");
const dropzone = $("#dropzone");
const fileCard = $("#fileCard");
const filePreview = $("#filePreview");
const runButton = $("#runButton");
const emptyState = $("#emptyState");
const errorState = $("#errorState");
const resultContent = $("#resultContent");
const resultStatus = $("#resultStatus");

let selectedFile = null;
let objectUrl = null;
let requestCount = 0;
let extractedValue = "";

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

function setStatus(text, state) {
  resultStatus.textContent = text;
  resultStatus.className = `result-status ${state}`;
}

function resetResult() {
  emptyState.classList.remove("hidden");
  errorState.classList.add("hidden");
  resultContent.classList.add("hidden");
  setStatus("بانتظار ملف", "idle");
}

function showError(title, message) {
  emptyState.classList.add("hidden");
  resultContent.classList.add("hidden");
  errorState.classList.remove("hidden");
  $("#errorTitle").textContent = title;
  $("#errorMessage").textContent = message;
  setStatus("فشل الطلب", "error");
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  runButton.disabled = true;
  fileCard.classList.add("hidden");
  dropzone.classList.remove("hidden");
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  filePreview.innerHTML = "<span>PDF</span>";
  resetResult();
}

function selectFile(file) {
  const accepted = ["image/jpeg", "image/png", "application/pdf"];
  if (!accepted.includes(file.type)) {
    showError("صيغة غير مدعومة", "اختر ملف JPG أو PNG أو PDF.");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError("الملف أكبر من الحد", "الحد المعلن في خدمة سند هو 30MB.");
    return;
  }

  selectedFile = file;
  $("#fileName").textContent = file.name;
  $("#fileDetails").textContent = `${file.type || "unknown"} · ${formatBytes(file.size)}`;
  $("#fileType").textContent = file.type === "application/pdf" ? "pdf" : "image";
  dropzone.classList.add("hidden");
  fileCard.classList.remove("hidden");
  runButton.disabled = false;
  errorState.classList.add("hidden");

  if (file.type.startsWith("image/")) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    filePreview.innerHTML = `<img src="${objectUrl}" alt="معاينة الملف المحدد" />`;
  } else {
    filePreview.innerHTML = "<span>PDF</span>";
  }
}

async function runExtraction() {
  if (!selectedFile) return;

  runButton.disabled = true;
  runButton.classList.add("loading");
  $(".button-label").textContent = "جاري الاتصال بخادم سند…";
  emptyState.classList.remove("hidden");
  errorState.classList.add("hidden");
  resultContent.classList.add("hidden");
  setStatus("يعالج الآن", "loading");

  const body = new FormData();
  body.append("imageFile", selectedFile);
  const fileType = selectedFile.type === "application/pdf" ? "pdf" : "image";
  const endpoint = `${API_BASE}/extract?modelId=generic&fileType=${fileType}&mode=annotation`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const started = performance.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const elapsed = performance.now() - started;
    const rawText = await response.text();
    let payload;
    try { payload = JSON.parse(rawText); } catch { payload = { raw: rawText }; }

    if (!response.ok) {
      const serverMessage = payload?.message || payload?.error || rawText || "الخادم لم يرسل سبب الخطأ.";
      throw new Error(`HTTP ${response.status} — ${serverMessage}`);
    }

    requestCount += 1;
    const pages = Array.isArray(payload.extractionResult) ? payload.extractionResult : [];
    extractedValue = pages.map((page) => page.linear_text || page.aligned_text || "").filter(Boolean).join("\n\n--- صفحة جديدة ---\n\n");

    $("#httpCode").textContent = response.status;
    $("#requestTime").textContent = `${(elapsed / 1000).toFixed(2)}s`;
    $("#pageCount").textContent = pages.length || 1;
    $("#sessionCount").textContent = requestCount;
    $("#extractedText").textContent = extractedValue || "تم الطلب بنجاح لكن لم يرجع نص خطي.";

    const safePayload = JSON.parse(JSON.stringify(payload));
    if (Array.isArray(safePayload.extractionResult)) {
      safePayload.extractionResult.forEach((page) => {
        if (page.b64_corr_img) page.b64_corr_img = `[base64 image omitted — ${page.b64_corr_img.length} chars]`;
      });
    }
    $("#rawJson").textContent = JSON.stringify(safePayload, null, 2);

    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    resultContent.classList.remove("hidden");
    setStatus("نجح دون مصادقة", "success");
  } catch (error) {
    const message = error.name === "AbortError"
      ? "انتهت مهلة الطلب بعد 90 ثانية."
      : error.message;
    showError("خادم سند رفض الطلب أو تعذّر الوصول إليه", message);
  } finally {
    clearTimeout(timer);
    runButton.disabled = false;
    runButton.classList.remove("loading");
    $(".button-label").textContent = "تشغيل الاستخراج المباشر";
  }
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => fileInput.files[0] && selectFile(fileInput.files[0]));
$("#removeFile").addEventListener("click", clearFile);
$("#resetButton").addEventListener("click", clearFile);
runButton.addEventListener("click", runExtraction);

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
});
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) selectFile(file);
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    $("#textPane").classList.toggle("hidden", button.dataset.tab !== "text");
    $("#jsonPane").classList.toggle("hidden", button.dataset.tab !== "json");
  });
});

$("#copyButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(extractedValue);
  $("#copyButton").textContent = "تم النسخ ✓";
  setTimeout(() => { $("#copyButton").textContent = "نسخ النص"; }, 1400);
});

$("#downloadButton").addEventListener("click", () => {
  const blob = new Blob([extractedValue], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(selectedFile?.name || "ocr-result").replace(/\.[^/.]+$/, "")}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
});
