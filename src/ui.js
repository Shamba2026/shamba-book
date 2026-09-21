import { APP_CONFIG } from "./config.js";
import { animalTypeLabel, calculateExpectedCalving, calculateMilkValue, getMilkWeekPeriod, toLocalDateString } from "./domain/farm-rules.js";
import { validateAnimal, validateMilk, validateWeight } from "./domain/validation.js";
import * as FarmRepository from "./storage/farm-repository.js";
import { getAuthClient } from "./auth.js";
import { pullFarmSnapshot } from "./cloud/supabase-adapter.js";
import { startSyncLoop } from "./sync/sync-engine.js";

const $ = (selector) => document.querySelector(selector);
let signedIn = false;
let accessGeneration = 0;

function clearFarmView() {
  ["#animal-form", "#milk-form", "#weight-form", "#breeding-form", "#health-form"].forEach((selector) => {
    $(selector).reset();
  });
  $("#milk-value-preview").textContent = "—";
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
  const options = ['<option value="">Choose animal</option>']
    .concat(animals.map((a) => '<option value="' + escapeHtml(a.id) + '">' +
      escapeHtml(a.animalCode) + " — " + escapeHtml(animalTypeLabel(a.type)) + "</option>"))
    .join("");

  ["#milk-animal", "#weight-animal", "#health-animal", "#breeding-animal"].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = options;
  });
}

async function refreshAnimalData(generation = accessGeneration) {
  if (!canShowFarmData(generation)) return;
  const animals = await FarmRepository.listAnimals();
  if (!canShowFarmData(generation)) return;
  populateAnimalSelectors(animals);
  refreshAnimalList(animals);
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

  try {
    const input = validateMilk({
      animalId: $("#milk-animal").value,
      session: $("#milk-session").value,
      liters: $("#milk-liters").value,
      localDate: $("#milk-date").value || toLocalDateString()
    });

    await FarmRepository.saveMilkRecord(input);
    form.reset();
    $("#milk-date").value = toLocalDateString();
    $("#milk-value-preview").textContent = "—";
    setStatus("Milk saved locally. " + input.liters + " L recorded for " + input.session + ".", "success");
    await refreshDashboard();
    showView("home");
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
    statusEl.textContent = "Not signed in — sign in to access farm features.";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    restoreButton.hidden = true;
  };

  const setSignedIn = (user) => {
    signedIn = true;
    const generation = ++accessGeneration;
    setAppAccess(true);
    $("#milk-date").value = toLocalDateString();
    $("#weight-date").value = toLocalDateString();
    $("#health-date").value = toLocalDateString();
    statusEl.textContent = "Signed in";
    signInButton.hidden = true;
    signOutButton.hidden = false;
    restoreButton.hidden = false;
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

  restoreButton.addEventListener("click", async () => {
    try {
      restoreButton.disabled = true;
      setStatus("Restoring cloud records to this device…", "info");
      const snapshot = await pullFarmSnapshot();
      const result = await FarmRepository.importCloudSnapshot(snapshot);
      await refreshAnimalData();
      await refreshDashboard();
      setStatus("Cloud records restored: " + result.importedAnimals + " animals, " + result.importedRecords + " activity records.", "success");
    } catch (error) {
      setStatus("Cloud restore failed: " + (error.message || error), "error");
    } finally {
      restoreButton.disabled = false;
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
}

export async function initApp() {
  setAppAccess(false);
  showView("home");
  $("#milk-date").value = toLocalDateString();
  $("#weight-date").value = toLocalDateString();
  $("#health-date").value = toLocalDateString();

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.nav));
  });

  document.querySelectorAll("[data-nav-action]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.navAction));
  });

  initAuth().catch((error) => {
    setStatus("Sign-in service unavailable. Local farm features remain locked.", "error");
  });

  $("#animal-form").addEventListener("submit", handleAnimalSubmit);
  $("#milk-form").addEventListener("submit", handleMilkSubmit);
  $("#weight-form").addEventListener("submit", handleWeightSubmit);
  $("#breeding-form").addEventListener("submit", handleBreedingSubmit);
  $("#health-form").addEventListener("submit", handleHealthSubmit);

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
