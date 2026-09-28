import { APP_CONFIG } from "./config.js";
import { animalTypeLabel, calculateExpectedCalving, calculateMilkValue, getMilkWeekPeriod, toLocalDateString } from "./domain/farm-rules.js";
import { filterFinanceEntries, formatFinanceMoney, summarizeFinanceEntries } from "./domain/finance.js?build=20260927-01";
import { validateAnimal, validateMilk, validateWeight, validateFinance } from "./domain/validation.js?build=20260922-04";
import * as FarmRepository from "./storage/farm-repository.js?build=20260927-02";
import { getAuthClient } from "./auth.js";
import { verifyFarmAccess } from "./farm-access.js?build=20260927-02";
import { inspectRecoveryBackup } from "./storage/recovery-preflight.js?build=20260927-02";
import { claimLegacyAnimal } from "./storage/legacy-claim.js?build=20260927-02";
import { startSyncLoop } from "./sync/sync-engine.js?build=20260927-02";

const $ = (selector) => document.querySelector(selector);
let signedIn = false;
let accessGeneration = 0;

function clearFarmView() {
  ["#animal-form", "#milk-form", "#weight-form", "#breeding-form", "#health-form", "#finance-form",
    "#feed-form", "#feed-source-form", "#feed-observation-form"].forEach((selector) => {
    $(selector).reset();
  });
  $("#milk-value-preview").textContent = "—";
  $("#milk-checklist").replaceChildren();
  $("#milk-checklist-summary").textContent = "";
  $("#animal-list").replaceChildren();
  $("#animals-empty").hidden = false;
  $("#animal-profile").hidden = true;
  ["#profile-name", "#profile-type", "#profile-breed", "#profile-status", "#profile-source", "#profile-birth"].forEach((selector) => {
    $(selector).textContent = "";
  });
  const image = $("#profile-photo");
  if (image.src) URL.revokeObjectURL(image.src);
  image.removeAttribute("src");
  image.hidden = true;
  ["#milk-animal", "#weight-animal", "#health-animal", "#breeding-animal"].forEach((selector) => {
    $(selector).replaceChildren();
  });
  ["#stat-total", "#stat-dairy", "#stat-bulls", "#stat-calves", "#sync-count"].forEach((selector) => {
    $(selector).textContent = "0";
  });
  $("#today-milk").textContent = "0.0 L";
  $("#today-value").textContent = "KSh 0";
  $("#week-period").textContent = "—";
  $("#finance-list").replaceChildren();
  $("#finance-category-summary").replaceChildren();
  $("#finance-period").value = "month";
  $("#finance-empty").hidden = false;
  for (const id of ["#finance-income", "#finance-expense", "#finance-net"]) $(id).textContent = "KSh 0.00";
  $("#finance-count").textContent = "0 entries";
  selectedFeedId = null;
  ["#feed-list", "#feed-source-list", "#feed-profile", "#feed-conflicts"].forEach((selector) => $(selector).replaceChildren());
  ["#feed-observation-feed", "#feed-observation-source"].forEach((selector) => $(selector).replaceChildren());
  $("#feed-count").textContent = "0 feeds";
  $("#feed-source-count").textContent = "0 sources";
  $("#feed-empty").hidden = false;
  $("#feed-source-empty").hidden = false;
  $("#feed-profile-empty").hidden = false;
  $("#feed-profile-empty").textContent = "Choose a feed from the farm library to review its observations.";
  $("#feed-profile-title").textContent = "Select a feed";
}

const canShowFarmData = (generation) => signedIn && generation === accessGeneration;

function setAppAccess(unlocked) {
  document.querySelectorAll(".auth-gated").forEach((el) => {
    el.classList.toggle("auth-unlocked", unlocked);
    if (el.matches("[data-view]")) {
      el.hidden = !unlocked || el.dataset.view !== "home";
      el.style.setProperty("display", unlocked && el.dataset.view === "home" ? "block" : "none", "important");
    } else if (el.classList.contains("bottom-nav")) {
      el.style.setProperty("display", unlocked ? "grid" : "none", "important");
    }
  });
  const lockMessage = $("#auth-lock-message");
  if (lockMessage) {
    lockMessage.hidden = unlocked;
    lockMessage.style.setProperty("display", unlocked ? "none" : "block", "important");
  }
  if (!unlocked) {
    const status = $("#app-status");
    if (status) status.textContent = "Sign in required";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, tone = "info") {
  const el = $("#app-status");
  el.textContent = message;
  el.dataset.tone = tone;
}

const feedRoleLabels = { forage: "Forage", concentrate: "Concentrate", mineral: "Mineral", other: "Other" };
const nutrientLabels = { DM: "Dry matter", ME: "Metabolizable energy", CP: "Crude protein", NDF: "NDF",
  ADF: "ADF", STARCH: "Starch", FAT: "Fat", ASH: "Ash", CA: "Calcium", P: "Phosphorus" };
const evidenceClasses = [["VERIFIED_LAB", "Verified laboratory"], ["RESEARCH_SUPPORTED", "Research supported"],
  ["MANUFACTURER_DECLARED", "Manufacturer declared"], ["FARM_MEASURED", "Farm measured"],
  ["CALCULATED", "Calculated"], ["MODEL_ESTIMATED", "Model estimated"],
  ["RANGE_ESTIMATE", "Range estimate"], ["PROVISIONAL", "Provisional"], ["UNKNOWN", "Unknown"]];
let selectedFeedId = null;

function selectNutritionMetric() {
  const nutrient = $("#feed-observation-nutrient").value;
  const basis = nutrient === "DM" ? "AS_FED" : "DRY_MATTER";
  const units = nutrient === "DM" ? [["PERCENT", "% as fed"], ["G_PER_KG_AS_FED", "g/kg as fed"]] :
    nutrient === "ME" ? [["MJ_PER_KG_DM", "MJ/kg DM"]] : [["PERCENT", "% DM"], ["G_PER_KG_DM", "g/kg DM"]];
  $("#feed-observation-basis").replaceChildren(new Option(basis === "AS_FED" ? "As fed" : "Dry matter", basis));
  $("#feed-observation-unit").replaceChildren(...units.map(([value, label]) => new Option(label, value)));
}

function renderFeedOptions(feeds, sources) {
  const feedOptions = [new Option("Choose feed", "")].concat(feeds.map((feed) => new Option(feed.name, feed.id)));
  $("#feed-observation-feed").replaceChildren(...feedOptions);
  const sourceOptions = [new Option("Choose source", "")].concat(sources.map((source) => new Option(source.title, source.id)));
  $("#feed-observation-source").replaceChildren(...sourceOptions);
}

async function renderNutritionProfile(feedId, generation = accessGeneration) {
  selectedFeedId = feedId || null;
  document.querySelectorAll("[data-feed-id]").forEach((row) => row.classList.toggle("active", row.dataset.feedId === selectedFeedId));
  $("#feed-conflicts").replaceChildren();
  $("#feed-profile").replaceChildren();
  if (!feedId) {
    $("#feed-profile-title").textContent = "Select a feed";
    $("#feed-profile-empty").hidden = false;
    return;
  }
  const profile = await FarmRepository.getNutritionProfile(feedId);
  if (!canShowFarmData(generation) || selectedFeedId !== feedId || !profile) return;
  $("#feed-profile-title").textContent = profile.feed.name;
  const groups = Object.entries(profile.nutrients);
  $("#feed-profile-empty").hidden = groups.length > 0;
  $("#feed-profile-empty").textContent = groups.length ? "" : "No nutrition observations have been recorded for this feed.";
  $("#feed-conflicts").innerHTML = profile.conflicts.map((code) =>
    '<div class="feed-conflict">Conflicting ' + escapeHtml(nutrientLabels[code] || code) + ' observations retained for review; no average was calculated.</div>').join("");
  $("#feed-profile").innerHTML = groups.map(([code, rows]) => '<section class="nutrient-group"><h4>' +
    escapeHtml(nutrientLabels[code] || code) + '</h4>' + rows.map((row) => '<div class="observation"><strong>' +
    escapeHtml(row.value + " " + row.unit.replaceAll("_", " ")) + '</strong><small>' +
    escapeHtml(row.evidenceClass.replaceAll("_", " ") + " · " + (row.observedAt || "Date not recorded")) +
    '</small><small>' + escapeHtml(row.source.title + " — " + row.source.citation) + '</small>' +
    (row.context ? '<small>' + escapeHtml(row.context) + '</small>' : '') + '</div>').join("") + '</section>').join("");
}

async function refreshFeedWorkspace(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const [feeds, sources] = await Promise.all([FarmRepository.listFeeds(), FarmRepository.listNutritionSources()]);
  if (!canShowFarmData(generation)) return;
  $("#feed-count").textContent = feeds.length + (feeds.length === 1 ? " feed" : " feeds");
  $("#feed-source-count").textContent = sources.length + (sources.length === 1 ? " source" : " sources");
  $("#feed-empty").hidden = feeds.length > 0;
  $("#feed-source-empty").hidden = sources.length > 0;
  $("#feed-list").innerHTML = feeds.map((feed) => '<button type="button" class="feed-row" data-feed-id="' +
    escapeHtml(feed.id) + '"><span><strong>' + escapeHtml(feed.name) + '</strong><small>' +
    escapeHtml(feedRoleLabels[feed.role] || feed.role) + '</small></span><span aria-hidden="true">Review →</span></button>').join("");
  $("#feed-source-list").innerHTML = sources.map((source) => '<div class="evidence-row"><strong>' +
    escapeHtml(source.title) + '</strong><small>' + escapeHtml(source.sourceType.replaceAll("_", " ")) +
    (source.publicationYear ? " · " + source.publicationYear : "") + '</small><small>' +
    escapeHtml(source.citation) + '</small></div>').join("");
  renderFeedOptions(feeds, sources);
  if (!feeds.some((feed) => feed.id === selectedFeedId)) selectedFeedId = feeds[0]?.id || null;
  if (selectedFeedId) $("#feed-observation-feed").value = selectedFeedId;
  await renderNutritionProfile(selectedFeedId, generation);
}

async function handleFeedSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    const feed = await FarmRepository.createFeed({ name: $("#feed-name").value, role: $("#feed-role").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); selectedFeedId = feed.id; await refreshFeedWorkspace(generation);
    setStatus("Feed added to this farm library.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleFeedSourceSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.createNutritionSource({ title: $("#feed-source-title").value,
      sourceType: $("#feed-source-type").value, citation: $("#feed-source-citation").value,
      publisher: $("#feed-source-publisher").value, publicationYear: $("#feed-source-year").value,
      url: $("#feed-source-url").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Evidence source saved for review.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleFeedObservationSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    const feedId = $("#feed-observation-feed").value;
    await FarmRepository.createNutritionObservation(feedId, { sourceId: $("#feed-observation-source").value,
      nutrientCode: $("#feed-observation-nutrient").value, value: $("#feed-observation-value").value,
      unit: $("#feed-observation-unit").value, basis: $("#feed-observation-basis").value,
      evidenceClass: $("#feed-observation-evidence").value,
      observedAt: $("#feed-observation-date").value || null, rangeMin: $("#feed-observation-min").value,
      rangeMax: $("#feed-observation-max").value, sampleCount: $("#feed-observation-samples").value,
      context: $("#feed-observation-context").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); selectNutritionMetric(); selectedFeedId = feedId;
    await refreshFeedWorkspace(generation); setStatus("Nutrition observation saved for review only.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

function showView(viewName) {
  document.querySelectorAll("[data-view]").forEach((section) => {
    const active = section.classList.contains("auth-unlocked") && section.dataset.view === viewName;
    section.hidden = !active;
    section.style.setProperty("display", active ? "block" : "none", "important");
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === viewName);
  });
}

async function refreshDashboard(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const today = toLocalDateString();
  const results = await Promise.all([
    FarmRepository.getHerdSummary(),
    FarmRepository.getTodayMilkSummary(today),
    FarmRepository.getPendingSyncCount()
  ]);
  if (!canShowFarmData(generation)) return;

  const herd = results[0];
  const milk = results[1];
  const pending = results[2];

  $("#stat-total").textContent = herd.total;
  $("#stat-dairy").textContent = herd.dairyCows;
  $("#stat-bulls").textContent = herd.bulls;
  $("#stat-calves").textContent = herd.calves;
  $("#today-milk").textContent = milk.totalLiters.toFixed(1) + " L";
  $("#today-value").textContent = "KSh " + calculateMilkValue(milk.totalLiters).toLocaleString();
  $("#sync-count").textContent = pending;
  $("#today-date").textContent = today;

  const week = getMilkWeekPeriod(today);
  $("#week-period").textContent = week.start + " → " + week.end;
}

function animalCard(animal) {
  return '<button type="button" class="animal-card" data-animal-id="' + escapeHtml(animal.id) + '">' +
    '<div class="animal-card-main"><strong>' + escapeHtml(animal.animalCode) + '</strong>' +
    '<span>' + escapeHtml(animalTypeLabel(animal.type)) + '</span></div>' +
    '<span class="chip">' + escapeHtml(animal.breed) + '</span></button>';
}

function refreshAnimalList(animals) {
  $("#animals-empty").hidden = animals.length > 0;
  $("#animal-list").innerHTML = animals.map(animalCard).join("");
}

async function openAnimal(animalId) {
  const generation = accessGeneration;
  if (!canShowFarmData(generation)) return;
  const result = await FarmRepository.getAnimal(animalId);
  if (!canShowFarmData(generation)) return;
  if (!result) {
    setStatus("Animal not found on this device.", "error");
    return;
  }

  $("#animal-profile").hidden = false;
  $("#profile-name").textContent = result.animal.animalCode;
  $("#profile-type").textContent = animalTypeLabel(result.animal.type);
  $("#profile-breed").textContent = result.animal.breed;
  $("#profile-status").textContent = result.animal.status;
  $("#profile-source").textContent = result.animal.source || "Not recorded";
  $("#profile-birth").textContent = result.animal.birthDate || "Not recorded";

  const image = $("#profile-photo");
  if (image.src) URL.revokeObjectURL(image.src);
  if (result.photo) {
    image.src = URL.createObjectURL(result.photo);
    image.hidden = false;
  } else {
    image.hidden = true;
  }
}

function populateAnimalSelectors(animals) {
  const options = (rows) => ['<option value="">Choose animal</option>']
    .concat(rows.map((a) => '<option value="' + escapeHtml(a.id) + '">' +
      escapeHtml(a.animalCode) + " — " + escapeHtml(animalTypeLabel(a.type)) + "</option>"))
    .join("");
  $("#milk-animal").innerHTML = options(animals.filter((a) => a.type === "dairy_cow" && a.status === "active"));
  $("#weight-animal").innerHTML = options(animals.filter((a) => a.type === "bull"));
  $("#breeding-animal").innerHTML = options(animals.filter((a) => a.type === "dairy_cow"));
  $("#health-animal").innerHTML = options(animals);
}

async function refreshMilkChecklist(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const date = $("#milk-date").value || toLocalDateString();
  const session = $("#milk-session").value;
  const [animals, records] = await Promise.all([
    FarmRepository.listAnimals(), FarmRepository.listMilkRecordsForDate(date)
  ]);
  if (!canShowFarmData(generation) || date !== $("#milk-date").value || session !== $("#milk-session").value) return;
  const cows = animals.filter((a) => a.type === "dairy_cow" && a.status === "active");
  const counts = new Map();
  records.filter((row) => row.session === session).forEach((row) => counts.set(row.animalId, (counts.get(row.animalId) || 0) + 1));
  const missing = cows.filter((cow) => !counts.has(cow.id)).length;
  $("#milk-checklist-summary").textContent = date + ": " + missing + " of " + cows.length + " active dairy cows have no " + session + " record.";
  $("#milk-checklist").innerHTML = cows.map((cow) => '<div class="session-row"><span>' + escapeHtml(cow.animalCode) + '</span><strong>' +
    (counts.has(cow.id) ? counts.get(cow.id) + ' recorded' : 'No record') + '</strong></div>').join("");
}

function selectMilkSession(session) {
  $("#milk-session").value = session;
  const label = session[0].toUpperCase() + session.slice(1);
  $("#milk-session-heading").textContent = "Record " + session + " milk";
  $("#milk-checklist-heading").textContent = label + " records";
  document.querySelectorAll("[data-milk-session]").forEach((button) => {
    button.classList.toggle("active", button.dataset.milkSession === session);
    button.setAttribute("aria-pressed", String(button.dataset.milkSession === session));
  });
  refreshMilkChecklist().catch((error) => setStatus("Milk records could not be checked: " + (error.message || error), "error"));
}

const financeCategories = {
  income: ["Milk sale", "Animal sale", "Other income"],
  expense: ["Feed", "Veterinary", "Labour", "Maintenance", "Transport", "Other expense"]
};

function selectFinanceDirection(direction) {
  if (!financeCategories[direction]) return;
  $("#finance-direction").value = direction;
  $("#finance-category").replaceChildren(...financeCategories[direction].map((name) => new Option(name, name)));
  $("#finance-save").textContent = direction === "income" ? "Save income locally" : "Save expense locally";
  document.querySelectorAll("[data-finance-direction]").forEach((button) => {
    const active = button.dataset.financeDirection === direction;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function refreshFinance(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const allEntries = await FarmRepository.listFinanceEntries();
  if (!canShowFarmData(generation)) return;
  const entries = filterFinanceEntries(allEntries, $("#finance-period").value, toLocalDateString());
  const summary = summarizeFinanceEntries(entries);
  $("#finance-income").textContent = formatFinanceMoney(summary.incomeCents);
  $("#finance-expense").textContent = formatFinanceMoney(summary.expenseCents);
  $("#finance-net").textContent = formatFinanceMoney(summary.netCents);
  $("#finance-count").textContent = entries.length + (entries.length === 1 ? " entry" : " entries");
  $("#finance-empty").hidden = entries.length > 0;
  $("#finance-category-summary").innerHTML = summary.categoryTotals.map((row) =>
    '<span><b>' + escapeHtml(row.category) + '</b> ' + escapeHtml(formatFinanceMoney(row.amountCents)) + '</span>').join("");
  $("#finance-list").innerHTML = entries.slice(0, 20).map((row) =>
    '<div class="finance-entry"><div><strong>' + escapeHtml(row.category) + '</strong><small>' +
    escapeHtml(row.localDate) + ' · ' + escapeHtml(row.details) + '</small><small>' +
    escapeHtml(row.paymentMethod) + (row.paymentReference ? ' · ' + escapeHtml(row.paymentReference) : '') +
    '</small></div><strong class="' + (row.direction === "income" ? "money-in" : "money-out") + '">' +
    (row.direction === "income" ? "+" : "−") + formatFinanceMoney(row.amountCents) + '</strong></div>').join("");
}

async function handleFinanceSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const generation = accessGeneration;
  if (!canShowFarmData(generation)) return;
  const button = $("#finance-save");
  if (button.disabled) return;
  try {
    button.disabled = true;
    const entry = validateFinance({ direction: $("#finance-direction").value,
      category: $("#finance-category").value, amount: $("#finance-amount").value,
      localDate: $("#finance-date").value, details: $("#finance-details").value,
      paymentMethod: $("#finance-method").value, paymentReference: $("#finance-reference").value });
    if (!canShowFarmData(generation)) return;
    await FarmRepository.saveGenericRecord("finance", entry);
    if (!canShowFarmData(generation)) return;
    form.reset();
    selectFinanceDirection(entry.direction);
    $("#finance-date").value = toLocalDateString();
    await refreshFinance(generation);
    await refreshDashboard(generation);
    if (canShowFarmData(generation)) setStatus("Money entry saved on this device.", "success");
  } catch (error) {
    if (canShowFarmData(generation)) setStatus(error.message || String(error), "error");
  } finally { button.disabled = false; }
}

async function refreshAnimalData(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const animals = await FarmRepository.listAnimals();
  if (!canShowFarmData(generation)) return;
  populateAnimalSelectors(animals);
  refreshAnimalList(animals);
  await refreshMilkChecklist(generation);
}

async function handleAnimalSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const file = $("#animal-photo").files[0];
    const input = validateAnimal({
      animalCode: $("#animal-code").value,
      type: $("#animal-type").value,
      breed: $("#animal-breed").value,
      sex: $("#animal-sex").value,
      birthDate: $("#animal-birth").value,
      acquiredDate: $("#animal-acquired").value,
      source: $("#animal-source").value,
      rfid: $("#animal-rfid").value,
      qrValue: $("#animal-qr").value,
      status: $("#animal-status").value,
      notes: $("#animal-notes").value,
      photoBlob: file
    });

    await FarmRepository.saveAnimal(input, file);
    form.reset();
    setStatus("Animal saved on this device.", "success");
    await refreshAnimalData();
    await refreshDashboard();
    showView("animals");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleMilkSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const generation = accessGeneration;

  try {
    const input = validateMilk({
      animalId: $("#milk-animal").value,
      session: $("#milk-session").value,
      liters: $("#milk-liters").value,
      localDate: $("#milk-date").value || toLocalDateString()
    });

    await FarmRepository.saveMilkRecord(input);
    if (!canShowFarmData(generation)) return;
    form.reset();
    $("#milk-date").value = input.localDate;
    $("#milk-session").value = input.session;
    $("#milk-value-preview").textContent = "—";
    setStatus("Milk saved locally. " + input.liters + " L recorded for " + input.session + ".", "success");
    await refreshDashboard();
    if (!canShowFarmData(generation)) return;
    selectMilkSession(input.session);
    showView("milk");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleWeightSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const input = validateWeight({
      animalId: $("#weight-animal").value,
      kilograms: $("#weight-kg").value,
      localDate: $("#weight-date").value || toLocalDateString()
    });

    await FarmRepository.saveWeightRecord(input);
    form.reset();
    $("#weight-date").value = toLocalDateString();
    setStatus("Weight saved locally: " + input.kilograms + " kg.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleBreedingSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const animalId = $("#breeding-animal").value;
    const serviceDate = $("#breeding-date").value;
    if (!animalId || !serviceDate) throw new Error("Animal and service date are required.");

    const expectedCalving = calculateExpectedCalving(serviceDate);
    await FarmRepository.saveGenericRecord("breeding", {
      animalId,
      serviceDate,
      expectedCalving
    });

    form.reset();
    setStatus("Breeding saved locally. Expected calving: " + expectedCalving + ".", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleHealthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const animalId = $("#health-animal").value;
    const treatmentDate = $("#health-date").value;
    const treatmentType = $("#health-type").value;

    if (!animalId || !treatmentDate || !treatmentType) {
      throw new Error("Animal, date and treatment type are required.");
    }

    await FarmRepository.saveGenericRecord("health", {
      animalId,
      treatmentDate,
      treatmentType,
      description: $("#health-description").value.trim(),
      cost: Number($("#health-cost").value || 0)
    });

    form.reset();
    $("#health-date").value = toLocalDateString();
    setStatus("Health record saved locally.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function initAuth() {
  const statusEl = $("#auth-status");
  const emailEl = $("#auth-email");
  const passwordEl = $("#auth-password");
  const signInButton = $("#auth-sign-in");
  const signOutButton = $("#auth-sign-out");
  const restoreButton = $("#auth-restore");
  const authCard = $("#auth-card");
  const accountActions = $("#account-actions");
  const recoveryEvidence = $("#recovery-evidence");
  const recoveryInput = $("#recovery-backup");
  const recoveryResult = $("#recovery-result");
  const recoveryClaim = $("#recovery-claim");
  const recoveryAnimal = $("#recovery-animal");
  const recoveryCode = $("#recovery-code");
  const recoveryConfirm = $("#recovery-confirm");
  const recoveryButton = $("#recovery-claim-button");
  if (!statusEl || !emailEl || !passwordEl || !signInButton || !signOutButton || !restoreButton) return;

  let clientPromise = null;
  let activeUserId = null;
  let claimController = null;
  let claimBusy = false;
  const getClient = () => {
    if (!clientPromise) clientPromise = getAuthClient();
    return clientPromise;
  };

  const setSignedOut = () => {
    claimController?.abort();
    claimController = null;
    claimBusy = false;
    activeUserId = null;
    signedIn = false;
    accessGeneration += 1;
    FarmRepository.setActiveFarm(null);
    setAppAccess(false);
    clearFarmView();
    selectMilkSession("morning");
    authCard.hidden = false;
    accountActions.hidden = true;
    accountActions.open = false;
    recoveryEvidence.hidden = true;
    recoveryInput.value = "";
    recoveryResult.textContent = "";
    recoveryClaim.hidden = true;
    recoveryAnimal.replaceChildren();
    recoveryCode.value = "";
    recoveryConfirm.checked = false;
    recoveryButton.disabled = true;
    statusEl.textContent = "Not signed in — sign in to access farm features.";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    restoreButton.hidden = true;
  };

  const activateUser = async (user, client) => {
    setSignedOut();
    const generation = accessGeneration;
    statusEl.textContent = "Verifying farm membership…";
    try {
      const farmId = await verifyFarmAccess(client, user);
      if (generation !== accessGeneration) return;
      FarmRepository.setActiveFarm(farmId);
      setSignedIn(user);
    } catch (error) {
      if (generation !== accessGeneration) return;
      statusEl.textContent = error.message || String(error);
      authCard.hidden = true;
      accountActions.hidden = false;
      signInButton.hidden = true;
      signOutButton.hidden = false;
      setStatus("Farm access unavailable: " + (error.message || error), "error");
    }
  };

  const setSignedIn = (user) => {
    signedIn = true;
    activeUserId = user.id;
    const generation = ++accessGeneration;
    setAppAccess(true);
    authCard.hidden = true;
    accountActions.hidden = false;
    recoveryEvidence.hidden = false;
    $("#milk-date").value = toLocalDateString();
    $("#weight-date").value = toLocalDateString();
    $("#health-date").value = toLocalDateString();
    $("#finance-date").value = toLocalDateString();
    statusEl.textContent = "Signed in";
    signInButton.hidden = true;
    signOutButton.hidden = false;
    restoreButton.hidden = true;
    restoreButton.disabled = true;
    emailEl.value = user?.email || "";
    passwordEl.value = "";
    setStatus("Signed in to the farm cloud account.", "success");
    refreshAll(generation).catch((error) => {
      if (canShowFarmData(generation)) setStatus("Local records could not be refreshed: " + (error.message || error), "error");
    });
  };

  setSignedOut();

  recoveryInput.addEventListener("change", async () => {
    if (!signedIn || !recoveryInput.files?.[0]) return;
    const generation = accessGeneration;
    recoveryClaim.hidden = true;
    recoveryAnimal.replaceChildren();
    recoveryCode.value = "";
    recoveryConfirm.checked = false;
    recoveryButton.disabled = true;
    recoveryResult.textContent = "Checking backup against this device…";
    try {
      const result = await inspectRecoveryBackup(recoveryInput.files[0]);
      if (!canShowFarmData(generation)) return;
      recoveryResult.textContent = "Backup matches current local records (" + result.sha256 + "). " +
        result.unownedAnimals.length + " unowned animal(s) await ownership review. No records changed.";
      result.unownedAnimals.filter((animal) => animal.linksValid && animal.recordCount === 0).forEach((animal) => {
        const option = document.createElement("option");
        option.value = animal.id;
        option.textContent = animal.animalCode;
        recoveryAnimal.appendChild(option);
      });
      recoveryClaim.hidden = !recoveryAnimal.options.length;
    } catch (error) {
      if (canShowFarmData(generation)) recoveryResult.textContent = error.message || String(error);
    }
  });

  const updateClaimButton = () => {
    const selected = recoveryAnimal.selectedOptions[0];
    recoveryButton.disabled = claimBusy || !signedIn || !selected || !recoveryConfirm.checked ||
      recoveryCode.value.trim() !== selected.textContent || !recoveryInput.files?.[0];
  };
  [recoveryAnimal, recoveryCode, recoveryConfirm].forEach((element) => {
    element.addEventListener("input", updateClaimButton);
    element.addEventListener("change", updateClaimButton);
  });

  recoveryButton.addEventListener("click", async () => {
    updateClaimButton();
    if (recoveryButton.disabled) return;
    const generation = accessGeneration;
    const userId = activeUserId;
    const selectedId = recoveryAnimal.value;
    const animalCode = recoveryCode.value.trim();
    const file = recoveryInput.files[0];
    const controller = new AbortController();
    claimController = controller;
    claimBusy = true;
    recoveryButton.disabled = true;
    recoveryResult.textContent = "Verifying membership and claiming the selected local group…";
    try {
      const result = await claimLegacyAnimal({ client: await getClient(), userId, animalId: selectedId,
        animalCode, file, signal: controller.signal,
        assertCurrent: () => {
          if (!canShowFarmData(generation) || activeUserId !== userId) throw new Error("Farm session changed during claim.");
        } });
      if (!canShowFarmData(generation)) return;
      recoveryClaim.hidden = true;
      recoveryResult.textContent = result.status === "already_claimed" ? "This local animal was already claimed." :
        "Selected animal, photo and pending entry claimed locally. Cloud sync remains disabled.";
      await refreshAll(generation);
    } catch (error) {
      if (canShowFarmData(generation)) {
        recoveryResult.textContent = error.message || String(error);
      }
    } finally {
      if (claimController === controller) {
        claimBusy = false;
        claimController = null;
        if (canShowFarmData(generation)) updateClaimButton();
      }
    }
  });

  signInButton.addEventListener("click", async () => {
    try {
      signInButton.disabled = true;
      statusEl.textContent = "Connecting to sign-in service…";
      const email = emailEl.value.trim();
      const password = passwordEl.value;
      if (!email || !password) throw new Error("Enter your email and password.");
      const client = await getClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await refreshAuthState();
    } catch (error) {
      setSignedOut();
      setStatus("Sign-in failed: " + (error.message || error), "error");
    } finally {
      signInButton.disabled = false;
    }
  });

  signOutButton.addEventListener("click", async () => {
    try {
      const client = await getClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      setSignedOut();
      setStatus("Signed out. Farm features are locked.", "success");
    } catch (error) {
      setStatus("Sign-out failed: " + (error.message || error), "error");
    }
  });

  const refreshAuthState = async () => {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const user = data?.session?.user || null;
    if (user) await activateUser(user, client);
    else setSignedOut();
  };

  getClient().then(async (client) => {
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) activateUser(session.user, client).catch((error) => setStatus(error.message, "error"));
      else setSignedOut();
    });
    try {
      await refreshAuthState();
    } catch (error) {
      statusEl.textContent = "Sign-in service unavailable; try Sign in again.";
      setStatus("Authentication setup failed: " + (error.message || error), "error");
    }
  }).catch((error) => {
    statusEl.textContent = "Sign-in service unavailable; try Sign in again.";
    setStatus("Authentication setup failed: " + (error.message || error), "error");
  });
}
async function refreshAll(generation = accessGeneration) {
  await refreshAnimalData(generation);
  await refreshDashboard(generation);
  await refreshFinance(generation);
  await refreshFeedWorkspace(generation);
}

export async function initApp() {
  setAppAccess(false);
  showView("home");
  $("#milk-date").value = toLocalDateString();
  $("#weight-date").value = toLocalDateString();
  $("#health-date").value = toLocalDateString();
  $("#finance-date").value = toLocalDateString();
  selectFinanceDirection("income");
  selectMilkSession("morning");
  $("#feed-observation-evidence").replaceChildren(...evidenceClasses.map(([value, label]) => new Option(label, value)));
  selectNutritionMetric();

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.nav));
  });

  document.querySelectorAll("[data-nav-action]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.navAction));
  });

  document.querySelectorAll("[data-milk-session]").forEach((button) => {
    button.addEventListener("click", () => selectMilkSession(button.dataset.milkSession));
  });
  $("#milk-date").addEventListener("change", () => refreshMilkChecklist().catch((error) => setStatus(error.message, "error")));

  initAuth().catch((error) => {
    setStatus("Sign-in service unavailable. Local farm features remain locked.", "error");
  });

  $("#animal-form").addEventListener("submit", handleAnimalSubmit);
  $("#milk-form").addEventListener("submit", handleMilkSubmit);
  $("#weight-form").addEventListener("submit", handleWeightSubmit);
  $("#breeding-form").addEventListener("submit", handleBreedingSubmit);
  $("#health-form").addEventListener("submit", handleHealthSubmit);
  $("#finance-form").addEventListener("submit", handleFinanceSubmit);
  $("#feed-form").addEventListener("submit", handleFeedSubmit);
  $("#feed-source-form").addEventListener("submit", handleFeedSourceSubmit);
  $("#feed-observation-form").addEventListener("submit", handleFeedObservationSubmit);
  $("#feed-observation-nutrient").addEventListener("change", selectNutritionMetric);
  $("#feed-list").addEventListener("click", (event) => {
    const row = event.target.closest("[data-feed-id]");
    if (!row) return;
    $("#feed-observation-feed").value = row.dataset.feedId;
    renderNutritionProfile(row.dataset.feedId).catch((error) => setStatus(error.message, "error"));
  });
  document.querySelectorAll("[data-finance-direction]").forEach((button) => {
    button.addEventListener("click", () => selectFinanceDirection(button.dataset.financeDirection));
  });
  $("#finance-period").addEventListener("change", () => refreshFinance().catch((error) => setStatus(error.message, "error")));

  $("#animal-list").addEventListener("click", (event) => {
    const card = event.target.closest("[data-animal-id]");
    if (card) openAnimal(card.dataset.animalId);
  });

  $("#breeding-date").addEventListener("change", () => {
    const date = $("#breeding-date").value;
    $("#expected-calving").value = date ? calculateExpectedCalving(date) : "";
  });

  $("#milk-liters").addEventListener("input", () => {
    const liters = Number($("#milk-liters").value || 0);
    $("#milk-value-preview").textContent = liters > 0
      ? "KSh " + calculateMilkValue(liters).toLocaleString()
      : "—";
  });

  setStatus("Ready. Records save on this device first.", "success");

  startSyncLoop(async () => {
    if (!signedIn) return;
    const generation = accessGeneration;
    await refreshDashboard(generation);
    if (canShowFarmData(generation) && navigator.onLine && APP_CONFIG.cloud.enabled) setStatus("Cloud sync attempted.", "info");
  });
}
