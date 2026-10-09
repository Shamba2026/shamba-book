import { APP_CONFIG } from "./config.js";
import { animalTypeLabel, calculateExpectedCalving, calculateMilkValue, getMilkWeekPeriod, toLocalDateString } from "./domain/farm-rules.js";
import { filterFinanceEntries, formatFinanceMoney, summarizeFinanceEntries } from "./domain/finance.js?build=20260927-01";
import { validateAnimal, validateMilk, validateWeight, validateFinance } from "./domain/validation.js?build=20261009-01";
import * as FarmRepository from "./storage/farm-repository.js?build=20261009-01";
import { unitCostPerKg } from "./domain/feed/feed-inventory.js?build=20260928-01";
import { buildReadOnlyRation } from "./domain/feed/ration-contract.js?build=20261005-02";
import { evaluateRation } from "./domain/feed/ration-diagnostics.js?build=20261005-03";
import { classifyComparisonReviewHistory, compareRequirementToRationEvidence, latestComparisonReviewForEvidence } from "./domain/feed/requirement-ration-comparison.js?build=20261007-08";
import { assessComparisonEvidenceCurrency } from "./domain/feed/comparison-evidence-currency.js?build=20261007-06";
import { buildNutritionEvidenceStatus } from "./domain/feed/nutrition-evidence-status.js?build=20261007-10";
import { getAuthClient } from "./auth.js";
import { verifyFarmAccess } from "./farm-access.js?build=20260927-02";
import { inspectRecoveryBackup } from "./storage/recovery-preflight.js?build=20260927-02";
import { claimLegacyAnimal } from "./storage/legacy-claim.js?build=20260927-02";
import { startSyncLoop } from "./sync/sync-engine.js?build=20260927-02";

const $ = (selector) => document.querySelector(selector);
let signedIn = false;
let accessGeneration = 0;
let selectedDiagnosticProfile = null;
let selectedAnimalId = null;
let activeUserId = null;
let comparisonRequirementCalculations = [];
let comparisonRationReviews = [];
let currentComparisonEvidence = null;
let comparisonReviewHistory = [];
let allocationRationReviews = [];

function clearFarmView() {
  feedRefreshGeneration += 1;
  ["#animal-form", "#milk-form", "#weight-form", "#breeding-form", "#health-form", "#finance-form",
    "#feed-form", "#feed-source-form", "#feed-observation-form", "#feed-cost-source-form", "#feed-batch-form",
    "#feed-movement-form", "#feed-selection-form", "#ration-review-form", "#diagnostic-profile-form",
    "#diagnostic-selection-form", "#diagnostic-archive-form", "#animal-nutrition-classification-form",
    "#animal-nutrition-review-form", "#requirement-profile-form", "#requirement-approval-form",
    "#requirement-revocation-form", "#requirement-applicability-form", "#requirement-calculation-form",
    "#requirement-ration-comparison-form", "#requirement-ration-review-form", "#ration-allocation-form"].forEach((selector) => {
    $(selector).reset();
  });
  $("#milk-value-preview").textContent = "—";
  $("#milk-checklist").replaceChildren();
  $("#milk-checklist-summary").textContent = "";
  $("#animal-list").replaceChildren();
  $("#animals-empty").hidden = false;
  const herdNutrition = $("#herd-nutrition-readiness");
  if (herdNutrition) herdNutrition.replaceChildren();
  $("#animal-profile").hidden = true;
  selectedAnimalId = null;
  $("#classification-list").replaceChildren();
  $("#classification-count").textContent = "0 observations";
  $("#classification-empty").hidden = false;
  const nutritionStatus = $("#nutrition-evidence-status");
  if (nutritionStatus) nutritionStatus.replaceChildren();
  $("#classification-review-list").replaceChildren();
  $("#classification-review-count").textContent = "0 reviews";
  $("#classification-review-empty").hidden = false;
  $("#animal-nutrition-review-form").hidden = true;
  $("#classification-review-version").replaceChildren();
  $("#classification-review-profile").replaceChildren();
  $("#requirement-applicability-list").replaceChildren();
  $("#requirement-applicability-count").textContent = "0 reviews";
  $("#requirement-applicability-empty").hidden = false;
  $("#requirement-applicability-form").hidden = true;
  $("#requirement-calculation-list").replaceChildren();
  $("#requirement-calculation-count").textContent = "0 calculations";
  $("#requirement-calculation-empty").hidden = false;
  $("#requirement-calculation-form").hidden = true;
  $("#requirement-ration-comparison-form").hidden = true;
  $("#requirement-ration-comparison-empty").hidden = true;
  $("#requirement-ration-comparison-result").replaceChildren();
  $("#requirement-ration-review-form").hidden = true;
  $("#requirement-ration-review-list").replaceChildren();
  $("#requirement-ration-review-count").textContent = "0 reviews";
  $("#requirement-ration-review-empty").hidden = false;
  const currentSummary = $("#requirement-ration-review-current-summary");
  if (currentSummary) currentSummary.textContent = "";
  comparisonRequirementCalculations = [];
  comparisonRationReviews = [];
  currentComparisonEvidence = null;
  comparisonReviewHistory = [];
  const supersessionNotice = $("#requirement-ration-review-supersedes");
  if (supersessionNotice) { supersessionNotice.textContent = ""; supersessionNotice.hidden = true; }
  allocationRationReviews = [];
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
  ["#feed-list", "#feed-source-list", "#feed-profile", "#feed-conflicts", "#feed-cost-source-list", "#feed-inventory-list",
    "#feed-movement-list", "#feed-current-selections", "#ration-review-rows", "#ration-review-result",
    "#diagnostic-profile-list", "#diagnostic-current-selection", "#diagnostic-history-list",
    "#requirement-profile-list", "#requirement-review-list", "#ration-allocation-rows",
    "#ration-allocation-list"].forEach((selector) => $(selector).replaceChildren());
  selectedDiagnosticProfile = null;
  $("#diagnostic-profile-count").textContent = "0 profiles";
  $("#diagnostic-profile-empty").hidden = false;
  $("#diagnostic-selection-form").hidden = true;
  $("#diagnostic-archive-form").hidden = true;
  $("#diagnostic-history-count").textContent = "0 reviews";
  $("#diagnostic-history-empty").hidden = false;
  $("#requirement-profile-count").textContent = "0 profiles";
  $("#requirement-profile-empty").hidden = false;
  $("#requirement-review-count").textContent = "0 reviews";
  $("#requirement-approval-form").hidden = true;
  $("#requirement-revocation-form").hidden = true;
  ["#feed-observation-feed", "#feed-observation-source", "#feed-batch-feed", "#feed-batch-cost-source",
    "#feed-movement-batch", "#feed-selection-observation", "#diagnostic-selection-profile",
    "#diagnostic-selection-animals", "#diagnostic-archive-profile", "#diagnostic-supersedes",
    "#requirement-approval-profile", "#requirement-revocation-profile", "#requirement-applicability-profile",
    "#requirement-applicability-classification", "#requirement-calculation-profile", "#requirement-ration-calculation",
    "#requirement-ration-review"].forEach((selector) => $(selector).replaceChildren());
  $("#feed-count").textContent = "0 feeds";
  $("#feed-source-count").textContent = "0 sources";
  $("#feed-cost-source-count").textContent = "0 sources";
  $("#feed-inventory-count").textContent = "0 batches";
  $("#feed-movement-count").textContent = "0 movements";
  $("#feed-empty").hidden = false;
  $("#feed-source-empty").hidden = false;
  $("#feed-cost-source-empty").hidden = false;
  $("#feed-inventory-empty").hidden = false;
  $("#feed-movement-empty").hidden = false;
  $("#feed-selection-form").hidden = true;
  $("#ration-review-empty").hidden = false;
  $("#ration-review-calculate").disabled = true;
  $("#ration-allocation-form").hidden = true;
  $("#ration-allocation-review").replaceChildren();
  $("#ration-allocation-count").textContent = "0 reviews";
  $("#ration-allocation-empty").hidden = false;
  $("#feed-profile-empty").hidden = false;
  $("#feed-profile-empty").textContent = "Choose a feed from the farm library to review its observations.";
  $("#feed-profile-title").textContent = "Select a feed";
  $("#feed-cost-date").value = toLocalDateString();
  $("#feed-batch-date").value = toLocalDateString();
  $("#feed-movement-date").value = toLocalDateString();
  $("#feed-batch-currency").value = "KES";
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
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  el.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  el.setAttribute("aria-atomic", "true");
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
let rationReviewRows = [];
let feedRefreshGeneration = 0;

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

function renderInventoryOptions(feeds, costSources) {
  $("#feed-batch-feed").replaceChildren(new Option("Choose feed", ""),
    ...feeds.map((feed) => new Option(feed.name, feed.id)));
  $("#feed-batch-cost-source").replaceChildren(new Option("Choose cost source", ""),
    ...costSources.map((source) => new Option(source.reference, source.id)));
}

function renderMovementOptions(batches) {
  $("#feed-movement-batch").replaceChildren(new Option("Choose inventory batch", ""), ...batches.map((batch) =>
    new Option((batch.feed?.name || "Feed unavailable") + " · " + batch.remainingQuantityKg + " kg remaining", batch.id)));
}

function formatBatchMoney(cents, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function renderRationReview(batches, selectionsByFeed) {
  rationReviewRows = batches.map((batch) => ({ batch, feed: batch.feed, selections: selectionsByFeed.get(batch.feedId) || {} }));
  $("#ration-review-rows").innerHTML = rationReviewRows.map((row) => {
    const missing = ["DM", "ME", "CP"].filter((code) => !row.selections[code]?.observation);
    return '<label class="ration-row"><span><strong>' + escapeHtml(row.feed?.name || "Feed unavailable") + '</strong><small>' +
      escapeHtml(row.batch.remainingQuantityKg + " kg available" + (missing.length ? " · Missing selected " + missing.join(", ") : " · Evidence ready")) +
      '</small></span><input type="number" min="0" max="' + escapeHtml(row.batch.remainingQuantityKg) +
      '" step="0.001" value="0" data-ration-batch-id="' + escapeHtml(row.batch.id) + '" aria-label="As-fed kg for ' +
      escapeHtml(row.feed?.name || "feed") + '" ' + (missing.length ? "disabled" : "") + '></label>';
  }).join("");
  const ready = rationReviewRows.some((row) => ["DM", "ME", "CP"].every((code) => row.selections[code]?.observation));
  $("#ration-review-empty").hidden = ready;
  $("#ration-review-calculate").disabled = !ready;
  $("#ration-review-result").replaceChildren();
}

async function handleRationReview(event) {
  event.preventDefault();
  const generation = accessGeneration;
  try {
    const quantities = new Map([...document.querySelectorAll("[data-ration-batch-id]")]
      .map((input) => [input.dataset.rationBatchId, Number(input.value || 0)]));
    const rows = rationReviewRows.map((row) => ({ ...row,
      asFedKg: quantities.get(row.batch.id) || 0 }))
      .filter((row) => row.asFedKg > 0);
    const ration = buildReadOnlyRation(rows);
    const forageShare = ration.forageDMKg / ration.totalDMIKg * 100;
    const diagnostic = selectedDiagnosticProfile ? evaluateRation(ration, selectedDiagnosticProfile.profile) : null;
    if (diagnostic) await FarmRepository.recordDiagnosticWarningReview(ration, diagnostic, {
      rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: $("#ration-daily-basis").checked
    });
    if (!canShowFarmData(generation)) return;
    const messages = { LOW_FORAGE_DM_SHARE: "Below the selected profile’s minimum forage dry-matter share.",
      LOW_ME_DENSITY: "Below the selected profile’s minimum ME density.",
      LOW_CP_PERCENT_DM: "Below the selected profile’s minimum crude-protein concentration.",
      NO_CONFIGURED_THRESHOLD_TRIGGERED: "No selected-profile threshold was triggered. This is not proof that the ration meets the animal’s requirements." };
    const diagnosticHtml = diagnostic ? '<div class="feed-list">' + diagnostic.map((finding) => '<div class="evidence-row"><strong>' +
      escapeHtml(messages[finding.code]) + '</strong></div>').join("") + '</div><p class="muted">Applied ' +
      escapeHtml(selectedDiagnosticProfile.profile.name + " v" + selectedDiagnosticProfile.profile.version + " · " +
        selectedDiagnosticProfile.profile.animalClass.replaceAll("_", " ")) + '.</p>' :
      '<p class="muted">No diagnostic profile selected; no nutritional warnings were applied.</p>';
    $("#ration-review-result").innerHTML = '<div class="ration-metrics"><div><small>As fed</small><strong>' +
      escapeHtml(ration.totalAsFedKg.toFixed(3)) + ' kg</strong></div><div><small>Dry matter</small><strong>' +
      escapeHtml(ration.totalDMIKg.toFixed(3)) + ' kg</strong></div><div><small>ME density</small><strong>' +
      escapeHtml(ration.meDensityMJPerKgDM.toFixed(2)) + ' MJ/kg DM</strong></div><div><small>Crude protein</small><strong>' +
      escapeHtml(ration.cpPercentDM.toFixed(2)) + '% DM</strong></div><div><small>Forage DM share</small><strong>' +
      escapeHtml(forageShare.toFixed(1)) + '%</strong></div><div><small>Estimated cost</small><strong>' +
      escapeHtml(formatBatchMoney(ration.totalCostCents, ration.currencyCode)) + '</strong></div></div>' + diagnosticHtml + '<p class="muted">Calculation only. No ration save or inventory movement was created.</p>';
    if (diagnostic) renderDiagnosticHistory(await FarmRepository.listDiagnosticWarningHistory());
    setStatus("Read-only ration calculation completed.", "success");
  } catch (error) { setStatus(error.message || String(error), "error"); $("#ration-review-result").replaceChildren(); }
}

function renderDiagnosticHistory(history) {
  $("#diagnostic-history-count").textContent = history.length + (history.length === 1 ? " review" : " reviews");
  $("#diagnostic-history-empty").hidden = history.length > 0;
  $("#diagnostic-history-list").innerHTML = history.map((row) => '<div class="evidence-row"><strong>' +
    escapeHtml(row.profileName + " v" + row.profileVersion) + '</strong><small>' + escapeHtml(row.calculatedAt) +
    ' · ' + escapeHtml(row.animalClass.replaceAll("_", " ")) + '</small><small>Group: ' +
    escapeHtml(row.animalGroup.map((animal) => animal.animalCode).join(", ")) + '</small><small>Findings: ' +
    escapeHtml(row.findingCodes.join(", ")) + '</small><small>Citation: ' + escapeHtml(row.sourceCitation) + '</small></div>').join("");
}

function renderAllocationInputs() {
  const review = allocationRationReviews.find((row) => row.id === $("#ration-allocation-review").value);
  if (!review) { $("#ration-allocation-rows").replaceChildren(); return; }
  $("#ration-allocation-rows").innerHTML = review.animalGroup.map((animal) => '<div class="evidence-row"><strong>' +
    escapeHtml(animal.animalCode || animal.id) + '</strong>' + review.ration.ingredients.map((ingredient) =>
      '<label class="field"><span>' + escapeHtml(ingredient.feedName) + ' (kg as fed)</span><input type="number" min="0" step="0.001" required data-allocation-animal="' +
      escapeHtml(animal.id) + '" data-allocation-feed="' + escapeHtml(ingredient.feedId) + '"></label>').join("") + '</div>').join("");
}

function renderRationAllocationEvidence(history, reviews) {
  allocationRationReviews = history.filter((row) => row.animalGroup?.length > 1 && row.ration?.ingredients?.length);
  $("#ration-allocation-form").hidden = allocationRationReviews.length === 0;
  $("#ration-allocation-review").replaceChildren(new Option("Choose group ration review", ""), ...allocationRationReviews.map((row) =>
    new Option(row.calculatedAt + " · " + row.animalGroup.map((animal) => animal.animalCode || animal.id).join(", "), row.id)));
  $("#ration-allocation-rows").replaceChildren();
  $("#ration-allocation-count").textContent = reviews.length + (reviews.length === 1 ? " review" : " reviews");
  $("#ration-allocation-empty").hidden = allocationRationReviews.length > 0 || reviews.length > 0;
  $("#ration-allocation-list").innerHTML = reviews.map((review) => '<div class="evidence-row"><strong>' +
    escapeHtml(review.allocationMethod.replaceAll("_", " ")) + '</strong><small>' + escapeHtml(review.reviewedAt) +
    ' · ' + escapeHtml(review.allocations.length + " animals") + '</small><small>' + escapeHtml(review.rationale) +
    '</small><small>' + escapeHtml(review.allocations.map((row) => row.animalId + ": " + row.ration.totalAsFedKg + " kg as fed").join(" · ")) + '</small></div>').join("");
}

async function handleRationAllocationSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    const rationReviewId = $("#ration-allocation-review").value;
    const review = allocationRationReviews.find((row) => row.id === rationReviewId);
    if (!review) throw new Error("Choose a compatible group ration review.");
    const allocations = review.animalGroup.map((animal) => ({ animalId: animal.id,
      ingredients: review.ration.ingredients.map((ingredient) => ({ feedId: ingredient.feedId,
        asFedKg: Number(document.querySelector('[data-allocation-animal="' + CSS.escape(animal.id) + '"][data-allocation-feed="' + CSS.escape(ingredient.feedId) + '"]').value) })) }));
    await FarmRepository.recordRationAllocationEvidence(rationReviewId, { allocationMethod: "DOCUMENTED_INGREDIENT_WEIGHTS",
      rationale: $("#ration-allocation-rationale").value, reviewerUserId: activeUserId,
      reviewerConfirmed: $("#ration-allocation-confirmed").checked, allocations });
    if (!canShowFarmData(generation)) return;
    form.reset(); $("#ration-allocation-rows").replaceChildren(); await refreshFeedWorkspace(generation);
    if (canShowFarmData(generation)) setStatus("Per-animal ration allocation evidence recorded.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

function renderDiagnosticProfiles(profiles, selected, animals, history) {
  selectedDiagnosticProfile = selected;
  $("#diagnostic-profile-count").textContent = profiles.length + (profiles.length === 1 ? " profile" : " profiles");
  $("#diagnostic-profile-empty").hidden = profiles.length > 0;
  $("#diagnostic-profile-list").innerHTML = profiles.map((profile) => '<div class="evidence-row"><strong>' +
    escapeHtml(profile.name + " v" + profile.version) + '</strong><small>' + escapeHtml(profile.animalClass.replaceAll("_", " ")) +
    '</small><small>Status: ' + escapeHtml(profile.status) + (profile.supersedesProfileId ? " · superseding version" : "") +
    '</small><small>' + escapeHtml(profile.applicability) + '</small><small>' + escapeHtml(profile.sourceTitle + " — " + profile.sourceCitation) +
    '</small><small>Thresholds: forage ' + escapeHtml(profile.minimumForageDMFraction) + ', ME ' +
    escapeHtml(profile.minimumMEDensityMJPerKgDM) + ', CP ' + escapeHtml(profile.minimumCPPercentDM) + '%</small></div>').join("");
  const activeProfiles = profiles.filter((profile) => profile.status !== "archived");
  $("#diagnostic-selection-form").hidden = activeProfiles.length === 0 || animals.length === 0;
  $("#diagnostic-archive-form").hidden = activeProfiles.length === 0;
  $("#diagnostic-selection-profile").replaceChildren(new Option("Choose a profile", ""), ...activeProfiles.map((profile) =>
    new Option(profile.name + " v" + profile.version + " · " + profile.animalClass.replaceAll("_", " "), profile.id)));
  $("#diagnostic-selection-animals").replaceChildren(...animals.map((animal) => new Option(animal.animalCode + " · " + animal.type.replaceAll("_", " "), animal.id)));
  $("#diagnostic-archive-profile").replaceChildren(new Option("Choose a profile", ""), ...activeProfiles.map((profile) =>
    new Option(profile.name + " v" + profile.version, profile.id)));
  $("#diagnostic-supersedes").replaceChildren(new Option("New profile", ""), ...activeProfiles.map((profile) =>
    new Option(profile.name + " v" + profile.version, profile.id)));
  $("#diagnostic-current-selection").innerHTML = selected ? '<div class="evidence-row selection-current"><strong>Active for warnings: ' +
    escapeHtml(selected.profile.name + " v" + selected.profile.version) + '</strong><small>' + escapeHtml(selected.profile.animalClass.replaceAll("_", " ")) +
    '</small><small>' + escapeHtml(selected.profile.applicability) + '</small><small>Rationale: ' + escapeHtml(selected.selection.rationale) + '</small></div>' :
    '<p class="muted">No profile approved for a confirmed animal group. Nutritional warnings are inactive.</p>';
  renderDiagnosticHistory(history);
}

const requirementUnits = { DMI_KG_DAY: "kg DM/day", ME_MJ_DAY: "MJ ME/day", NEL_MCAL_DAY: "Mcal NEL/day",
  CP_KG_DAY: "kg CP/day", MP_G_DAY: "g MP/day" };

function renderRequirementProfiles(profiles, reviews) {
  $("#requirement-profile-count").textContent = profiles.length + (profiles.length === 1 ? " profile" : " profiles");
  $("#requirement-profile-empty").hidden = profiles.length > 0;
  $("#requirement-profile-list").innerHTML = profiles.map((profile) => '<div class="evidence-row"><strong>' +
    escapeHtml(profile.name + " v" + profile.version) + '</strong><small>' + escapeHtml(labelEnum(profile.animalClass)) +
    ' · ' + escapeHtml(profile.nutrientSystem) + ' · status: ' + escapeHtml(profile.status) + '</small><small>' +
    escapeHtml(profile.sourceTitle + " — " + profile.sourceCitation) + '</small><small>' + escapeHtml(profile.applicability) +
    '</small><small>Equations: ' + escapeHtml(profile.equations.map((row) => row.outputCode + " · " + row.equationReference).join("; ")) +
    '</small></div>').join("");
  const drafts = profiles.filter((row) => row.status === "draft"); const approved = profiles.filter((row) => row.status === "approved");
  $("#requirement-approval-form").hidden = drafts.length === 0; $("#requirement-revocation-form").hidden = approved.length === 0;
  $("#requirement-approval-profile").replaceChildren(new Option("Choose a draft", ""), ...drafts.map((row) => new Option(row.name + " v" + row.version, row.id)));
  $("#requirement-revocation-profile").replaceChildren(new Option("Choose an approved profile", ""), ...approved.map((row) => new Option(row.name + " v" + row.version, row.id)));
  $("#requirement-review-count").textContent = reviews.length + (reviews.length === 1 ? " review" : " reviews");
  $("#requirement-review-list").innerHTML = reviews.map((row) => '<div class="evidence-row"><strong>' +
    escapeHtml(row.decision + " · v" + row.profileVersion) + '</strong><small>' + escapeHtml(row.rationale) +
    '</small><small>' + escapeHtml(row.reviewedAt) + ' · immutable audit event</small></div>').join("");
}

function requirementTermsFromForm() {
  const terms = []; const constant = $("#requirement-constant").value; const weight = $("#requirement-weight-coefficient").value;
  const milk = $("#requirement-milk-coefficient").value;
  if (constant !== "") terms.push({ factor: "CONSTANT", coefficient: constant, exponent: 0 });
  if (weight !== "") terms.push({ factor: "LIVE_WEIGHT_KG", coefficient: weight, exponent: $("#requirement-weight-exponent").value });
  if (milk !== "") terms.push({ factor: "AVERAGE_DAILY_MILK_LITERS", coefficient: milk, exponent: $("#requirement-milk-exponent").value });
  return terms;
}

async function handleRequirementProfileSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget; const outputCode = $("#requirement-output").value;
  try { await FarmRepository.createNutritionRequirementProfile({ name: $("#requirement-name").value,
      version: $("#requirement-version").value, animalClass: $("#requirement-animal-class").value,
      nutrientSystem: $("#requirement-system").value, publicationYear: $("#requirement-year").value,
      applicability: $("#requirement-applicability").value, sourceTitle: $("#requirement-source-title").value,
      sourceCitation: $("#requirement-citation").value, sourceUrl: $("#requirement-url").value,
      supersessionRationale: $("#requirement-supersession-rationale").value,
      equations: [{ outputCode, outputUnit: requirementUnits[outputCode], equationReference: $("#requirement-equation-reference").value,
        terms: requirementTermsFromForm() }] });
    if (!canShowFarmData(generation)) return; form.reset(); $("#requirement-weight-exponent").value = "1"; $("#requirement-milk-exponent").value = "1";
    await refreshFeedWorkspace(generation); setStatus("Requirement profile saved as an inactive draft.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleRequirementApprovalSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try { await FarmRepository.approveNutritionRequirementProfile($("#requirement-approval-profile").value,
      { reviewerUserId: activeUserId, rationale: $("#requirement-approval-rationale").value,
        reviewerConfirmed: $("#requirement-approval-confirmed").checked });
    if (!canShowFarmData(generation)) return; form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Requirement profile approved. No recommendation was generated.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleRequirementRevocationSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try { await FarmRepository.revokeNutritionRequirementProfile($("#requirement-revocation-profile").value,
      { reviewerUserId: activeUserId, rationale: $("#requirement-revocation-rationale").value,
        reviewerConfirmed: $("#requirement-revocation-confirmed").checked });
    if (!canShowFarmData(generation)) return; form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Requirement profile revoked; audit history retained.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleDiagnosticProfileSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    const input = { name: $("#diagnostic-name").value, version: $("#diagnostic-version").value,
      animalClass: $("#diagnostic-animal-class").value, applicability: $("#diagnostic-applicability").value,
      sourceTitle: $("#diagnostic-source-title").value, sourceCitation: $("#diagnostic-citation").value,
      sourceUrl: $("#diagnostic-url").value, publicationYear: $("#diagnostic-year").value,
      minimumForageDMFraction: $("#diagnostic-forage").value, supersessionReason: $("#diagnostic-supersession-reason").value,
      minimumMEDensityMJPerKgDM: $("#diagnostic-me").value, minimumCPPercentDM: $("#diagnostic-cp").value };
    const previousId = $("#diagnostic-supersedes").value;
    if (previousId) await FarmRepository.supersedeDiagnosticProfile(previousId, input);
    else await FarmRepository.createDiagnosticProfile(input);
    if (!canShowFarmData(generation)) return; form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Diagnostic profile saved inactive.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleDiagnosticSelectionSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.selectDiagnosticProfile($("#diagnostic-selection-profile").value,
      { rationale: $("#diagnostic-selection-rationale").value,
        animalIds: [...$("#diagnostic-selection-animals").selectedOptions].map((option) => option.value),
        applicabilityConfirmed: $("#diagnostic-applicability-confirmed").checked });
    if (!canShowFarmData(generation)) return; form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Diagnostic profile selected explicitly.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleDiagnosticArchiveSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.archiveDiagnosticProfile($("#diagnostic-archive-profile").value, $("#diagnostic-archive-reason").value);
    if (!canShowFarmData(generation)) return; form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Diagnostic profile archived; its historical reviews were retained.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
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
  const [profile, selections] = await Promise.all([FarmRepository.getNutritionProfile(feedId),
    FarmRepository.getNutritionSelections(feedId)]);
  if (!canShowFarmData(generation) || selectedFeedId !== feedId || !profile || !selections) return;
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
  const observations = groups.flatMap(([code, rows]) => rows.map((row) => ({ ...row, code })));
  $("#feed-selection-form").hidden = observations.length === 0;
  $("#feed-selection-observation").replaceChildren(new Option("Choose an observation", ""), ...observations.map((row) =>
    new Option((nutrientLabels[row.code] || row.code) + " · " + row.value + " " + row.unit.replaceAll("_", " ") + " · " + row.source.title, row.id)));
  $("#feed-current-selections").innerHTML = Object.entries(selections).map(([code, selection]) =>
    '<div class="evidence-row selection-current"><strong>Selected ' + escapeHtml(nutrientLabels[code] || code) + '</strong><small>' +
    escapeHtml(selection.observation ? selection.observation.value + " " + selection.observation.unit.replaceAll("_", " ") : "Observation unavailable") +
    '</small><small>' + escapeHtml(selection.source?.citation || "Source unavailable") + '</small><small>Rationale: ' +
    escapeHtml(selection.rationale) + '</small></div>').join("");
}

async function refreshFeedWorkspace(generation = accessGeneration) {
  const refreshGeneration = ++feedRefreshGeneration;
  if (!canShowFarmData(generation)) return;
  const [feeds, sources, costSources, batches, diagnosticProfiles, diagnosticSelection, diagnosticHistory, allocationHistory, animals,
    requirementProfiles, requirementReviews] = await Promise.all([FarmRepository.listFeeds(),
    FarmRepository.listNutritionSources(), FarmRepository.listFeedCostSources(), FarmRepository.listFeedInventoryBatches(),
    FarmRepository.listDiagnosticProfiles({ includeArchived: true }), FarmRepository.getSelectedDiagnosticProfile(),
    FarmRepository.listDiagnosticWarningHistory(), FarmRepository.listRationAllocationEvidence(), FarmRepository.listAnimals(),
    FarmRepository.listNutritionRequirementProfiles({ includeDrafts: true }), FarmRepository.listNutritionRequirementProfileReviews()]);
  if (!canShowFarmData(generation) || refreshGeneration !== feedRefreshGeneration) return;
  const selectionRows = await Promise.all(feeds.map(async (feed) => [feed.id, await FarmRepository.getNutritionSelections(feed.id)]));
  if (!canShowFarmData(generation) || refreshGeneration !== feedRefreshGeneration) return;
  const selectionsByFeed = new Map(selectionRows);
  $("#feed-count").textContent = feeds.length + (feeds.length === 1 ? " feed" : " feeds");
  $("#feed-source-count").textContent = sources.length + (sources.length === 1 ? " source" : " sources");
  $("#feed-cost-source-count").textContent = costSources.length + (costSources.length === 1 ? " source" : " sources");
  $("#feed-inventory-count").textContent = batches.length + (batches.length === 1 ? " batch" : " batches");
  const movements = batches.flatMap((batch) => batch.movements.map((movement) => ({ ...movement, batch })));
  $("#feed-movement-count").textContent = movements.length + (movements.length === 1 ? " movement" : " movements");
  $("#feed-empty").hidden = feeds.length > 0;
  $("#feed-source-empty").hidden = sources.length > 0;
  $("#feed-cost-source-empty").hidden = costSources.length > 0;
  $("#feed-inventory-empty").hidden = batches.length > 0;
  $("#feed-movement-empty").hidden = movements.length > 0;
  $("#feed-list").innerHTML = feeds.map((feed) => '<button type="button" class="feed-row" data-feed-id="' +
    escapeHtml(feed.id) + '"><span><strong>' + escapeHtml(feed.name) + '</strong><small>' +
    escapeHtml(feedRoleLabels[feed.role] || feed.role) + '</small></span><span aria-hidden="true">Review →</span></button>').join("");
  $("#feed-source-list").innerHTML = sources.map((source) => '<div class="evidence-row"><strong>' +
    escapeHtml(source.title) + '</strong><small>' + escapeHtml(source.sourceType.replaceAll("_", " ")) +
    (source.publicationYear ? " · " + source.publicationYear : "") + '</small><small>' +
    escapeHtml(source.citation) + '</small></div>').join("");
  $("#feed-cost-source-list").innerHTML = costSources.map((source) => '<div class="evidence-row"><strong>' +
    escapeHtml(source.reference) + '</strong><small>' + escapeHtml(source.sourceType.replaceAll("_", " ") + " · " + source.documentDate) +
    '</small>' + (source.counterparty ? '<small>' + escapeHtml(source.counterparty) + '</small>' : '') + '</div>').join("");
  $("#feed-inventory-list").innerHTML = batches.map((batch) => {
    const unitCost = unitCostPerKg(batch);
    return '<div class="evidence-row"><strong>' + escapeHtml(batch.feed?.name || "Feed unavailable") + '</strong><small>' +
      escapeHtml(batch.remainingQuantityKg + " kg remaining of " + batch.receivedQuantityKg + " kg received · " + batch.receivedAt) + '</small><small>' +
      escapeHtml(formatBatchMoney(batch.totalCostCents, batch.currencyCode) + (unitCost === null ? "" : " · " +
        formatBatchMoney(Math.round(unitCost), batch.currencyCode) + "/kg")) + '</small><small>Cost source: ' +
      escapeHtml(batch.costSource?.reference || "Source unavailable") + '</small></div>';
  }).join("");
  $("#feed-movement-list").innerHTML = movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((movement) =>
    '<div class="evidence-row"><strong>' + escapeHtml(movement.batch.feed?.name || "Feed unavailable") + '</strong><small>' +
    escapeHtml(movement.movementType.replaceAll("_", " ") + " · " + movement.inputQuantity + " " + movement.inputUnit.replaceAll("_AS_FED", "").replaceAll("_", " ") + " · " + movement.movementDate) +
    '</small><small>' + escapeHtml(movement.reason) + '</small></div>').join("");
  renderFeedOptions(feeds, sources);
  renderInventoryOptions(feeds, costSources);
  renderMovementOptions(batches);
  renderRationReview(batches, selectionsByFeed);
  renderDiagnosticProfiles(diagnosticProfiles, diagnosticSelection,
    animals.filter((animal) => ["active", "dry"].includes(animal.status)), diagnosticHistory);
  renderRationAllocationEvidence(diagnosticHistory, allocationHistory);
  renderRequirementProfiles(requirementProfiles, requirementReviews);
  if (!feeds.some((feed) => feed.id === selectedFeedId)) selectedFeedId = feeds[0]?.id || null;
  if (selectedFeedId) $("#feed-observation-feed").value = selectedFeedId;
  await renderNutritionProfile(selectedFeedId, generation);
}

async function handleFeedCostSourceSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.createFeedCostSource({ sourceType: $("#feed-cost-type").value,
      reference: $("#feed-cost-reference").value, counterparty: $("#feed-cost-counterparty").value,
      documentDate: $("#feed-cost-date").value, notes: $("#feed-cost-notes").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); $("#feed-cost-date").value = toLocalDateString(); await refreshFeedWorkspace(generation);
    setStatus("Feed cost source saved for review.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleFeedBatchSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.createFeedInventoryBatch($("#feed-batch-feed").value, {
      costSourceId: $("#feed-batch-cost-source").value, receivedAt: $("#feed-batch-date").value,
      receivedQuantityKg: $("#feed-batch-quantity").value, totalCost: $("#feed-batch-total-cost").value,
      currencyCode: $("#feed-batch-currency").value, lotReference: $("#feed-batch-lot").value,
      storageLocation: $("#feed-batch-location").value, notes: $("#feed-batch-notes").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); $("#feed-batch-date").value = toLocalDateString(); $("#feed-batch-currency").value = "KES";
    await refreshFeedWorkspace(generation); setStatus("Feed inventory batch saved for review.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleFeedMovementSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.recordFeedInventoryMovement($("#feed-movement-batch").value, {
      movementType: $("#feed-movement-type").value, movementDate: $("#feed-movement-date").value,
      quantity: $("#feed-movement-quantity").value, unit: $("#feed-movement-unit").value,
      reason: $("#feed-movement-reason").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); $("#feed-movement-date").value = toLocalDateString();
    await refreshFeedWorkspace(generation); setStatus("Feed inventory movement saved.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleFeedSelectionSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  try {
    await FarmRepository.selectNutritionObservation(selectedFeedId, { observationId: $("#feed-selection-observation").value,
      rationale: $("#feed-selection-rationale").value });
    if (!canShowFarmData(generation)) return;
    form.reset(); await refreshFeedWorkspace(generation);
    setStatus("Nutrition evidence selection recorded for review.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
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
    const active = button.dataset.nav === viewName;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
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

function renderHerdNutritionReadiness(summary) {
  const labels = { CLASSIFICATION: "classification", CLASSIFICATION_REVIEW: "classification review",
    REQUIREMENT_CALCULATION: "requirement calculation", RATION_EVIDENCE: "ration evidence",
    COMPARISON_REVIEW: "comparison review" };
  $("#herd-nutrition-readiness").innerHTML = '<div class="section-head"><h3>Nutrition evidence readiness</h3><span class="chip">Read only</span></div>' +
    '<p><strong>' + escapeHtml(summary.completeAnimals + " of " + summary.totalAnimals) +
    '</strong> eligible animals have a complete current evidence chain.</p>' +
    (summary.animals.length ? '<div class="nutrition-review-filters session-tabs" role="group" aria-label="Nutrition review queue filter">' +
      '<button type="button" class="active" data-nutrition-filter="all" aria-pressed="true">All (' + escapeHtml(summary.totalAnimals) + ')</button>' +
      '<button type="button" data-nutrition-filter="attention" aria-pressed="false">Attention (' + escapeHtml(summary.attentionAnimals) + ')</button>' +
      '<button type="button" data-nutrition-filter="complete" aria-pressed="false">Complete (' + escapeHtml(summary.completeAnimals) + ')</button></div>' +
      '<div class="feed-list nutrition-review-queue">' + summary.animals.map((row) => '<button type="button" class="evidence-row nutrition-review-row" ' +
      'data-nutrition-animal-id="' + escapeHtml(row.animalId) + '" data-nutrition-status="' +
      (row.evidenceComplete ? "complete" : "attention") + '"><strong>' +
      escapeHtml(row.animalCode + " · " + (row.evidenceComplete ? "EVIDENCE COMPLETE" : "ATTENTION")) + '</strong><span>' +
      escapeHtml(row.evidenceComplete ? "All controlled evidence stages are current." : "Outstanding: " + row.outstanding.map((item) =>
        labels[item.code] + " (" + labelEnum(item.state) + ")").join("; ")) +
      '</span><small>Open animal evidence</small></button>').join("") + '</div>' : '<p class="muted">No active or dry animals require nutrition evidence review.</p>') +
    '<p class="muted">Workflow evidence only; this is not a biological adequacy judgment or ration recommendation.</p>';
}

function labelEnum(value) {
  return String(value || "").toLocaleLowerCase().replaceAll("_", " ");
}

function renderAnimalNutritionClassifications(rows) {
  $("#classification-count").textContent = rows.length + (rows.length === 1 ? " observation" : " observations");
  $("#classification-empty").hidden = rows.length > 0;
  $("#classification-list").innerHTML = rows.map((row) => '<div class="evidence-row"><strong>Version ' +
    escapeHtml(row.version) + " · " + escapeHtml(row.liveWeightKg) + " kg</strong><span>" +
    escapeHtml(labelEnum(row.physiologicalStage)) + " · " + escapeHtml(labelEnum(row.lactationStatus)) +
    (row.lactationStatus === "LACTATING" ? " / " + escapeHtml(labelEnum(row.lactationStage)) : "") +
    " · " + escapeHtml(labelEnum(row.productionContext)) + "</span><span>Observed " + escapeHtml(row.observedAt) +
    " · " + escapeHtml(labelEnum(row.weightMethod)) + "</span><span>Evidence: " + escapeHtml(row.sourceTitle) +
    " — " + escapeHtml(row.sourceCitation) + "</span><span>Basis: " + escapeHtml(row.applicabilityNotes) +
    '</span><small>Evidence observation only; no automated applicability or recommendation.</small></div>').join("");
}

function renderNutritionEvidenceStatus(input) {
  const labels = { CLASSIFICATION: "Classification", CLASSIFICATION_REVIEW: "Classification review",
    REQUIREMENT_CALCULATION: "Requirement calculation", RATION_EVIDENCE: "Ration evidence",
    COMPARISON_REVIEW: "Comparison review" };
  const result = buildNutritionEvidenceStatus(input);
  $("#nutrition-evidence-status").innerHTML = '<div class="section-head"><h3>Nutrition evidence status</h3><span class="chip">Read only</span></div>' +
    '<p class="muted">Evidence completeness only. This does not approve a ration, recommend feed or consume inventory.</p><div class="feed-list">' +
    result.stages.map((row) => '<div class="evidence-row"><strong>' + escapeHtml(labels[row.code] + " · " + labelEnum(row.state)) +
      '</strong><span>' + escapeHtml(row.detail) + '</span>' + (row.evidenceId ? '<small>Evidence ID: ' + escapeHtml(row.evidenceId) + '</small>' : '') +
      '</div>').join("") + '</div>';
}

function renderAnimalNutritionReviews(classifications, reviews, profiles) {
  $("#animal-nutrition-review-form").hidden = classifications.length === 0;
  $("#classification-review-version").replaceChildren(...classifications.map((row) =>
    new Option("Version " + row.version + " · " + row.observedAt + " · " + row.liveWeightKg + " kg", row.id)));
  $("#classification-review-profile").replaceChildren(new Option("Not assessed against a profile", ""),
    ...profiles.filter((row) => row.status !== "archived").map((row) => new Option(row.name + " v" + row.version + " · " + labelEnum(row.animalClass), row.id)));
  $("#classification-review-count").textContent = reviews.length + (reviews.length === 1 ? " review" : " reviews");
  $("#classification-review-empty").hidden = reviews.length > 0;
  $("#classification-review-list").innerHTML = reviews.map((row) => '<div class="evidence-row"><strong>Classification v' +
    escapeHtml(row.classificationVersion) + " · " + escapeHtml(labelEnum(row.evidenceDecision)) + '</strong><span>Applicability: ' +
    escapeHtml(labelEnum(row.applicabilityDecision)) + (row.profileName ? " · " + escapeHtml(row.profileName) + " v" + escapeHtml(row.profileVersion) : "") +
    "</span><span>Rationale: " + escapeHtml(row.rationale) + "</span><small>Reviewed " + escapeHtml(row.reviewedAt) +
    ' · immutable audit event · no profile activation</small></div>').join("");
}

function renderRequirementApplicability(classifications, profiles, reviews) {
  const latest = classifications[0]; const approved = profiles.filter((row) => row.status === "approved");
  $("#requirement-applicability-form").hidden = !latest || approved.length === 0;
  $("#requirement-applicability-profile").replaceChildren(new Option("Choose an approved profile", ""),
    ...approved.map((row) => new Option(row.name + " v" + row.version + " · " + labelEnum(row.animalClass), row.id)));
  $("#requirement-applicability-classification").replaceChildren(...(latest ?
    [new Option("Version " + latest.version + " · " + latest.observedAt + " · " + latest.liveWeightKg + " kg", latest.id)] : []));
  $("#requirement-applicability-count").textContent = reviews.length + (reviews.length === 1 ? " review" : " reviews");
  $("#requirement-applicability-empty").hidden = reviews.length > 0;
  $("#requirement-applicability-list").innerHTML = reviews.map((row) => '<div class="evidence-row"><strong>' +
    escapeHtml(row.profileName + " v" + row.profileVersion + " · " + labelEnum(row.decision)) + '</strong><span>Classification v' +
    escapeHtml(row.classificationVersion) + ' · ' + escapeHtml(row.rationale) + '</span><small>' + escapeHtml(row.reviewedAt) +
    ' · immutable applicability decision · no recommendation</small></div>').join("");
}

function renderRequirementCalculations(classifications, profiles, applicabilityReviews, calculations) {
  const latest = classifications[0];
  const latestDecisionByProfile = new Map();
  applicabilityReviews.forEach((row) => {
    if (!latestDecisionByProfile.has(row.profileId)) latestDecisionByProfile.set(row.profileId, row);
  });
  const eligible = profiles.filter((profile) => profile.status === "approved" && latest &&
    latestDecisionByProfile.get(profile.id)?.classificationId === latest.id &&
    latestDecisionByProfile.get(profile.id)?.decision === "APPLICABLE");
  $("#requirement-calculation-form").hidden = eligible.length === 0;
  $("#requirement-calculation-profile").replaceChildren(new Option("Choose an applicable profile", ""),
    ...eligible.map((row) => new Option(row.name + " v" + row.version + " · " + labelEnum(row.animalClass), row.id)));
  $("#requirement-calculation-count").textContent = calculations.length +
    (calculations.length === 1 ? " calculation" : " calculations");
  $("#requirement-calculation-empty").hidden = calculations.length > 0;
  $("#requirement-calculation-list").innerHTML = calculations.map((row) => '<div class="evidence-row"><strong>' +
    escapeHtml(row.sourceTitle + " · profile v" + row.profileVersion) + '</strong><span>' +
    row.outputs.map((output) => escapeHtml(output.outputCode + ": " + output.value + " " + output.outputUnit)).join(" · ") +
    '</span><span>Inputs: ' + escapeHtml("live weight " + row.inputs.LIVE_WEIGHT_KG + " kg" +
      (row.inputs.AVERAGE_DAILY_MILK_LITERS == null ? "" : " · milk " + row.inputs.AVERAGE_DAILY_MILK_LITERS + " L/day")) +
    '</span><span>Source: ' + escapeHtml(row.sourceCitation) + '</span><small>' + escapeHtml(row.calculatedAt) +
    ' · immutable calculation · no ration recommendation or inventory movement</small></div>').join("");
}

function renderRequirementRationComparisonOptions(animalId, calculations, rationReviews, allocationReviews,
  requirementProfiles, classifications, selectedDiagnostic) {
  const latestClassification = classifications[0] || null;
  const currentCalculations = calculations.filter((requirement) => {
    const requirementProfile = requirementProfiles.find((profile) => profile.id === requirement.profileId);
    return rationReviews.some((rationReview) => assessComparisonEvidenceCurrency({ requirement, rationReview,
      requirementProfile, latestClassification, selectedDiagnostic }).eligible);
  });
  comparisonRequirementCalculations = currentCalculations;
  const daily = rationReviews.filter((row) => row.rationBasis === "DAILY_OFFERED_RATION" && row.rationBasisConfirmed === true &&
    row.animalGroup?.some((animal) => animal.id === animalId) && selectedDiagnostic?.profile?.id === row.profileId &&
    selectedDiagnostic?.profile?.version === row.profileVersion && selectedDiagnostic?.selection?.id === row.selectionId);
  comparisonRationReviews = daily.flatMap((rationReview) => {
    if (rationReview.animalGroup.length === 1) return [{ key: rationReview.id, rationReview, allocationReview: null }];
    return allocationReviews.filter((review) => review.rationReviewId === rationReview.id &&
      review.allocations?.some((allocation) => allocation.animalId === animalId)).map((allocationReview) =>
      ({ key: rationReview.id + "::" + allocationReview.id, rationReview, allocationReview }));
  });
  $("#requirement-ration-comparison-form").hidden = !currentCalculations.length || !comparisonRationReviews.length;
  $("#requirement-ration-comparison-empty").hidden = !currentCalculations.length || comparisonRationReviews.length > 0;
  $("#requirement-ration-calculation").replaceChildren(new Option("Choose calculation", ""), ...currentCalculations.map((row) =>
    new Option(row.sourceTitle + " · " + row.calculatedAt, row.id)));
  $("#requirement-ration-review").replaceChildren(new Option("Choose ration evidence", ""), ...comparisonRationReviews.map((row) =>
    new Option(row.rationReview.profileName + " v" + row.rationReview.profileVersion + " · " + row.rationReview.calculatedAt +
      (row.allocationReview ? " · documented individual allocation" : " · single animal"), row.key)));
  $("#requirement-ration-comparison-result").replaceChildren();
  $("#requirement-ration-review-form").hidden = true;
  currentComparisonEvidence = null;
}

function handleRequirementRationComparison(event) {
  event.preventDefault();
  try {
    const requirement = comparisonRequirementCalculations.find((row) => row.id === $("#requirement-ration-calculation").value);
    const rationEvidence = comparisonRationReviews.find((row) => row.key === $("#requirement-ration-review").value);
    const report = compareRequirementToRationEvidence(requirement, rationEvidence?.rationReview, selectedAnimalId,
      rationEvidence?.allocationReview);
    currentComparisonEvidence = { requirementCalculationId: requirement.id, rationReviewId: rationEvidence.rationReview.id,
      allocationReviewId: rationEvidence.allocationReview?.id || null };
    const latestReview = latestComparisonReviewForEvidence(comparisonReviewHistory, currentComparisonEvidence);
    currentComparisonEvidence.supersedesReviewId = latestReview?.id || null;
    const supersessionNotice = $("#requirement-ration-review-supersedes");
    if (supersessionNotice) {
      supersessionNotice.hidden = !latestReview;
      supersessionNotice.textContent = latestReview ? "This new immutable decision will explicitly supersede the latest review of this exact retained evidence (" + latestReview.id + "). The earlier review remains in history." : "";
    }
    const labels = { BELOW_DOCUMENTED_REQUIREMENT: "Below documented requirement", ABOVE_DOCUMENTED_REQUIREMENT: "Above documented requirement",
      MATCHES_DOCUMENTED_REQUIREMENT: "Matches documented requirement" };
    const rows = report.comparisons.map((row) => '<div class="evidence-row"><strong>' + escapeHtml(row.outputCode + " · " + labels[row.status]) +
      '</strong><span>Requirement: ' + escapeHtml(row.requiredValue + " " + row.outputUnit) + ' · ration evidence: ' +
      escapeHtml(row.suppliedValue + " " + row.outputUnit) + ' · gap: ' + escapeHtml(row.gap + " " + row.outputUnit) +
      '</span><small>Derivation: ' + escapeHtml(row.derivation) + '</small></div>').join("");
    const omitted = report.uncompared.length ? '<p class="muted">Not compared: ' + escapeHtml(report.uncompared.map((row) => row.outputCode).join(", ")) +
      ' — no directly compatible retained ration evidence.</p>' : "";
    $("#requirement-ration-comparison-result").innerHTML = '<div class="feed-list">' + rows + '</div>' + omitted +
      '<p class="muted">Attribution: requirement calculation ' + escapeHtml(report.attribution.requirementCalculationId) +
      ' · ration review ' + escapeHtml(report.attribution.rationReviewId) +
      (report.attribution.allocation ? ' · allocation review ' + escapeHtml(report.attribution.allocation.allocationReviewId) : '') +
      '. Arithmetic comparison only; no adequacy judgment or feed recommendation.</p>';
    $("#requirement-ration-review-form").hidden = false;
    setStatus("Read-only requirement and ration evidence comparison completed.", "success");
  } catch (error) {
    currentComparisonEvidence = null; $("#requirement-ration-review-form").hidden = true;
    const supersessionNotice = $("#requirement-ration-review-supersedes");
    if (supersessionNotice) { supersessionNotice.textContent = ""; supersessionNotice.hidden = true; }
    $("#requirement-ration-comparison-result").replaceChildren(); setStatus(error.message || String(error), "error");
  }
}

function renderRequirementRationReviews(reviews) {
  comparisonReviewHistory = reviews;
  const classified = classifyComparisonReviewHistory(reviews);
  const current = classified.filter((row) => row.isCurrent);
  $("#requirement-ration-review-count").textContent = reviews.length + (reviews.length === 1 ? " review" : " reviews");
  $("#requirement-ration-review-empty").hidden = reviews.length > 0;
  $("#requirement-ration-review-current-summary").textContent = current.length +
    (current.length === 1 ? " current decision across retained evidence." : " current decisions across retained evidence.");
  $("#requirement-ration-review-list").innerHTML = classified.map((row) => '<div class="evidence-row"><strong>' +
    escapeHtml(labelEnum(row.decision)) + ' · ' + (row.isCurrent ? 'CURRENT' : 'SUPERSEDED') + '</strong><span>' +
    escapeHtml(row.rationale) + '</span><small>Requirement calculation ' +
    escapeHtml(row.requirementCalculationId) + ' · ration review ' + escapeHtml(row.rationReviewId) +
    (row.supersedesReviewId ? ' · supersedes ' + escapeHtml(row.supersedesReviewId) : '') +
    (row.supersededByReviewId ? ' · superseded by ' + escapeHtml(row.supersededByReviewId) : '') + '</small><small>' +
    escapeHtml(row.reviewedAt) + ' · immutable human review · no ration approval</small></div>').join("");
}

async function handleRequirementRationReviewSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const animalId = selectedAnimalId; const form = event.currentTarget;
  if (!animalId || !activeUserId || !currentComparisonEvidence) return setStatus("Run and review an evidence comparison first.", "error");
  try {
    await FarmRepository.reviewRequirementRationComparison(currentComparisonEvidence.requirementCalculationId,
      currentComparisonEvidence.rationReviewId, { decision: $("#requirement-ration-review-decision").value,
        allocationReviewId: currentComparisonEvidence.allocationReviewId,
        supersedesReviewId: currentComparisonEvidence.supersedesReviewId,
        rationale: $("#requirement-ration-review-rationale").value, reviewerUserId: activeUserId,
        reviewerConfirmed: $("#requirement-ration-review-confirmed").checked });
    if (!canShowFarmData(generation) || selectedAnimalId !== animalId) return;
    form.reset(); await openAnimal(animalId);
    setStatus("Immutable comparison review recorded. No ration or inventory was changed.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
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
  selectedAnimalId = animalId;
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
  const [classifications, reviews, profiles, requirementProfiles, applicabilityReviews, requirementCalculations, rationReviews,
    allocationReviews, comparisonReviews, currentDiagnostic] = await Promise.all([
    FarmRepository.listAnimalNutritionClassifications(animalId), FarmRepository.listAnimalNutritionClassificationReviews(animalId),
    FarmRepository.listDiagnosticProfiles({ includeArchived: false }), FarmRepository.listNutritionRequirementProfiles({ includeDrafts: true }),
    FarmRepository.listNutritionRequirementApplicabilityReviews(animalId), FarmRepository.listNutritionRequirementCalculations(animalId),
    FarmRepository.listDiagnosticWarningHistory(), FarmRepository.listRationAllocationEvidence(),
    FarmRepository.listRequirementRationComparisonReviews(animalId), FarmRepository.getSelectedDiagnosticProfile()]);
  if (!canShowFarmData(generation) || selectedAnimalId !== animalId) return;
  renderAnimalNutritionClassifications(classifications);
  renderAnimalNutritionReviews(classifications, reviews, profiles);
  renderRequirementApplicability(classifications, requirementProfiles, applicabilityReviews);
  renderRequirementCalculations(classifications, requirementProfiles, applicabilityReviews, requirementCalculations);
  renderRequirementRationComparisonOptions(animalId, requirementCalculations, rationReviews, allocationReviews,
    requirementProfiles, classifications, currentDiagnostic);
  renderRequirementRationReviews(comparisonReviews);
  renderNutritionEvidenceStatus({ animalId, classifications, classificationReviews: reviews,
    requirementProfiles, requirementCalculations, rationReviews, allocationReviews, comparisonReviews, selectedDiagnostic: currentDiagnostic });
}

async function handleAnimalNutritionClassificationSubmit(event) {
  event.preventDefault();
  const generation = accessGeneration; const form = event.currentTarget;
  if (!selectedAnimalId) return setStatus("Choose an animal before recording classification evidence.", "error");
  const animalId = selectedAnimalId;
  try {
    await FarmRepository.createAnimalNutritionClassification(animalId, {
      observedAt: $("#classification-date").value, liveWeightKg: $("#classification-weight").value,
      weightMethod: $("#classification-weight-method").value, physiologicalStage: $("#classification-physiology").value,
      lactationStatus: $("#classification-lactation-status").value, lactationStage: $("#classification-lactation-stage").value,
      productionContext: $("#classification-production-context").value, averageDailyMilkLiters: $("#classification-milk").value,
      productionWindowDays: $("#classification-window").value, evidenceType: $("#classification-evidence-type").value,
      sourceTitle: $("#classification-source-title").value, sourceCitation: $("#classification-citation").value,
      sourceUrl: $("#classification-source-url").value, applicabilityNotes: $("#classification-notes").value,
      revisionReason: $("#classification-revision-reason").value
    });
    if (!canShowFarmData(generation) || selectedAnimalId !== animalId) return;
    form.reset(); $("#classification-date").value = toLocalDateString();
    await openAnimal(animalId);
    setStatus("Classification evidence saved. No recommendation was activated.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleAnimalNutritionReviewSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget;
  if (!selectedAnimalId || !activeUserId) return setStatus("Authenticated animal review is unavailable.", "error");
  try {
    await FarmRepository.reviewAnimalNutritionClassification($("#classification-review-version").value, {
      evidenceDecision: $("#classification-review-evidence").value, profileId: $("#classification-review-profile").value,
      applicabilityDecision: $("#classification-review-applicability").value,
      rationale: $("#classification-review-rationale").value, reviewerConfirmed: $("#classification-review-confirmed").checked,
      reviewerUserId: activeUserId
    });
    if (!canShowFarmData(generation)) return;
    form.reset(); await openAnimal(selectedAnimalId);
    setStatus("Classification review recorded. No diagnostic profile was activated.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleRequirementApplicabilitySubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget; const animalId = selectedAnimalId;
  if (!animalId || !activeUserId) return setStatus("Authenticated applicability review is unavailable.", "error");
  try { await FarmRepository.reviewNutritionRequirementApplicability($("#requirement-applicability-profile").value,
      $("#requirement-applicability-classification").value, { decision: $("#requirement-applicability-decision").value,
        rationale: $("#requirement-applicability-rationale").value, reviewerUserId: activeUserId,
        reviewerConfirmed: $("#requirement-applicability-confirmed").checked });
    if (!canShowFarmData(generation) || selectedAnimalId !== animalId) return; form.reset(); await openAnimal(animalId);
    setStatus("Requirement applicability decision recorded. No recommendation was generated.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
}

async function handleRequirementCalculationSubmit(event) {
  event.preventDefault(); const generation = accessGeneration; const form = event.currentTarget; const animalId = selectedAnimalId;
  if (!animalId || !activeUserId) return setStatus("Authenticated requirement calculation is unavailable.", "error");
  try { await FarmRepository.calculateAnimalNutritionRequirements($("#requirement-calculation-profile").value, animalId,
      { confirmed: $("#requirement-calculation-confirmed").checked, initiatedByUserId: activeUserId });
    if (!canShowFarmData(generation) || selectedAnimalId !== animalId) return; form.reset(); await openAnimal(animalId);
    setStatus("Documented requirement calculation recorded. No ration was recommended and no inventory was consumed.", "success");
  } catch (error) { if (canShowFarmData(generation)) setStatus(error.message || String(error), "error"); }
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
  const [animals, nutritionReadiness] = await Promise.all([
    FarmRepository.listAnimals(), FarmRepository.getHerdNutritionEvidenceReadiness()
  ]);
  if (!canShowFarmData(generation)) return;
  populateAnimalSelectors(animals);
  refreshAnimalList(animals);
  renderHerdNutritionReadiness(nutritionReadiness);
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
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton.disabled) return;
  const generation = accessGeneration;
  submitButton.disabled = true;

  try {
    const input = validateMilk({
      animalId: $("#milk-animal").value,
      session: $("#milk-session").value,
      liters: $("#milk-liters").value,
      localDate: $("#milk-date").value || toLocalDateString(),
      allowAdditionalCollection: $("#milk-additional").checked
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
  } finally {
    submitButton.disabled = false;
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
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  statusEl.setAttribute("aria-atomic", "true");

  let clientPromise = null;
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
  if (!$("#requirement-ration-review-supersedes")) {
    const notice = document.createElement("p");
    notice.id = "requirement-ration-review-supersedes";
    notice.className = "muted";
    notice.hidden = true;
    $("#requirement-ration-review-form").prepend(notice);
  }
  if (!$("#requirement-ration-review-current-summary")) {
    const summary = document.createElement("p");
    summary.id = "requirement-ration-review-current-summary";
    summary.className = "muted";
    $("#requirement-ration-review-list").before(summary);
  }
  if (!$("#nutrition-evidence-status")) {
    const status = document.createElement("section");
    status.id = "nutrition-evidence-status";
    status.className = "card";
    $("#classification-list").before(status);
  }
  if (!$("#herd-nutrition-readiness")) {
    const readiness = document.createElement("section");
    readiness.id = "herd-nutrition-readiness";
    readiness.className = "evidence-review";
    $("#animal-list").before(readiness);
  }
  showView("home");
  $("#milk-date").value = toLocalDateString();
  $("#weight-date").value = toLocalDateString();
  $("#health-date").value = toLocalDateString();
  $("#finance-date").value = toLocalDateString();
  $("#feed-cost-date").value = toLocalDateString();
  $("#feed-batch-date").value = toLocalDateString();
  $("#feed-movement-date").value = toLocalDateString();
  $("#classification-date").value = toLocalDateString();
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
  $("#feed-cost-source-form").addEventListener("submit", handleFeedCostSourceSubmit);
  $("#feed-batch-form").addEventListener("submit", handleFeedBatchSubmit);
  $("#feed-movement-form").addEventListener("submit", handleFeedMovementSubmit);
  $("#feed-selection-form").addEventListener("submit", handleFeedSelectionSubmit);
  $("#ration-review-form").addEventListener("submit", handleRationReview);
  $("#ration-allocation-form").addEventListener("submit", handleRationAllocationSubmit);
  $("#ration-allocation-review").addEventListener("change", renderAllocationInputs);
  $("#diagnostic-profile-form").addEventListener("submit", handleDiagnosticProfileSubmit);
  $("#diagnostic-selection-form").addEventListener("submit", handleDiagnosticSelectionSubmit);
  $("#diagnostic-archive-form").addEventListener("submit", handleDiagnosticArchiveSubmit);
  $("#requirement-profile-form").addEventListener("submit", handleRequirementProfileSubmit);
  $("#requirement-approval-form").addEventListener("submit", handleRequirementApprovalSubmit);
  $("#requirement-revocation-form").addEventListener("submit", handleRequirementRevocationSubmit);
  $("#animal-nutrition-classification-form").addEventListener("submit", handleAnimalNutritionClassificationSubmit);
  $("#animal-nutrition-review-form").addEventListener("submit", handleAnimalNutritionReviewSubmit);
  $("#requirement-applicability-form").addEventListener("submit", handleRequirementApplicabilitySubmit);
  $("#requirement-calculation-form").addEventListener("submit", handleRequirementCalculationSubmit);
  $("#requirement-ration-comparison-form").addEventListener("submit", handleRequirementRationComparison);
  $("#requirement-ration-review-form").addEventListener("submit", handleRequirementRationReviewSubmit);
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
  $("#herd-nutrition-readiness").addEventListener("click", (event) => {
    const filterButton = event.target.closest("[data-nutrition-filter]");
    if (filterButton) {
      const filter = filterButton.dataset.nutritionFilter;
      $("#herd-nutrition-readiness").querySelectorAll("[data-nutrition-filter]").forEach((button) => {
        const active = button === filterButton;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      $("#herd-nutrition-readiness").querySelectorAll("[data-nutrition-status]").forEach((row) => {
        row.hidden = filter !== "all" && row.dataset.nutritionStatus !== filter;
      });
      return;
    }
    const row = event.target.closest("[data-nutrition-animal-id]");
    if (row) openAnimal(row.dataset.nutritionAnimalId);
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
