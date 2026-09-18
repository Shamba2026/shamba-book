import { APP_CONFIG } from "./config.js";
import { animalTypeLabel, calculateExpectedCalving, calculateMilkValue, getMilkWeekPeriod, toLocalDateString } from "./domain/farm-rules.js";
import { validateAnimal, validateMilk, validateWeight } from "./domain/validation.js";
import * as FarmRepository from "./storage/farm-repository.js";
import { startSyncLoop } from "./sync/sync-engine.js";

const $ = (selector) => document.querySelector(selector);

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
    section.hidden = section.dataset.view !== viewName;
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === viewName);
  });
}

async function refreshDashboard() {
  const today = toLocalDateString();
  const results = await Promise.all([
    FarmRepository.getHerdSummary(),
    FarmRepository.getTodayMilkSummary(today),
    FarmRepository.getPendingSyncCount()
  ]);

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

async function refreshAnimalList() {
  const animals = await FarmRepository.listAnimals();
  $("#animals-empty").hidden = animals.length > 0;
  $("#animal-list").innerHTML = animals.map(animalCard).join("");
}

async function openAnimal(animalId) {
  const result = await FarmRepository.getAnimal(animalId);
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

async function refreshAnimalData() {
  const animals = await FarmRepository.listAnimals();
  populateAnimalSelectors(animals);
  await refreshAnimalList();
}

async function handleAnimalSubmit(event) {
  event.preventDefault();
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
    event.currentTarget.reset();
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
  try {
    const input = validateMilk({
      animalId: $("#milk-animal").value,
      session: $("#milk-session").value,
      liters: $("#milk-liters").value,
      localDate: $("#milk-date").value || toLocalDateString()
    });

    await FarmRepository.saveMilkRecord(input);
    event.currentTarget.reset();
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
  try {
    const input = validateWeight({
      animalId: $("#weight-animal").value,
      kilograms: $("#weight-kg").value,
      localDate: $("#weight-date").value || toLocalDateString()
    });

    await FarmRepository.saveWeightRecord(input);
    event.currentTarget.reset();
    $("#weight-date").value = toLocalDateString();
    setStatus("Weight saved locally: " + input.kilograms + " kg.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleBreedingSubmit(event) {
  event.preventDefault();
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

    event.currentTarget.reset();
    setStatus("Breeding saved locally. Expected calving: " + expectedCalving + ".", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function handleHealthSubmit(event) {
  event.preventDefault();
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

    event.currentTarget.reset();
    $("#health-date").value = toLocalDateString();
    setStatus("Health record saved locally.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function refreshAll() {
  await refreshAnimalData();
  await refreshDashboard();
}

export async function initApp() {
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

  await refreshAll();

  startSyncLoop(async () => {
    await refreshDashboard();
    if (navigator.onLine && APP_CONFIG.cloud.enabled) setStatus("Cloud sync attempted.", "info");
  });

  setStatus("Ready. Records save on this device first.", "success");
}
