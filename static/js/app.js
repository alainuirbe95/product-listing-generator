const state = {
  categories: [],
  selectedFiles: [],
  currentItem: null,
  libraryItems: [],
  selectedIds: new Set(),
  previewItemId: null,
  productionSettings: null,
  productionItemId: null,
  productionVariations: [],
  productionListPrice: null,
  analyzerRows: [],
  filamentSpools: [],
  filamentSort: { column: "quantity", direction: "asc" },
  filamentOrderCopy: "",
  openaiEnvConfigured: false,
};

const API_KEY_STORAGE = "retro_minds_openai_api_key";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function isMobileView() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function initMobileApiKeySection() {
  const section = $("#api-key-section");
  if (!section) return;
  if (isMobileView()) section.removeAttribute("open");
  else section.setAttribute("open", "");
}

function syncSelectAllCheckboxes(checked) {
  const desktop = $("#select-all");
  const mobile = $("#select-all-mobile");
  if (desktop) desktop.checked = checked;
  if (mobile) mobile.checked = checked;
}

function bindRowSelectHandlers(container) {
  if (!container) return;
  container.querySelectorAll(".row-select").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedIds.add(cb.dataset.id);
      else state.selectedIds.delete(cb.dataset.id);
      syncRowSelectCheckboxes(cb.dataset.id, cb.checked);
      updateSelectionButtons();
    });
  });
}

function syncRowSelectCheckboxes(id, checked) {
  $$(`.row-select[data-id="${id}"]`).forEach((cb) => {
    cb.checked = checked;
  });
  const allBoxes = [...$$(".row-select")];
  const allChecked = allBoxes.length > 0 && allBoxes.every((cb) => cb.checked);
  syncSelectAllCheckboxes(allChecked);
}

function showAlert(message, type = "error") {
  const el = $("#global-alert");
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.classList.remove("hidden");
  if (type !== "error") {
    setTimeout(() => el.classList.add("hidden"), 4000);
  }
}

function readApiKeyInput() {
  const el = document.getElementById("openai-api-key");
  return el && typeof el.value === "string" ? el.value.trim() : "";
}

function getStoredApiKey() {
  const fromInput = readApiKeyInput();
  if (fromInput) return fromInput;
  return sessionStorage.getItem(API_KEY_STORAGE) || "";
}

function saveStoredApiKey(key) {
  const trimmed = (key || "").trim();
  if (trimmed) sessionStorage.setItem(API_KEY_STORAGE, trimmed);
  else sessionStorage.removeItem(API_KEY_STORAGE);
  updateOpenAiKeyHint(state.openaiEnvConfigured);
}

function bindApiKeyInput() {
  const el = document.getElementById("openai-api-key");
  if (!el) return;
  const sync = () => saveStoredApiKey(el.value);
  el.addEventListener("input", sync);
  el.addEventListener("change", sync);
  el.addEventListener("paste", () => setTimeout(sync, 0));
  el.addEventListener("blur", sync);
}

function openaiKeyHeaders(extra = {}) {
  const key = getStoredApiKey();
  const headers = { ...extra };
  if (key) headers["X-OpenAI-API-Key"] = key;
  return headers;
}

function loadStoredApiKeyIntoForm() {
  const saved = sessionStorage.getItem(API_KEY_STORAGE);
  if (saved && $("#openai-api-key")) $("#openai-api-key").value = saved;
}

function updateOpenAiKeyHint(envConfigured) {
  const hint = $("#openai-key-hint");
  if (!hint) return;
  if (envConfigured) {
    hint.textContent =
      "Optional — a key is set in .env on this Mac. Paste a different key here to override for this browser session.";
  } else if (getStoredApiKey().startsWith("sk-")) {
    hint.textContent = "API key detected — you're ready to generate.";
  } else if (getStoredApiKey()) {
    hint.textContent = "Key entered. It should start with sk- — double-check if generation fails.";
  } else {
    hint.textContent =
      "Required — paste your OpenAI API key here. Saved in this browser only, not written to disk.";
  }
}

function apiKeyReady() {
  if (state.openaiEnvConfigured) return true;
  const key = getStoredApiKey();
  return key.length > 0 && key.startsWith("sk-");
}

function hideAlert() {
  $("#global-alert").classList.add("hidden");
}

function switchView(view) {
  $$(".panel").forEach((p) => p.classList.remove("active"));
  $$("button[data-view]").forEach((b) => b.classList.remove("active"));

  if (view === "new") {
    $("#view-new").classList.add("active");
    $$(`button[data-view="new"]`).forEach((b) => b.classList.add("active"));
  } else if (view === "library") {
    $("#view-library").classList.add("active");
    $$(`button[data-view="library"]`).forEach((b) => b.classList.add("active"));
    loadLibrary();
  } else if (view === "production") {
    $("#view-production").classList.add("active");
    $$(`button[data-view="production"]`).forEach((b) => b.classList.add("active"));
    loadProductionView();
  } else if (view === "inventory") {
    $("#view-inventory").classList.add("active");
    $$(`button[data-view="inventory"]`).forEach((b) => b.classList.add("active"));
    loadFilamentInventory();
  } else if (view === "settings") {
    $("#view-settings").classList.add("active");
    $$(`button[data-view="settings"]`).forEach((b) => b.classList.add("active"));
    loadSquareExamples();
  } else if (view === "review") {
    $("#view-review").classList.add("active");
  }
}

function mediaUrl(filePath) {
  return `/media/${filePath}`;
}

const STYLED_IMAGE_CATEGORIES = new Set(["pot", "vase"]);

function categorySupportsStyledImage(categoryId) {
  return STYLED_IMAGE_CATEGORIES.has(categoryId);
}

function getStudioImages(item) {
  return (item.images || []).filter((i) => i.type === "generated");
}

function getStyledImages(item) {
  return (item.images || []).filter((i) => i.type === "generated_styled");
}

function getListingImages(item) {
  return [...getStudioImages(item), ...getStyledImages(item)];
}

function getGeneratedImages(item) {
  return getListingImages(item);
}

function getPreviewImage(item) {
  const images = item.images || [];
  if (item.primary_image_id) {
    const primary = images.find((i) => i.id === item.primary_image_id);
    if (primary) return primary;
  }
  return getStudioImages(item)[0] || getStyledImages(item)[0] || null;
}

function imageLabel(image) {
  if (image.type === "generated_styled") {
    return image.styled_subject ? `With plant · ${image.styled_subject}` : "With plant";
  }
  return "Studio";
}

function renderPreviewImageCard(item, img, index, total) {
  const filename = imageDownloadName(item, img, index, total);
  return `
    <div class="preview-image-wrap">
      <p class="preview-image-label">${escapeAttr(imageLabel(img))}</p>
      <img src="${mediaUrl(img.file_path)}" alt="${escapeAttr(imageLabel(img))}" />
      <button type="button" class="link-btn preview-download-inline" data-file-path="${escapeAttr(img.file_path)}" data-filename="${escapeAttr(filename)}">
        Download
      </button>
    </div>
  `;
}

function renderPreviewStyledPlaceholder(sortOrder) {
  return `
    <div class="preview-image-wrap preview-image-missing">
      <p class="preview-image-label">With plant</p>
      <div class="preview-image-placeholder" aria-hidden="true"></div>
      <p class="field-hint preview-missing-copy">Lifestyle shot not generated yet.</p>
      <button type="button" class="btn btn-secondary btn-sm preview-generate-styled-btn" data-sort-order="${sortOrder}">
        Generate with plant
      </button>
    </div>
  `;
}

function renderPreviewImagesGallery(item) {
  const studio = getStudioImages(item);
  const styled = getStyledImages(item);

  if (!studio.length && !styled.length) {
    return '<div class="preview-meta"><em>No generated image</em></div>';
  }

  const cards = [];
  for (const gen of studio) {
    cards.push({ kind: "image", image: gen });
    const style = styled.find((s) => s.sort_order === gen.sort_order);
    if (style) {
      cards.push({ kind: "image", image: style });
    } else if (categorySupportsStyledImage(item.category)) {
      cards.push({ kind: "placeholder", sortOrder: gen.sort_order });
    }
  }

  for (const style of styled) {
    if (!studio.some((gen) => gen.sort_order === style.sort_order)) {
      cards.push({ kind: "image", image: style });
    }
  }

  const imageCards = cards.filter((card) => card.kind === "image");
  const totalImages = imageCards.length;

  return `<div class="preview-images">${cards
    .map((card) => {
      if (card.kind === "placeholder") {
        return renderPreviewStyledPlaceholder(card.sortOrder);
      }
      const index = imageCards.findIndex((entry) => entry.image.id === card.image.id);
      return renderPreviewImageCard(item, card.image, index, totalImages);
    })
    .join("")}</div>`;
}

function imageDownloadName(item, image, index, total) {
  const slug =
    (item.shop_title || item.sku || item.etsy_title || item.item_name || "listing")
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "listing";
  const ext = image.file_path.includes(".") ? image.file_path.split(".").pop() : "png";
  return total > 1 ? `${slug}-image-${index + 1}.${ext}` : `${slug}.${ext}`;
}

async function downloadMediaFile(filePath, filename) {
  const res = await fetch(mediaUrl(filePath));
  if (!res.ok) throw new Error("Could not download image");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function categoryLabel(id) {
  const cat = state.categories.find((c) => c.id === id);
  return cat ? cat.name : id;
}

async function loadCategories() {
  const res = await fetch("/api/categories");
  state.categories = await res.json();

  const categorySelect = $("#category");
  const reviewCategory = $("#review-category");
  const filterCategory = $("#filter-category");

  categorySelect.innerHTML = state.categories
    .map((c) => `<option value="${c.id}">${c.name}</option>`)
    .join("");

  reviewCategory.innerHTML = categorySelect.innerHTML;
  filterCategory.innerHTML =
    '<option value="">All categories</option>' +
    state.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");

  const productionFilter = $("#production-filter-category");
  if (productionFilter) {
    productionFilter.innerHTML = filterCategory.innerHTML;
  }

  if (state.categories.length) {
    await applyCategoryDefaults(state.categories[0].id);
  }
}

async function applyCategoryDefaults(categoryId) {
  renderModifiers(categoryId);
  const res = await fetch(`/api/categories/${categoryId}/defaults`);
  if (!res.ok) return;
  const defaults = await res.json();

  if (defaults.defaultPrice != null) {
    $("#price").value = defaults.defaultPrice;
  }
  if (defaults.itemNamePlaceholder) {
    $("#item-name").placeholder = defaults.itemNamePlaceholder;
  }

  const hints = {
    pot: 'Pots use quoted names like “Serik” Pot',
    vase: 'Vases use quoted names like “Lunor” Vase',
    trellis: 'Use a descriptive name, e.g. Natural Plant Trellis',
    wall_planter: 'Use a descriptive name, e.g. Wall Planter - Arches',
    table_lamp: 'Use a product name, e.g. Soru Table Lamp',
  };
  $("#item-name-hint").textContent =
    hints[categoryId] || "Enter the design or product name";

  if (defaults.studioImagePrompt) {
    $("#studio-prompt-hint").textContent =
      `Studio photo: ${defaults.studioImagePrompt.slice(0, 160)}…`;
  } else {
    $("#studio-prompt-hint").textContent = "";
  }
}

function renderModifiers(categoryId, existing = null) {
  const cat = state.categories.find((c) => c.id === categoryId);
  const container = $("#modifiers-container");
  if (!cat) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = cat.defaultModifiers
    .map((mod) => modifierBlockHtml(mod, existing?.find((m) => m.key === mod.key)))
    .join("");
  bindModifierContainer(container);
}

function selectedModifierValues(mod, existingMod) {
  if (existingMod?.value) {
    return parseModifierValues(existingMod.value);
  }
  const options = mod.options || [];
  if (options.length) {
    return [...options];
  }
  return parseModifierValues(mod.defaultValue || "");
}

function modifierBlockHtml(mod, existingMod) {
  const enabled = existingMod?.enabled ?? mod.enabled ?? false;
  const options = mod.options || [];
  const selectedValues = selectedModifierValues(mod, existingMod);
  const selected = new Set(selectedValues);

  if (options.length) {
    const chips = options
      .map(
        (opt) =>
          `<button type="button" class="mod-chip ${selected.has(opt) ? "selected" : ""}" data-value="${escapeAttr(opt)}">${escapeAttr(opt)}</button>`
      )
      .join("");
    return `
      <div class="modifier-block" data-key="${mod.key}">
        <div class="modifier-block-header">
          <input type="checkbox" class="mod-enabled" ${enabled ? "checked" : ""} />
          <span>${escapeAttr(mod.label)}</span>
        </div>
        <div class="mod-chips">${chips}</div>
        <input type="hidden" class="mod-value" value="${escapeAttr([...selected].join(", "))}" />
      </div>
    `;
  }

  return `
    <div class="modifier-row modifier-block" data-key="${mod.key}">
      <input type="checkbox" class="mod-enabled" ${enabled ? "checked" : ""} />
      <span>${escapeAttr(mod.label)}</span>
      <input type="text" class="mod-value mod-value-text" value="${escapeAttr(selectedValues.join(", "))}" placeholder="${escapeAttr(mod.label)}" />
    </div>
  `;
}

function bindModifierContainer(container) {
  container.querySelectorAll(".mod-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      const block = chip.closest(".modifier-block");
      const selected = [...block.querySelectorAll(".mod-chip.selected")].map((c) => c.dataset.value);
      block.querySelector(".mod-value").value = selected.join(", ");
    });
  });
}

function renderReviewModifiers(modifiers) {
  const cat = state.categories.find((c) => c.id === state.currentItem?.category);
  const container = $("#review-modifiers");
  if (!cat) return;

  container.innerHTML =
    '<h2 style="font-size: 1rem; margin: 1rem 0 0.75rem;">Modifiers</h2>' +
    cat.defaultModifiers
      .map((mod) => {
        const existing = modifiers.find((m) => m.key === mod.key) || { enabled: false, value: "" };
        return modifierBlockHtml(mod, existing);
      })
      .join("");
  bindModifierContainer(container);
}

function getModifiersFromContainer(containerSelector) {
  return [...$$(`${containerSelector} .modifier-block, ${containerSelector} .modifier-row`)].map((row) => ({
    key: row.dataset.key,
    label:
      row.querySelector(".modifier-block-header span")?.textContent ||
      row.querySelector(":scope > span")?.textContent ||
      "",
    enabled: row.querySelector(".mod-enabled").checked,
    value: row.querySelector(".mod-value").value.trim(),
  }));
}

function formatItemModifiersPreview(item) {
  const modifiers = enabledModifiers(item.modifiers || []);
  if (!modifiers.length) {
    return '<p class="field-hint">No variations selected for this listing.</p>';
  }

  const blocks = modifiers
    .map((mod) => {
      const values = parseModifierValues(mod.value);
      if (!values.length) return "";
      return `
        <div class="preview-modifier">
          <strong>${escapeAttr(mod.label)}</strong>
          <div class="tag-input">${values.map((v) => `<span class="tag">${escapeAttr(v)}</span>`).join("")}</div>
        </div>
      `;
    })
    .filter(Boolean);

  if (!blocks.length) {
    return '<p class="field-hint">No variations selected for this listing.</p>';
  }

  return blocks.join("");
}

function formatPreviewSizePrices(item) {
  const production = item.production || {};
  const groupLabel = defaultGroupLabel(item.category);
  const combos = productionCombos(item.modifiers || [], groupLabel);
  const priced = combos
    .map((combo) => {
      const key = variationKey(combo);
      const spec = production[key] || {};
      const price = resolveListPrice(spec, item.price);
      if (price == null) return null;
      return { name: variationName(combo), price };
    })
    .filter(Boolean);

  if (priced.length <= 1 && combos.length <= 1) return "";

  return `
    <div class="preview-modifier" style="margin-top: 0.75rem;">
      <strong>Prices by size</strong>
      <div class="tag-input">
        ${priced.map((row) => `<span class="tag">${escapeAttr(row.name)} · ${formatMoney(row.price)}</span>`).join("")}
      </div>
    </div>
  `;
}

function itemDisplayName(item) {
  return item.shop_title || item.item_name || item.etsy_title || "Untitled";
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderUploadPreviews() {
  const container = $("#upload-previews");
  container.innerHTML = "";
  state.selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = url;
    img.title = file.name;
    img.onclick = () => {
      state.selectedFiles.splice(i, 1);
      renderUploadPreviews();
    };
    container.appendChild(img);
  });
}

function setupDropzone() {
  const dropzone = $("#dropzone");
  const fileInput = $("#file-input");

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    addFiles([...e.dataTransfer.files]);
  });

  fileInput.addEventListener("change", (e) => {
    addFiles([...e.target.files]);
    fileInput.value = "";
  });
}

function addFiles(files) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  state.selectedFiles.push(...images);
  renderUploadPreviews();
}

$("#category").addEventListener("change", (e) => {
  applyCategoryDefaults(e.target.value);
});

$("#new-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();

  if (!state.selectedFiles.length) {
    showAlert("Please upload at least one product photo.");
    return;
  }

  if (!apiKeyReady()) {
    showAlert("Paste a valid OpenAI API key (starts with sk-) in the field above.");
    $("#api-key-section")?.setAttribute("open", "");
    document.getElementById("openai-api-key")?.focus();
    return;
  }

  const apiKey = getStoredApiKey();
  saveStoredApiKey(apiKey);

  const btn = $("#generate-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  const formData = new FormData();
  formData.append("item_name", $("#item-name").value.trim());
  formData.append("category", $("#category").value);
  formData.append("price", $("#price").value);
  formData.append("sku", $("#sku").value.trim());
  formData.append("modifiers", JSON.stringify(getModifiersFromContainer("#modifiers-container")));
  formData.append("openai_api_key", apiKey);
  state.selectedFiles.forEach((file) => formData.append("images", file));

  try {
    const res = await fetch("/api/items/generate", {
      method: "POST",
      headers: openaiKeyHeaders(),
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Generation failed");

    state.selectedFiles = [];
    renderUploadPreviews();
    const savedKey = getStoredApiKey();
    $("#new-item-form").reset();
    if (savedKey) {
      $("#openai-api-key").value = savedKey;
      saveStoredApiKey(savedKey);
    }
    if (state.categories.length) await applyCategoryDefaults(state.categories[0].id);

    openReview(data);
  } catch (err) {
    showAlert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate Listing";
  }
});

function openReview(item) {
  state.currentItem = item;
  switchView("review");

  const statusEl = $("#review-status");
  statusEl.textContent = item.status;
  statusEl.className = `status-badge ${item.status}`;

  renderReviewImages(item);
  $("#shop-title").value = item.shop_title || "";
  $("#etsy-title").value = item.etsy_title || "";
  $("#description").value = item.description || "";
  $("#tags-input").value = (item.tags || []).join(", ");
  renderTagsPreview();
  $("#review-item-name").value = item.item_name || "";
  $("#review-category").value = item.category || "";
  $("#review-price").value = item.price ?? "";
  $("#review-sku").value = item.sku || "";
  renderReviewModifiers(item.modifiers || []);
  renderReviewProduction(item);
}

function enabledModifiers(modifiers) {
  return (modifiers || []).filter((m) => m.enabled && String(m.value || "").trim());
}

function parseModifierValues(value) {
  const parts = String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? parts : [String(value).trim()];
}

function variationCombos(modifiers) {
  const enabled = enabledModifiers(modifiers);
  if (!enabled.length) return [[]];

  const optionLists = enabled.slice(0, 3).map((mod) => {
    const values = parseModifierValues(mod.value);
    return values.map((value) => [mod.label, value]);
  });

  return cartesianProduct(optionLists).map((combo) => combo.map(([label, value]) => [label, value]));
}

function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap((prefix) => curr.map((item) => [...prefix, item])),
    [[]]
  );
}

function variationName(combo) {
  if (!combo.length) return "Regular";
  return combo.map(([, value]) => value).join(" / ");
}

function variationKey(combo) {
  if (!combo.length) return "regular";
  return combo.map(([label, value]) => `${label}:${value}`).join("|");
}

function getActiveProductionSettings() {
  const filamentEl = $("#filament-price");
  const laborEl = $("#labor-rate");
  const electricityEl = $("#electricity-rate");
  if (filamentEl && laborEl && electricityEl) {
    const filament = parseFloat(filamentEl.value);
    const labor = parseFloat(laborEl.value);
    const electricity = parseFloat(electricityEl.value);
    return {
      filamentPricePerKg: Number.isFinite(filament) ? filament : 0,
      laborRatePerHour: Number.isFinite(labor) ? labor : 0,
      electricityRatePerHour: Number.isFinite(electricity) ? electricity : 0,
    };
  }
  return (
    state.productionSettings || {
      filamentPricePerKg: 25,
      laborRatePerHour: 0,
      electricityRatePerHour: 0,
    }
  );
}

function resolveListPrice(spec, fallback) {
  if (spec.price != null && spec.price !== "") return Number(spec.price);
  if (spec.list_price != null && spec.list_price !== "") return Number(spec.list_price);
  if (fallback != null && fallback !== "") return Number(fallback);
  return null;
}

function computeVariationCosts(spec, settings, listPrice) {
  const filamentGrams = spec.filament_grams ?? spec.filamentGrams;
  const printTimeHrs = spec.print_time_hrs ?? spec.printTimeHrs;
  const effectivePrice = resolveListPrice(spec, listPrice);

  let materialCost = null;
  if (filamentGrams != null && filamentGrams !== "") {
    materialCost =
      Math.round((Number(filamentGrams) / 1000) * settings.filamentPricePerKg * 100) / 100;
  }

  let laborCost = null;
  let electricityCost = null;
  if (printTimeHrs != null && printTimeHrs !== "") {
    const hrs = Number(printTimeHrs);
    const laborRate = settings.laborRatePerHour || 0;
    const electricityRate = settings.electricityRatePerHour || 0;
    if (laborRate > 0) {
      laborCost = Math.round(hrs * laborRate * 100) / 100;
    }
    if (electricityRate > 0) {
      electricityCost = Math.round(hrs * electricityRate * 100) / 100;
    }
  }

  const material = materialCost ?? 0;
  const labor = laborCost ?? 0;
  const electricity = electricityCost ?? 0;
  const hasMaterial = filamentGrams != null && filamentGrams !== "";
  const hasTime = printTimeHrs != null && printTimeHrs !== "";
  const totalCost =
    hasMaterial || (hasTime && (laborCost != null || electricityCost != null))
      ? Math.round((material + labor + electricity) * 100) / 100
      : null;

  let margin = null;
  let marginPct = null;
  if (totalCost != null && effectivePrice != null) {
    margin = Math.round((effectivePrice - totalCost) * 100) / 100;
    if (effectivePrice > 0) {
      marginPct = Math.round((margin / effectivePrice) * 1000) / 10;
    }
  }

  return { materialCost, laborCost, electricityCost, totalCost, margin, marginPct };
}

function formatMoney(value) {
  if (value == null || value === "") return "—";
  return `$${Number(value).toFixed(2)}`;
}

function formatMargin(margin, marginPct) {
  if (margin == null) return "—";
  const pct = marginPct != null ? ` (${marginPct}%)` : "";
  return `${formatMoney(margin)}${pct}`;
}

function renderProductionTable(container, variations, listPrice, { compact = false } = {}) {
  if (!variations.length) {
    container.innerHTML = '<p class="field-hint">No variations defined. Add modifiers on the listing first.</p>';
    return;
  }

  const settings = getActiveProductionSettings();

  container.innerHTML = `
    <table class="library-table production-table ${compact ? "production-table-compact" : ""}">
      <thead>
        <tr>
          <th>Variation</th>
          <th>Hours</th>
          <th>Filament (g)</th>
          <th>Infill method</th>
          <th>List price ($)</th>
          ${compact ? "" : "<th>Material</th><th>Labor</th><th>Total cost</th><th>Margin</th>"}
        </tr>
      </thead>
      <tbody>
        ${variations
          .map((row) => {
            const rowPrice = row.list_price ?? row.price ?? listPrice;
            const costs = computeVariationCosts(row, settings, listPrice);
            return `
              <tr data-variation-key="${escapeAttr(row.variation_key)}">
                <td>${escapeAttr(row.variation_name)}</td>
                <td>
                  <input type="number" class="prod-hours" step="0.1" min="0" placeholder="7.5"
                    value="${row.print_time_hrs ?? ""}" />
                </td>
                <td>
                  <input type="number" class="prod-grams" step="1" min="0" placeholder="282"
                    value="${row.filament_grams ?? ""}" />
                </td>
                <td>
                  <input type="text" class="prod-infill" list="infill-presets" placeholder="10% lightning"
                    value="${escapeAttr(row.infill_method || "")}" />
                </td>
                <td>
                  <input type="number" class="prod-price" step="0.01" min="0" placeholder="${listPrice ?? ""}"
                    value="${rowPrice ?? ""}" />
                </td>
                ${
                  compact
                    ? ""
                    : `<td class="prod-material">${formatMoney(costs.materialCost)}</td>
                       <td class="prod-labor">${formatMoney(costs.laborCost)}</td>
                       <td class="prod-total">${formatMoney(costs.totalCost)}</td>
                       <td class="prod-margin ${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}">${formatMargin(costs.margin, costs.marginPct)}</td>`
                }
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <datalist id="infill-presets">
      <option value="10% Grid"></option>
      <option value="12% Grid"></option>
      <option value="10% lightning"></option>
      <option value="15% lightning"></option>
    </datalist>
  `;

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => refreshProductionCosts());
  });
}

function refreshProductionCosts() {
  const settings = getActiveProductionSettings();
  const listPrice = state.productionListPrice ?? state.currentItem?.price ?? null;

  const editorTable = $("#production-editor-table");
  if (editorTable) {
    updateProductionTableCosts(editorTable, settings, listPrice);
  }

  const reviewContainer = $("#review-production");
  if (reviewContainer?.querySelector("tbody")) {
    updateProductionTableCosts(reviewContainer, settings, listPrice);
  }

  refreshAnalyzerCosts(settings);
}

function updateProductionTableCosts(container, settings, fallbackPrice) {
  container.querySelectorAll("tbody tr").forEach((row) => {
    const spec = readProductionRow(row);
    const costs = computeVariationCosts(spec, settings, fallbackPrice);
    const materialCell = row.querySelector(".prod-material");
    const laborCell = row.querySelector(".prod-labor");
    const totalCell = row.querySelector(".prod-total");
    const marginCell = row.querySelector(".prod-margin");
    if (materialCell) materialCell.textContent = formatMoney(costs.materialCost);
    if (laborCell) laborCell.textContent = formatMoney(costs.laborCost);
    if (totalCell) totalCell.textContent = formatMoney(costs.totalCost);
    if (marginCell) {
      marginCell.textContent = formatMargin(costs.margin, costs.marginPct);
      marginCell.className = `prod-margin ${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}`;
    }
  });
}

function refreshAnalyzerCosts(settings) {
  const tbody = $("#production-analyzer-body");
  const cards = $("#production-analyzer-cards");
  if (!state.analyzerRows?.length) return;

  state.analyzerRows.forEach((row, index) => {
    const costs = computeVariationCosts(row, settings, row.list_price);

    if (tbody) {
      const rowEl = tbody.querySelectorAll("tr")[index];
      if (rowEl) {
        const cells = rowEl.querySelectorAll("td");
        if (cells.length >= 10) {
          cells[5].textContent = formatMoney(costs.materialCost);
          cells[6].textContent = formatMoney(costs.laborCost);
          cells[7].textContent = formatMoney(costs.totalCost);
          cells[9].textContent = formatMargin(costs.margin, costs.marginPct);
          cells[9].className = costs.margin != null && costs.margin < 0 ? "text-danger" : "";
        }
      }
    }

    if (cards) {
      const card = cards.querySelector(`.production-card[data-index="${index}"]`);
      if (!card) return;
      const costEl = card.querySelector(".production-card-cost");
      const marginEl = card.querySelector(".production-card-margin");
      if (costEl) costEl.textContent = formatMoney(costs.totalCost);
      if (marginEl) {
        marginEl.textContent = formatMargin(costs.margin, costs.marginPct);
        marginEl.className = `production-card-margin ${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}`;
      }
      const materialEl = card.querySelector('[data-field="material"]');
      const laborEl = card.querySelector('[data-field="labor"]');
      const totalEl = card.querySelector('[data-field="total"]');
      const marginDetailEl = card.querySelector('[data-field="margin"]');
      if (materialEl) materialEl.textContent = formatMoney(costs.materialCost);
      if (laborEl) laborEl.textContent = formatMoney(costs.laborCost);
      if (totalEl) totalEl.textContent = formatMoney(costs.totalCost);
      if (marginDetailEl) {
        marginDetailEl.textContent = formatMargin(costs.margin, costs.marginPct);
        marginDetailEl.className = costs.margin != null && costs.margin < 0 ? "text-danger" : "";
      }
    }
  });
}

function updateProductionRowCosts(container, listPrice) {
  updateProductionTableCosts(container, getActiveProductionSettings(), listPrice);
}

function readProductionRow(row) {
  const hours = row.querySelector(".prod-hours")?.value.trim();
  const grams = row.querySelector(".prod-grams")?.value.trim();
  const infill = row.querySelector(".prod-infill")?.value.trim();
  const price = row.querySelector(".prod-price")?.value.trim();
  return {
    print_time_hrs: hours === "" ? null : Number(hours),
    filament_grams: grams === "" ? null : Number(grams),
    infill_method: infill || "",
    price: price === "" ? null : Number(price),
  };
}

function gatherProductionFromContainer(container) {
  const root = typeof container === "string" ? $(container) : container;
  const production = {};
  if (!root) return production;
  root.querySelectorAll("tbody tr").forEach((row) => {
    const key = row.dataset.variationKey;
    const spec = readProductionRow(row);
    const hasData =
      spec.print_time_hrs != null ||
      spec.filament_grams != null ||
      spec.infill_method ||
      spec.price != null;
    if (hasData) production[key] = spec;
  });
  return production;
}

function renderReviewProduction(item) {
  const container = $("#review-production");
  if (!container) return;

  const variations = (item.productionVariations || []).length
    ? item.productionVariations
    : buildLocalVariationRows(item);

  renderProductionTable(container, variations, item.price, { compact: true });
}

function productionCombos(modifiers, groupByLabel) {
  const combos = variationCombos(modifiers);
  if (!groupByLabel) return combos;

  const seen = new Set();
  const grouped = [];
  for (const combo of combos) {
    const part = combo.find(([label]) => label === groupByLabel);
    if (!part) continue;
    if (seen.has(part[1])) continue;
    seen.add(part[1]);
    grouped.push([part]);
  }
  return grouped.length ? grouped : combos;
}

function defaultGroupLabel(category) {
  const labels = { pot: "Opening Diameter", vase: "Height" };
  return labels[category] || null;
}

function buildLocalVariationRows(item) {
  const production = item.production || {};
  const groupLabel = defaultGroupLabel(item.category);
  return productionCombos(item.modifiers || [], groupLabel).map((combo) => {
    const key = variationKey(combo);
    const spec = production[key] || {};
    const listPrice = spec.price ?? item.price ?? null;
    return {
      variation_key: key,
      variation_name: variationName(combo),
      print_time_hrs: spec.print_time_hrs ?? null,
      filament_grams: spec.filament_grams ?? null,
      infill_method: spec.infill_method || "",
      price: spec.price ?? null,
      list_price: listPrice,
    };
  });
}

async function loadProductionSettings() {
  const res = await fetch("/api/production/settings");
  state.productionSettings = await res.json();
  $("#filament-price").value = state.productionSettings.filamentPricePerKg;
  $("#labor-rate").value = state.productionSettings.laborRatePerHour || "";
  $("#electricity-rate").value = state.productionSettings.electricityRatePerHour || "";
}

async function loadProductionItemSelect(selectedId = "") {
  const res = await fetch("/api/items");
  const items = await res.json();
  const select = $("#production-item-select");
  select.innerHTML =
    '<option value="">Select a listing…</option>' +
    items
      .map((item) => {
        const label = itemDisplayName(item);
        return `<option value="${item.id}">${escapeAttr(label)}</option>`;
      })
      .join("");
  if (selectedId) select.value = selectedId;
}

async function loadProductionEditor(itemId) {
  const editor = $("#production-editor");
  const saveBtn = $("#save-production-btn");
  state.productionItemId = itemId || null;

  if (!itemId) {
    editor.className = "production-editor-empty";
    editor.innerHTML = '<p class="field-hint">Choose a listing to enter print specs for each variation.</p>';
    saveBtn.disabled = true;
    return;
  }

  const res = await fetch(`/api/items/${itemId}/production`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not load production data");

  state.productionVariations = data.variations;
  editor.className = "";
  const groupHint = data.group_by_label
    ? `<p class="field-hint">Grouped by <strong>${escapeAttr(data.group_by_label)}</strong> — one row per physical size (color ignored).</p>`
    : "";
  editor.innerHTML = `<p class="field-hint"><strong>${escapeAttr(data.item_label)}</strong></p>${groupHint}<div id="production-editor-table"></div>`;
  const itemRes = await fetch(`/api/items/${itemId}`);
  const item = await itemRes.json();
  state.productionListPrice = item.price ?? null;
  renderProductionTable($("#production-editor-table"), data.variations, item.price);
  saveBtn.disabled = false;
}

async function loadProductionAnalyzer() {
  const params = new URLSearchParams();
  const category = $("#production-filter-category").value;
  const search = $("#production-search").value.trim();
  const trackedOnly = $("#production-tracked-only").checked;
  if (category) params.set("category", category);
  if (search) params.set("search", search);
  if (trackedOnly) params.set("tracked_only", "true");

  const res = await fetch(`/api/production/analyzer?${params}`);
  const data = await res.json();
  state.productionSettings = data.settings;

  const tbody = $("#production-analyzer-body");
  const cards = $("#production-analyzer-cards");
  const empty = $("#production-analyzer-empty");
  const rows = data.rows || [];
  state.analyzerRows = rows;

  if (!rows.length) {
    if (tbody) tbody.innerHTML = "";
    if (cards) cards.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  const settings = getActiveProductionSettings();

  if (tbody) {
    tbody.innerHTML = rows
      .map((row) => {
        const costs = computeVariationCosts(row, settings, row.list_price);
        return `
        <tr>
          <td>
            <button type="button" class="link-btn production-open-item" data-id="${row.item_id}">
              ${escapeAttr(row.item_label)}
            </button>
          </td>
          <td>${escapeAttr(row.variation_name)}</td>
          <td>${row.print_time_hrs ?? "—"}</td>
          <td>${row.filament_grams ?? "—"}</td>
          <td>${escapeAttr(row.infill_method || "—")}</td>
          <td>${formatMoney(costs.materialCost)}</td>
          <td>${formatMoney(costs.laborCost)}</td>
          <td>${formatMoney(costs.totalCost)}</td>
          <td>${formatMoney(row.list_price)}</td>
          <td class="${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}">
            ${formatMargin(costs.margin, costs.marginPct)}
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll(".production-open-item").forEach((btn) => {
      btn.addEventListener("click", async () => {
        $("#production-item-select").value = btn.dataset.id;
        await loadProductionEditor(btn.dataset.id);
        $("#production-editor").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  if (cards) {
    cards.innerHTML = rows
      .map((row, index) => {
        const costs = computeVariationCosts(row, settings, row.list_price);
        return `
        <article class="production-card" data-index="${index}">
          <button type="button" class="production-card-header" aria-expanded="false">
            <div class="production-card-title">
              <span class="production-card-listing">${escapeAttr(row.item_label)}</span>
              <span class="production-card-variation">${escapeAttr(row.variation_name)}</span>
            </div>
            <div class="production-card-stats">
              <span class="production-card-cost">${formatMoney(costs.totalCost)}</span>
              <span class="production-card-margin ${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}">${formatMargin(costs.margin, costs.marginPct)}</span>
            </div>
            <span class="production-card-chevron" aria-hidden="true">▼</span>
          </button>
          <div class="production-card-details hidden">
            <div class="production-detail-row"><span>Hours</span><span>${row.print_time_hrs ?? "—"}</span></div>
            <div class="production-detail-row"><span>Filament</span><span>${row.filament_grams != null ? `${row.filament_grams} g` : "—"}</span></div>
            <div class="production-detail-row"><span>Infill</span><span>${escapeAttr(row.infill_method || "—")}</span></div>
            <div class="production-detail-row"><span>Material</span><span data-field="material">${formatMoney(costs.materialCost)}</span></div>
            <div class="production-detail-row"><span>Labor</span><span data-field="labor">${formatMoney(costs.laborCost)}</span></div>
            <div class="production-detail-row"><span>Total cost</span><span data-field="total">${formatMoney(costs.totalCost)}</span></div>
            <div class="production-detail-row"><span>List price</span><span>${formatMoney(row.list_price)}</span></div>
            <div class="production-detail-row"><span>Margin</span><span data-field="margin" class="${costs.margin != null && costs.margin < 0 ? "text-danger" : ""}">${formatMargin(costs.margin, costs.marginPct)}</span></div>
            <button type="button" class="link-btn production-card-open production-open-item" data-id="${row.item_id}">Edit in tracker →</button>
          </div>
        </article>
      `;
      })
      .join("");

    cards.querySelectorAll(".production-card-header").forEach((header) => {
      header.addEventListener("click", () => {
        const card = header.closest(".production-card");
        const details = card.querySelector(".production-card-details");
        const expanded = card.classList.toggle("expanded");
        details.classList.toggle("hidden", !expanded);
        header.setAttribute("aria-expanded", expanded ? "true" : "false");
      });
    });

    cards.querySelectorAll(".production-open-item").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        $("#production-item-select").value = btn.dataset.id;
        await loadProductionEditor(btn.dataset.id);
        $("#production-editor").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }
}

async function loadProductionView(itemId = "") {
  await loadProductionSettings();
  await loadProductionItemSelect(itemId || state.productionItemId || "");
  if (itemId || state.productionItemId) {
    await loadProductionEditor(itemId || state.productionItemId);
  }
  await loadProductionAnalyzer();
}

function openProductionForItem(itemId) {
  switchView("production");
  state.productionItemId = itemId;
  loadProductionView(itemId);
}

function renderReviewImages(item) {
  const container = $("#review-images");
  const studio = getStudioImages(item);
  const styled = getStyledImages(item);
  const originals = (item.images || []).filter((i) => i.type === "original");

  container.innerHTML = studio
    .map((gen) => {
      const orig = originals.find((o) => o.sort_order === gen.sort_order);
      const style = styled.find((s) => s.sort_order === gen.sort_order);
      const genSelected = item.primary_image_id === gen.id;
      const styleSelected = style && item.primary_image_id === style.id;

      const studioCard = `
        <div class="image-pair ${genSelected ? "selected" : ""}" data-image-id="${gen.id}">
          <img src="${mediaUrl(gen.file_path)}" alt="Studio product photo" />
          <div class="meta">
            <span>Studio (white background)</span>
            <button type="button" class="btn btn-secondary btn-sm regenerate-btn" data-id="${gen.id}">Regenerate</button>
          </div>
          <div class="meta">
            <button type="button" class="link-btn set-primary-btn" data-id="${gen.id}">
              ${genSelected ? "✓ Primary" : "Set as primary"}
            </button>
          </div>
        </div>
      `;

      const styledCard = style
        ? `
        <div class="image-pair ${styleSelected ? "selected" : ""}" data-image-id="${style.id}">
          <img src="${mediaUrl(style.file_path)}" alt="Product with plant" />
          <div class="meta">
            <span>${escapeAttr(imageLabel(style))}</span>
            <button type="button" class="btn btn-secondary btn-sm regenerate-styled-btn" data-id="${style.id}">Regenerate</button>
          </div>
          <div class="meta">
            <button type="button" class="link-btn set-primary-btn" data-id="${style.id}">
              ${styleSelected ? "✓ Primary" : "Set as primary"}
            </button>
          </div>
        </div>
      `
        : "";

      const originalBlock = orig
        ? `
        <div class="image-pair image-pair-original">
          <img src="${mediaUrl(orig.file_path)}" alt="Original upload" />
          <div class="meta"><span>Original upload</span></div>
        </div>
      `
        : "";

      return `
        <div class="image-pair-group">
          ${studioCard}
          ${styledCard}
          ${originalBlock}
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".set-primary-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentItem.primary_image_id = btn.dataset.id;
      renderReviewImages(state.currentItem);
    });
  });

  container.querySelectorAll(".regenerate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!apiKeyReady()) {
        showAlert("Paste your OpenAI API key on the New Item tab first.");
        switchView("new");
        return;
      }
      btn.disabled = true;
      btn.textContent = "…";
      const apiKey = getStoredApiKey();
      const formData = new FormData();
      formData.append("image_id", btn.dataset.id);
      formData.append("openai_api_key", apiKey);
      try {
        const res = await fetch(`/api/items/${item.id}/regenerate-image`, {
          method: "POST",
          headers: openaiKeyHeaders(),
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Regeneration failed");
        state.currentItem = data;
        openReview(data);
      } catch (err) {
        showAlert(err.message);
      }
    });
  });

  container.querySelectorAll(".regenerate-styled-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!apiKeyReady()) {
        showAlert("Paste your OpenAI API key on the New Item tab first.");
        switchView("new");
        return;
      }
      btn.disabled = true;
      btn.textContent = "…";
      const apiKey = getStoredApiKey();
      const formData = new FormData();
      formData.append("image_id", btn.dataset.id);
      formData.append("openai_api_key", apiKey);
      try {
        const res = await fetch(`/api/items/${item.id}/regenerate-styled-image`, {
          method: "POST",
          headers: openaiKeyHeaders(),
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Regeneration failed");
        state.currentItem = data;
        openReview(data);
      } catch (err) {
        showAlert(err.message);
      }
    });
  });
}

$("#tags-input").addEventListener("input", renderTagsPreview);

function renderTagsPreview() {
  const tags = $("#tags-input")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  $("#tags-preview").innerHTML = tags.map((t) => `<span class="tag">${escapeAttr(t)}</span>`).join("");
}

$("#save-btn").addEventListener("click", saveCurrentItem);
$("#save-btn-mobile")?.addEventListener("click", saveCurrentItem);

async function saveCurrentItem() {
  if (!state.currentItem) return;
  hideAlert();

  const tags = $("#tags-input")
    .value.split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const payload = {
    item_name: $("#review-item-name").value.trim(),
    category: $("#review-category").value,
    etsy_title: $("#etsy-title").value.trim(),
    shop_title: $("#shop-title").value.trim(),
    description: $("#description").value.trim(),
    tags,
    price: $("#review-price").value ? parseFloat($("#review-price").value) : null,
    sku: $("#review-sku").value.trim() || null,
    modifiers: getModifiersFromContainer("#review-modifiers"),
    production: gatherProductionFromContainer("#review-production"),
    primary_image_id: state.currentItem.primary_image_id,
    status: "ready",
  };

  const btn = $("#save-btn");
  const btnMobile = $("#save-btn-mobile");
  if (btn) btn.disabled = true;
  if (btnMobile) btnMobile.disabled = true;

  try {
    const res = await fetch(`/api/items/${state.currentItem.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Save failed");
    state.currentItem = data;
    showAlert("Saved successfully.", "info");
    openReview(data);
  } catch (err) {
    showAlert(err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (btnMobile) btnMobile.disabled = false;
  }
}

$("#back-to-library").addEventListener("click", () => switchView("library"));
$("#back-to-library-mobile")?.addEventListener("click", () => switchView("library"));

async function loadLibrary() {
  const params = new URLSearchParams();
  const category = $("#filter-category").value;
  const status = $("#filter-status").value;
  const search = $("#library-search").value.trim();
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (search) params.set("search", search);

  const res = await fetch(`/api/items?${params}`);
  state.libraryItems = await res.json();
  state.selectedIds.clear();
  renderLibrary();
}

function renderLibrary() {
  const tbody = $("#library-body");
  const cards = $("#library-cards");
  const empty = $("#library-empty");
  syncSelectAllCheckboxes(false);
  updateSelectionButtons();

  if (!state.libraryItems.length) {
    if (tbody) tbody.innerHTML = "";
    if (cards) cards.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  if (tbody) {
    tbody.innerHTML = state.libraryItems
      .map((item) => {
        const thumb = getPrimaryThumb(item);
        return `
        <tr>
          <td><input type="checkbox" class="row-select" data-id="${item.id}" /></td>
          <td>${thumb ? `<img class="thumb" src="${mediaUrl(thumb.file_path)}" alt="" />` : ""}</td>
          <td>${escapeAttr(itemDisplayName(item))}</td>
          <td>${escapeAttr(categoryLabel(item.category))}</td>
          <td><span class="status-badge ${item.status}">${item.status}</span></td>
          <td>
            <div class="row-actions">
              <button type="button" class="link-btn preview-item" data-id="${item.id}">Preview</button>
              <button type="button" class="link-btn open-item" data-id="${item.id}">Edit</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    bindRowSelectHandlers(tbody);

    tbody.querySelectorAll(".preview-item").forEach((btn) => {
      btn.addEventListener("click", () => openPreview(btn.dataset.id));
    });

    tbody.querySelectorAll(".open-item").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await fetch(`/api/items/${btn.dataset.id}`);
        const data = await res.json();
        openReview(data);
      });
    });
  }

  if (cards) {
    cards.innerHTML = state.libraryItems
      .map((item) => {
        const thumb = getPrimaryThumb(item);
        const price =
          item.price != null && item.price !== "" ? formatMoney(item.price) : "";
        const metaParts = [categoryLabel(item.category)];
        if (price) metaParts.push(price);
        return `
        <article class="library-card" data-id="${item.id}">
          <label class="library-card-check" aria-label="Select ${escapeAttr(itemDisplayName(item))}">
            <input type="checkbox" class="row-select" data-id="${item.id}" />
          </label>
          ${
            thumb
              ? `<img class="library-card-thumb" src="${mediaUrl(thumb.file_path)}" alt="" />`
              : `<div class="library-card-thumb library-card-thumb--empty" aria-hidden="true"></div>`
          }
          <div class="library-card-body">
            <h3 class="library-card-name">${escapeAttr(itemDisplayName(item))}</h3>
            <p class="library-card-meta">${escapeAttr(metaParts.join(" · "))}</p>
            <span class="status-badge ${item.status}">${item.status}</span>
          </div>
          <button type="button" class="library-card-preview link-btn preview-item" data-id="${item.id}" aria-label="Preview listing">⋯</button>
        </article>
      `;
      })
      .join("");

    bindRowSelectHandlers(cards);

    cards.querySelectorAll(".library-card-check").forEach((label) => {
      label.addEventListener("click", (e) => e.stopPropagation());
    });

    cards.querySelectorAll(".library-card").forEach((card) => {
      card.addEventListener("click", async (e) => {
        if (e.target.closest(".library-card-check, .preview-item, .row-select")) return;
        const res = await fetch(`/api/items/${card.dataset.id}`);
        const data = await res.json();
        openReview(data);
      });
    });

    cards.querySelectorAll(".preview-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openPreview(btn.dataset.id);
      });
    });
  }
}

function getPrimaryThumb(item) {
  const images = item.images || [];
  if (item.primary_image_id) {
    return images.find((i) => i.id === item.primary_image_id);
  }
  return (
    images.find((i) => i.type === "generated") ||
    images.find((i) => i.type === "generated_styled") ||
    images[0]
  );
}

function updateSelectionButtons() {
  const hasSelection = state.selectedIds.size > 0;
  $("#export-btn").disabled = !hasSelection;
  $("#delete-btn").disabled = !hasSelection;
}

async function openPreview(itemId) {
  hideAlert();
  try {
    const res = await fetch(`/api/items/${itemId}`);
    const item = await res.json();
    if (!res.ok) throw new Error(item.detail || "Could not load listing");

    state.previewItemId = item.id;
    const previewImage = getPreviewImage(item);
    const listingImages = getListingImages(item);
    const tags = (item.tags || []).map((t) => `<span class="tag">${escapeAttr(t)}</span>`).join("");
    const price =
      item.price != null && item.price !== ""
        ? `$${Number(item.price).toFixed(2)}`
        : "—";

    const downloadBtn = $("#preview-download-btn");
    if (previewImage) {
      downloadBtn.classList.remove("hidden");
      downloadBtn.disabled = false;
      downloadBtn.dataset.filePath = previewImage.file_path;
      downloadBtn.dataset.filename = imageDownloadName(
        item,
        previewImage,
        listingImages.findIndex((i) => i.id === previewImage.id),
        listingImages.length
      );
    } else {
      downloadBtn.classList.add("hidden");
      downloadBtn.disabled = true;
      delete downloadBtn.dataset.filePath;
      delete downloadBtn.dataset.filename;
    }

    $("#preview-body").innerHTML = `
      <div class="preview-hero">
        ${renderPreviewImagesGallery(item)}
        <div class="preview-meta">
          <div><strong>Status:</strong> <span class="status-badge ${item.status}">${item.status}</span></div>
          <div><strong>Category:</strong> ${escapeAttr(categoryLabel(item.category))}</div>
          <div><strong>Item name:</strong> ${escapeAttr(item.item_name || "—")}</div>
          <div><strong>Price:</strong> ${price}</div>
          <div><strong>SKU:</strong> ${escapeAttr(item.sku || "—")}</div>
        </div>
      </div>
      <div class="preview-section">
        <h3>Variations</h3>
        ${formatItemModifiersPreview(item)}
        ${formatPreviewSizePrices(item)}
      </div>
      <div class="preview-section">
        <h3>Listing title</h3>
        <p>${escapeAttr(item.shop_title || itemDisplayName(item))}</p>
      </div>
      ${
        item.etsy_title
          ? `<div class="preview-section"><h3>Etsy shop title</h3><p>${escapeAttr(item.etsy_title)}</p></div>`
          : ""
      }
      <div class="preview-section">
        <h3>Description</h3>
        <div class="preview-description">${escapeAttr(item.description || "—")}</div>
      </div>
      <div class="preview-section">
        <h3>Tags</h3>
        <div id="preview-tags">${tags || "<span class=\"field-hint\">No tags</span>"}</div>
      </div>
    `;

    $("#preview-body").querySelectorAll(".preview-download-inline").forEach((btn) => {
      btn.addEventListener("click", () =>
        downloadPreviewImage(btn.dataset.filePath, btn.dataset.filename, btn)
      );
    });

    $("#preview-body").querySelectorAll(".preview-generate-styled-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        generatePreviewStyledImage(item.id, Number(btn.dataset.sortOrder), btn)
      );
    });

    $("#preview-modal").classList.remove("hidden");
  } catch (err) {
    showAlert(err.message);
  }
}

function closePreview() {
  state.previewItemId = null;
  $("#preview-modal").classList.add("hidden");
}

async function generatePreviewStyledImage(itemId, sortOrder, btn) {
  if (!apiKeyReady()) {
    showAlert("Paste your OpenAI API key on the New Item tab first.");
    switchView("new");
    return;
  }

  hideAlert();
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Generating…";
  }

  const formData = new FormData();
  formData.append("sort_order", String(sortOrder));
  formData.append("openai_api_key", getStoredApiKey());

  try {
    const res = await fetch(`/api/items/${itemId}/generate-styled-image`, {
      method: "POST",
      headers: openaiKeyHeaders(),
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not generate styled image");
    await openPreview(itemId);
    loadLibrary();
  } catch (err) {
    showAlert(err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function downloadPreviewImage(filePath, filename, btn) {
  if (!filePath) return;
  hideAlert();
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Downloading…";
  }
  try {
    await downloadMediaFile(filePath, filename);
  } catch (err) {
    showAlert(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function handleSelectAllChange(checked) {
  syncSelectAllCheckboxes(checked);
  $$(".row-select").forEach((cb) => {
    cb.checked = checked;
    if (checked) state.selectedIds.add(cb.dataset.id);
    else state.selectedIds.delete(cb.dataset.id);
  });
  updateSelectionButtons();
}

$("#select-all")?.addEventListener("change", (e) => {
  handleSelectAllChange(e.target.checked);
});

$("#select-all-mobile")?.addEventListener("change", (e) => {
  handleSelectAllChange(e.target.checked);
});

$("#export-btn").addEventListener("click", async () => {
  hideAlert();
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: [...state.selectedIds] }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || "Export failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "square-catalog-export.csv";
    a.click();
    URL.revokeObjectURL(url);
    showAlert(`Exported ${state.selectedIds.size} item(s).`, "info");
  } catch (err) {
    showAlert(err.message);
  }
});

$("#delete-btn").addEventListener("click", async () => {
  const count = state.selectedIds.size;
  if (!count) return;

  const label = count === 1 ? "this listing" : `${count} listings`;
  if (!window.confirm(`Delete ${label}? This removes images from disk and cannot be undone.`)) {
    return;
  }

  hideAlert();
  const btn = $("#delete-btn");
  btn.disabled = true;

  try {
    const res = await fetch("/api/items/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_ids: [...state.selectedIds] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Delete failed");
    showAlert(`Deleted ${data.deleted} item(s).`, "info");
    await loadLibrary();
  } catch (err) {
    showAlert(err.message);
    updateSelectionButtons();
  }
});

$$("[data-close-preview]").forEach((el) => {
  el.addEventListener("click", closePreview);
});

$("#preview-edit-btn").addEventListener("click", async () => {
  const itemId = state.previewItemId;
  if (!itemId) return;
  closePreview();
  const res = await fetch(`/api/items/${itemId}`);
  const data = await res.json();
  openReview(data);
});

$("#preview-download-btn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  downloadPreviewImage(btn.dataset.filePath, btn.dataset.filename, btn);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#filament-order-modal").classList.contains("hidden")) {
    closeFilamentOrderModal();
    return;
  }
  if (!$("#preview-modal").classList.contains("hidden")) {
    closePreview();
  }
});

$("#filter-category").addEventListener("change", loadLibrary);
$("#filter-status").addEventListener("change", loadLibrary);
$("#library-search").addEventListener(
  "input",
  debounce(() => loadLibrary(), 300)
);

$$("button[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

$$("[data-view-link]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.viewLink));
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function loadSquareExamples() {
  const res = await fetch("/api/square/examples");
  const data = await res.json();
  const items = data.items || [];
  const status = $("#examples-status");
  const list = $("#examples-list");

  if (data.imported_at) {
    status.className = "alert alert-info";
    status.textContent = `${items.length} example listing(s) loaded from ${data.source_file || "Square"} (updated ${new Date(data.imported_at).toLocaleDateString()}).`;
  } else {
    status.className = "alert alert-info";
    status.textContent = `${items.length} built-in examples from retromindscreations.com. Import your Square CSV to replace them.`;
  }

  if (!items.length) {
    list.innerHTML = '<p class="field-hint">No examples yet. Import your Square catalog export.</p>';
    return;
  }

  list.innerHTML = items
    .slice(0, 12)
    .map(
      (item) => `
      <div class="example-item">
        <strong>${escapeAttr(item.item_name)}</strong>
        <span>${escapeAttr(item.square_category || item.category_id)} · $${item.price ?? "—"}</span>
        <p class="field-hint">${escapeAttr((item.description || "").slice(0, 140))}${(item.description || "").length > 140 ? "…" : ""}</p>
      </div>
    `
    )
    .join("");
}

$("#square-import-btn").addEventListener("click", () => {
  $("#square-import-input").click();
});

$("#square-import-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideAlert();

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/square/import", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Import failed");
    showAlert(`Imported ${data.imported} items from Square.`, "info");
    loadSquareExamples();
  } catch (err) {
    showAlert(err.message);
  } finally {
    e.target.value = "";
  }
});

$("#save-production-settings-btn").addEventListener("click", async () => {
  hideAlert();
  const payload = getActiveProductionSettings();
  try {
    const res = await fetch("/api/production/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not save settings");
    state.productionSettings = data;
    showAlert("Cost settings saved.", "info");
    refreshProductionCosts();
    if (state.productionItemId) await loadProductionEditor(state.productionItemId);
    await loadProductionAnalyzer();
    if (state.currentItem) renderReviewProduction(state.currentItem);
  } catch (err) {
    showAlert(err.message);
  }
});

$("#production-item-select").addEventListener("change", async (e) => {
  try {
    await loadProductionEditor(e.target.value);
  } catch (err) {
    showAlert(err.message);
  }
});

$("#save-production-btn").addEventListener("click", async () => {
  if (!state.productionItemId) return;
  hideAlert();
  const btn = $("#save-production-btn");
  btn.disabled = true;

  const production = gatherProductionFromContainer($("#production-editor-table"));
  try {
    const res = await fetch(`/api/items/${state.productionItemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ production }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Save failed");
    showAlert("Production data saved.", "info");
    await loadProductionEditor(state.productionItemId);
    await loadProductionAnalyzer();
  } catch (err) {
    showAlert(err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#production-filter-category").addEventListener("change", loadProductionAnalyzer);
$("#production-tracked-only").addEventListener("change", loadProductionAnalyzer);
$("#production-search").addEventListener("input", debounce(() => loadProductionAnalyzer(), 300));

["#filament-price", "#labor-rate", "#electricity-rate"].forEach((selector) => {
  $(selector)?.addEventListener("input", () => refreshProductionCosts());
});

$("#open-production-tab-btn").addEventListener("click", () => {
  if (state.currentItem) openProductionForItem(state.currentItem.id);
});

async function loadFilamentColorOptions() {
  const res = await fetch("/api/options");
  const options = await res.json();
  const colors = new Set([...(options.colorsFull || []), ...(options.colorsTrellis || [])]);
  const datalist = $("#filament-color-options");
  if (!datalist) return;
  datalist.innerHTML = [...colors]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => `<option value="${escapeAttr(c)}"></option>`)
    .join("");
}

function filamentStockIndicator(qty) {
  if (qty === 0) {
    return '<span class="stock-indicator stock-alert" title="Out of stock — reorder" aria-label="Alert: out of stock">!</span>';
  }
  if (qty === 1) {
    return '<span class="stock-indicator stock-warning" title="Low stock — 1 spool left" aria-label="Warning: low stock">!</span>';
  }
  return "";
}

function filamentRowClass(qty) {
  if (qty === 0) return "filament-row-alert";
  if (qty === 1) return "filament-row-warning";
  return "";
}

function sortFilamentSpools(spools) {
  const { column, direction } = state.filamentSort;
  const mul = direction === "asc" ? 1 : -1;
  return [...spools].sort((a, b) => {
    if (column === "quantity") {
      return (a.quantity - b.quantity) * mul;
    }
    return a.color_name.localeCompare(b.color_name, undefined, { sensitivity: "base" }) * mul;
  });
}

function updateFilamentSortIndicators() {
  $$(".filament-table .sortable-th").forEach((btn) => {
    const indicator = btn.querySelector(".sort-indicator");
    const active = btn.dataset.sort === state.filamentSort.column;
    btn.classList.toggle("sort-active", active);
    if (indicator) {
      indicator.textContent = active ? (state.filamentSort.direction === "asc" ? "↑" : "↓") : "";
    }
  });
}

function renderFilamentInventoryTable() {
  const sorted = sortFilamentSpools(state.filamentSpools);
  const total = sorted.reduce((sum, row) => sum + row.quantity, 0);
  renderFilamentTable(sorted, total);
  updateFilamentSortIndicators();
}

function bindFilamentRowEvents(root) {
  if (!root) return;
  root.querySelectorAll(".filament-minus").forEach((btn) => {
    btn.addEventListener("click", () => adjustFilamentSpool(btn.dataset.id, -1));
  });
  root.querySelectorAll(".filament-plus").forEach((btn) => {
    btn.addEventListener("click", () => adjustFilamentSpool(btn.dataset.id, 1));
  });
  root.querySelectorAll(".filament-remove").forEach((btn) => {
    btn.addEventListener("click", () =>
      removeFilamentSpool(btn.dataset.id, btn.closest("tr") || btn.closest(".filament-card"))
    );
  });
  root.querySelectorAll(".filament-color-input").forEach((input) => {
    const save = () => saveFilamentColorName(input);
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        input.value = input.dataset.original;
        input.blur();
      }
    });
  });
}

function renderFilamentTable(spools, totalSpools) {
  const tbody = $("#filament-body");
  const cards = $("#filament-cards");
  const empty = $("#filament-empty");
  const totalEl = $("#filament-total");

  totalEl.textContent = `Total spools: ${totalSpools}`;

  if (!spools.length) {
    if (tbody) tbody.innerHTML = "";
    if (cards) cards.innerHTML = "";
    empty.classList.remove("hidden");
    updateFilamentSortIndicators();
    return;
  }

  empty.classList.add("hidden");

  if (tbody) {
    tbody.innerHTML = spools
      .map(
        (spool) => `
      <tr data-id="${spool.id}" class="${filamentRowClass(spool.quantity)}">
        <td>
          <input
            type="text"
            class="filament-color-input"
            data-id="${spool.id}"
            data-original="${escapeAttr(spool.color_name)}"
            value="${escapeAttr(spool.color_name)}"
            list="filament-color-options"
            aria-label="Color name"
          />
        </td>
        <td>
          <div class="qty-display">
            ${filamentStockIndicator(spool.quantity)}
            <span class="qty-value">${spool.quantity}</span>
          </div>
        </td>
        <td>
          <div class="filament-row-actions">
            <button type="button" class="btn btn-secondary btn-sm filament-minus" data-id="${spool.id}" title="Open a spool" ${spool.quantity === 0 ? "disabled" : ""}>−</button>
            <button type="button" class="btn btn-secondary btn-sm filament-plus" data-id="${spool.id}" title="Add one spool">+</button>
            <button type="button" class="link-btn filament-remove" data-id="${spool.id}">Remove</button>
          </div>
        </td>
      </tr>
    `
      )
      .join("");
    bindFilamentRowEvents(tbody);
  }

  if (cards) {
    cards.innerHTML = spools
      .map(
        (spool) => `
      <article class="filament-card ${filamentRowClass(spool.quantity)}" data-id="${spool.id}">
        <div class="filament-card-header">
          ${filamentStockIndicator(spool.quantity)}
          <input
            type="text"
            class="filament-color-input"
            data-id="${spool.id}"
            data-original="${escapeAttr(spool.color_name)}"
            value="${escapeAttr(spool.color_name)}"
            list="filament-color-options"
            aria-label="Color name"
          />
        </div>
        <div class="filament-card-qty">
          <button type="button" class="btn btn-secondary filament-minus" data-id="${spool.id}" title="Open a spool" ${spool.quantity === 0 ? "disabled" : ""} aria-label="Remove one spool">−</button>
          <span class="qty-value">${spool.quantity}</span>
          <button type="button" class="btn btn-secondary filament-plus" data-id="${spool.id}" title="Add one spool" aria-label="Add one spool">+</button>
        </div>
        <button type="button" class="link-btn filament-remove" data-id="${spool.id}">Remove color</button>
      </article>
    `
      )
      .join("");
    bindFilamentRowEvents(cards);
  }
}

async function saveFilamentColorName(input) {
  const spoolId = input.dataset.id;
  const original = input.dataset.original || "";
  const next = input.value.trim();
  if (!next || next === original) {
    input.value = original;
    return;
  }

  hideAlert();
  input.disabled = true;
  try {
    const res = await fetch(`/api/filament/spools/${spoolId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color_name: next }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not rename color");
    const idx = state.filamentSpools.findIndex((s) => s.id === spoolId);
    if (idx >= 0) {
      state.filamentSpools[idx] = data;
    }
    input.dataset.original = data.color_name;
    input.value = data.color_name;
    renderFilamentInventoryTable();
  } catch (err) {
    showAlert(err.message);
    input.value = original;
  } finally {
    input.disabled = false;
  }
}

async function loadFilamentInventory() {
  hideAlert();
  await loadFilamentColorOptions();
  const res = await fetch("/api/filament/spools");
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Could not load filament inventory");
  state.filamentSpools = data.spools || [];
  renderFilamentInventoryTable();
}

$$(".filament-table .sortable-th").forEach((btn) => {
  btn.addEventListener("click", () => {
    const column = btn.dataset.sort;
    if (state.filamentSort.column === column) {
      state.filamentSort.direction = state.filamentSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.filamentSort.column = column;
      state.filamentSort.direction = "asc";
    }
    renderFilamentInventoryTable();
  });
});

async function adjustFilamentSpool(spoolId, delta) {
  hideAlert();
  try {
    const res = await fetch(`/api/filament/spools/${spoolId}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not update quantity");
    await loadFilamentInventory();
  } catch (err) {
    showAlert(err.message);
  }
}

async function removeFilamentSpool(spoolId, row) {
  const color =
    row?.querySelector(".filament-color-input")?.value?.trim() ||
    row?.querySelector("td")?.textContent?.trim() ||
    "this color";
  if (!window.confirm(`Remove ${color} from filament inventory?`)) return;
  hideAlert();
  try {
    const res = await fetch(`/api/filament/spools/${spoolId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not remove color");
    await loadFilamentInventory();
  } catch (err) {
    showAlert(err.message);
  }
}

$("#filament-add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  const color = $("#filament-color").value.trim();
  const quantity = parseInt($("#filament-qty").value, 10) || 1;
  const btn = e.submitter || e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/filament/spools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color_name: color, quantity }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not add spools");
    $("#filament-color").value = "";
    $("#filament-qty").value = "1";
    showAlert(`Added ${quantity} spool(s) for ${color}.`, "info");
    await loadFilamentInventory();
  } catch (err) {
    showAlert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

function filamentOrderQty(onHand) {
  if (onHand === 0) return 2;
  if (onHand === 1) return 1;
  return 0;
}

function buildFilamentOrderLines(spools) {
  return spools
    .map((spool) => ({
      color_name: spool.color_name,
      on_hand: spool.quantity,
      order_qty: filamentOrderQty(spool.quantity),
    }))
    .filter((line) => line.order_qty > 0)
    .sort(
      (a, b) =>
        a.on_hand - b.on_hand ||
        a.color_name.localeCompare(b.color_name, undefined, { sensitivity: "base" })
    );
}

function formatFilamentOrderCopy(lines) {
  if (!lines.length) return "";
  const items = lines
    .map((line, index) => {
      const text = `${line.order_qty}× ${line.color_name}`;
      return index < lines.length - 1 ? `${text},` : text;
    })
    .join("\n");
  return `Need to order:\nSummary:\n${items}`;
}

function openFilamentOrderModal() {
  hideAlert();
  const lines = buildFilamentOrderLines(state.filamentSpools);
  state.filamentOrderCopy = formatFilamentOrderCopy(lines);
  const body = $("#filament-order-body");
  const copyBtn = $("#filament-order-copy-btn");

  if (!lines.length) {
    const emptyInventory = !state.filamentSpools.length;
    body.innerHTML = emptyInventory
      ? '<p class="field-hint" style="margin:0;">Add colors to your inventory first, then generate an order when stock runs low.</p>'
      : '<p class="field-hint" style="margin:0;">Nothing to order — every tracked color has at least 2 spools on hand.</p>';
    copyBtn.disabled = true;
  } else {
    const totalOrder = lines.reduce((sum, line) => sum + line.order_qty, 0);
    body.innerHTML = `
      <p class="field-hint" style="margin-top:0;">
        ${lines.length} color(s) · ${totalOrder} spool(s) to order
        <span style="display:block;margin-top:0.25rem;">0 on hand → order 2 · 1 on hand → order 1</span>
      </p>
      <table class="library-table order-table">
        <thead>
          <tr>
            <th>Color</th>
            <th>On hand</th>
            <th>Order</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (line) => `
            <tr class="${line.on_hand === 0 ? "filament-row-alert" : "filament-row-warning"}">
              <td>${escapeAttr(line.color_name)}</td>
              <td>${line.on_hand}</td>
              <td><strong>${line.order_qty}</strong></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
    copyBtn.disabled = false;
  }

  $("#filament-order-modal").classList.remove("hidden");
}

function closeFilamentOrderModal() {
  state.filamentOrderCopy = "";
  $("#filament-order-modal").classList.add("hidden");
}

$("#filament-order-btn").addEventListener("click", openFilamentOrderModal);

$$("[data-close-filament-order]").forEach((el) => {
  el.addEventListener("click", closeFilamentOrderModal);
});

$("#filament-order-copy-btn").addEventListener("click", async () => {
  if (!state.filamentOrderCopy) return;
  hideAlert();
  const btn = $("#filament-order-copy-btn");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(state.filamentOrderCopy);
    btn.textContent = "Copied!";
    showAlert("Order list copied to clipboard.", "info");
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  } catch {
    showAlert("Could not copy — select the list manually.");
  }
});

async function init() {
  setupDropzone();
  bindApiKeyInput();
  loadStoredApiKeyIntoForm();
  initMobileApiKeySection();
  window.addEventListener("resize", debounce(initMobileApiKeySection, 150));
  await loadCategories();

  const health = await fetch("/api/health").then((r) => r.json());
  state.openaiEnvConfigured = !!health.openai_env_configured;
  updateOpenAiKeyHint(state.openaiEnvConfigured);
}

init();
