import { APP_CONFIG } from "./config.js";
import { animalTypeLabel, calculateExpectedCalving, calculateMilkValue, getMilkWeekPeriod, toLocalDateString } from "./domain/farm-rules.js";
import { validateAnimal, validateMilk, validateWeight, validateFinance } from "./domain/validation.js?build=20260922-04";
import * as FarmRepository from "./storage/farm-repository.js?build=20260922-04";
import { getAuthClient } from "./auth.js";
import { startSyncLoop } from "./sync/sync-engine.js";

const $ = (selector) => document.querySelector(selector);
let signedIn = false;
let accessGeneration = 0;

function clearFarmView() {
  ["#animal-form", "#milk-form", "#weight-form", "#breeding-form", "#health-form", "#finance-form"].forEach((selector) => {
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
  $("#finance-empty").hidden = false;
  for (const id of ["#finance-income", "#finance-expense", "#finance-net"]) $(id).textContent = "KSh 0.00";
  $("#finance-count").textContent = "0 entries";
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

function money(cents) {
  return "KSh " + (cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function refreshFinance(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const entries = await FarmRepository.listFinanceEntries();
  if (!canShowFarmData(generation)) return;
  const income = entries.filter((row) => row.direction === "income").reduce((sum, row) => sum + row.amountCents, 0);
  const expense = entries.filter((row) => row.direction === "expense").reduce((sum, row) => sum + row.amountCents, 0);
  $("#finance-income").textContent = money(income);
  $("#finance-expense").textContent = money(expense);
  $("#finance-net").textContent = money(income - expense);
  $("#finance-count").textContent = entries.length + (entries.length === 1 ? " entry" : " entries");
  $("#finance-empty").hidden = entries.length > 0;
  $("#finance-list").innerHTML = entries.slice(0, 20).map((row) =>
    '<div class="finance-entry"><div><strong>' + escapeHtml(row.category) + '</strong><small>' +
    escapeHtml(row.localDate) + ' · ' + escapeHtml(row.details) + '</small><small>' +
    escapeHtml(row.paymentMethod) + (row.paymentReference ? ' · ' + escapeHtml(row.paymentReference) : '') +
    '</small></div><strong class="' + (row.direction === "income" ? "money-in" : "money-out") + '">' +
    (row.direction === "income" ? "+" : "−") + money(row.amountCents) + '</strong></div>').join("");
}

async function handleFinanceSubmit(event) {
  event.preventDefault();
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
    event.currentTarget.reset();
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
  if (!statusEl || !emailEl || !passwordEl || !signInButton || !signOutButton || !restoreButton) return;

  let clientPromise = null;
  const getClient = () => {
    if (!clientPromise) clientPromise = getAuthClient();
    return clientPromise;
  };

  const setSignedOut = () => {
    signedIn = false;
    accessGeneration += 1;
    setAppAccess(false);
    clearFarmView();
    selectMilkSession("morning");
    authCard.hidden = false;
    accountActions.hidden = true;
    accountActions.open = false;
    statusEl.textContent = "Not signed in — sign in to access farm features.";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    restoreButton.hidden = true;
  };

  const setSignedIn = (user) => {
    signedIn = true;
    const generation = ++accessGeneration;
    setAppAccess(true);
    authCard.hidden = true;
    accountActions.hidden = false;
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
    if (user) setSignedIn(user);
    else setSignedOut();
  };

  getClient().then(async (client) => {
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setSignedIn(session.user);
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
  document.querySelectorAll("[data-finance-direction]").forEach((button) => {
    button.addEventListener("click", () => selectFinanceDirection(button.dataset.financeDirection));
  });

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
