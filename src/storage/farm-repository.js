import { appendInventoryMovementAtomically, get, getAll, putAtomically, putMany } from "./local-db.js?build=20261005-04";
import { buildNutritionProfile, validateNutritionObservation, validateNutritionSource } from "../domain/feed/nutrition-profile.js?build=20260928-04";
import { validateCostSource, validateInventoryBatch, validateInventoryMovement } from "../domain/feed/feed-inventory.js?build=20260928-04";
import { currentNutritionSelections, validateNutritionSelection } from "../domain/feed/nutrition-selection.js?build=20260928-04";
import { currentDiagnosticProfileSelection, validateDiagnosticProfile,
  validateDiagnosticProfileSelection } from "../domain/feed/diagnostic-profile.js?build=20261005-03";
import { validateAnimalNutritionClassification } from "../domain/animal-nutrition-classification.js?build=20261006-01";

let activeFarmId = null;

export function setActiveFarm(farmId) {
  activeFarmId = farmId || null;
}

function requireFarm() {
  if (!activeFarmId) throw new Error("Verify farm membership before accessing local records.");
  return activeFarmId;
}

function farmRows(rows) {
  const farmId = requireFarm();
  return rows.filter((row) => row.farmId === farmId);
}

async function requireAnimal(animalId) {
  const farmId = requireFarm();
  const animal = await get("animals", animalId);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  if (!animal || animal.farmId !== farmId) throw new Error("Animal is not in the active farm.");
  return farmId;
}

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

const FEED_ROLES = new Set(["forage", "concentrate", "mineral", "other"]);

function feedName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) throw new Error("Feed name must be between 1 and 120 characters.");
  return name;
}

function feedRole(value) {
  if (!FEED_ROLES.has(value)) throw new Error("Select a valid feed role.");
  return value;
}

function feedNameKey(farmId, name) {
  return farmId + ":" + name.toLocaleLowerCase();
}

async function assertUniqueFeedName(farmId, name, existingId = null) {
  const duplicate = (await getAll("feed_library")).find((feed) =>
    feed.farmId === farmId && feed.status !== "archived" && feed.id !== existingId &&
    feed.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  if (duplicate) throw new Error('Feed "' + name + '" is already in this farm library.');
}

function queuedRecord(record) {
  return {
    id: record.id,
    farmId: record.farmId,
    recordType: record.kind || "animal",
    recordId: record.id,
    status: "pending",
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    payload: structuredClone(record)
  };
}

async function assertUniqueAnimalCode(animalCode, existingId = null) {
  const animals = farmRows(await getAll("animals"));
  const duplicate = animals.find(
    (animal) =>
      animal.animalCode.toLocaleLowerCase() === animalCode.toLocaleLowerCase() &&
      animal.id !== existingId
  );
  if (duplicate) {
    throw new Error('Animal name/ID "' + animalCode + '" is already registered on this device.');
  }
}

export async function saveAnimal(animal, photoBlob) {
  const farmId = requireFarm();
  if (animal.id) {
    const existing = await get("animals", animal.id);
    if (existing && existing.farmId !== farmId) throw new Error("Animal is not in the active farm.");
  }
  await assertUniqueAnimalCode(animal.animalCode, animal.id || null);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");

  const animalRecord = {
    ...animal,
    farmId,
    id: animal.id || newId(),
    clientId: animal.clientId || newId(),
    kind: "animal",
    createdAt: animal.createdAt || now(),
    updatedAt: now(),
    photoAttachmentId: animal.photoAttachmentId || newId()
  };

  const attachment = {
    id: animalRecord.photoAttachmentId,
    farmId,
    ownerId: animalRecord.id,
    kind: "animal_profile_photo",
    filename: String(animalRecord.animalCode).replace(/[^a-z0-9_-]/gi, "_") + ".jpg",
    mimeType: photoBlob.type || "image/jpeg",
    createdAt: now(),
    blob: photoBlob
  };

  await putAtomically([
    { storeName: "animals", value: animalRecord },
    { storeName: "attachments", value: attachment },
    { storeName: "sync_queue", value: queuedRecord(animalRecord) }
  ]);
  return animalRecord;
}

export async function listAnimals() {
  const animals = farmRows(await getAll("animals"));
  return animals.sort((a, b) => a.animalCode.localeCompare(b.animalCode));
}

export async function getAnimal(animalId) {
  const animal = await get("animals", animalId);
  if (!animal || animal.farmId !== requireFarm()) return null;
  const attachment = await get("attachments", animal.photoAttachmentId);
  return { animal, photo: attachment?.farmId === requireFarm() ? attachment.blob : null };
}

export async function createAnimalNutritionClassification(animalId, input) {
  const farmId = requireFarm();
  const animal = await get("animals", animalId);
  if (!animal || animal.farmId !== farmId || !["active", "dry"].includes(animal.status)) {
    throw new Error("Nutritional classification requires an active animal in this farm.");
  }
  const validated = validateAnimalNutritionClassification(input);
  const existing = farmRows(await getAll("animal_nutrition_classifications"))
    .filter((row) => row.animalId === animalId).sort((a, b) => b.version - a.version);
  const version = existing.length ? existing[0].version + 1 : 1;
  const revisionReason = String(input?.revisionReason || "").trim();
  if (version > 1 && (!revisionReason || revisionReason.length > 500)) {
    throw new Error("A revision reason is required for a new classification version.");
  }
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const row = { id: newId(), farmId, animalId, animalCode: animal.animalCode, version,
    supersedesClassificationId: existing[0]?.id || null, revisionReason: version > 1 ? revisionReason : null,
    ...validated, createdAt: now() };
  await putAtomically([{ storeName: "animal_nutrition_classifications", value: row }]);
  return row;
}

export async function listAnimalNutritionClassifications(animalId) {
  const farmId = requireFarm();
  const animal = await get("animals", animalId);
  if (!animal || animal.farmId !== farmId) return [];
  return farmRows(await getAll("animal_nutrition_classifications"))
    .filter((row) => row.animalId === animalId)
    .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
}

export async function saveMilkRecord(input) {
  const farmId = await requireAnimal(input.animalId);
  const record = {
    id: newId(),
    clientId: newId(),
    kind: "milk",
    farmId,
    animalId: input.animalId,
    localDate: input.localDate,
    session: input.session,
    liters: Number(input.liters),
    createdAt: now(),
    updatedAt: now()
  };
  await putAtomically([
    { storeName: "records", value: record },
    { storeName: "sync_queue", value: queuedRecord(record) }
  ]);
  return record;
}

export async function saveWeightRecord(input) {
  const farmId = await requireAnimal(input.animalId);
  const record = {
    id: newId(),
    clientId: newId(),
    kind: "weight",
    farmId,
    animalId: input.animalId,
    localDate: input.localDate,
    kilograms: Number(input.kilograms),
    createdAt: now(),
    updatedAt: now()
  };
  await putAtomically([
    { storeName: "records", value: record },
    { storeName: "sync_queue", value: queuedRecord(record) }
  ]);
  return record;
}

export async function saveGenericRecord(kind, payload) {
  const farmId = payload.animalId ? await requireAnimal(payload.animalId) : requireFarm();
  const record = {
    id: newId(),
    clientId: newId(),
    kind,
    ...payload,
    farmId,
    createdAt: now(),
    updatedAt: now()
  };
  await putAtomically([
    { storeName: "records", value: record },
    { storeName: "sync_queue", value: queuedRecord(record) }
  ]);
  return record;
}

export async function listFinanceEntries() {
  return farmRows(await getAll("records"))
    .filter((row) => row.kind === "finance" && ["income", "expense"].includes(row.direction) &&
      Number.isSafeInteger(row.amountCents) && row.amountCents > 0)
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || b.createdAt.localeCompare(a.createdAt));
}

// This storage-only feed registry deliberately contains no nutrient reference
// values. Nutrition evidence and TMR linkage are separate controlled units.
export async function createFeed(input) {
  const farmId = requireFarm();
  const name = feedName(input?.name);
  const role = feedRole(input?.role);
  await assertUniqueFeedName(farmId, name);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const feed = {
    id: newId(), farmId, name, role, status: "active",
    farmNameKey: feedNameKey(farmId, name), createdAt: timestamp, updatedAt: timestamp
  };
  await putAtomically([{ storeName: "feed_library", value: feed }]);
  return feed;
}

export async function listFeeds({ includeArchived = false } = {}) {
  return farmRows(await getAll("feed_library"))
    .filter((feed) => includeArchived || feed.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFeed(feedId, { includeArchived = false } = {}) {
  const feed = await get("feed_library", feedId);
  if (!feed || feed.farmId !== requireFarm() || (!includeArchived && feed.status === "archived")) return null;
  return feed;
}

export async function updateFeed(feedId, input) {
  const farmId = requireFarm();
  const existing = await get("feed_library", feedId);
  if (!existing || existing.farmId !== farmId || existing.status === "archived") {
    throw new Error("Feed is not in the active farm library.");
  }
  const name = feedName(input?.name ?? existing.name);
  const role = feedRole(input?.role ?? existing.role);
  await assertUniqueFeedName(farmId, name, feedId);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const feed = { ...existing, name, role, farmNameKey: feedNameKey(farmId, name), updatedAt: now() };
  await putAtomically([{ storeName: "feed_library", value: feed }]);
  return feed;
}

export async function deleteFeed(feedId) {
  const farmId = requireFarm();
  const existing = await get("feed_library", feedId);
  if (!existing || existing.farmId !== farmId || existing.status === "archived") {
    throw new Error("Feed is not in the active farm library.");
  }
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const feed = { ...existing, status: "archived", archivedAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_library", value: feed }]);
  return feed;
}

export async function createNutritionSource(input) {
  const farmId = requireFarm();
  const validated = validateNutritionSource(input);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const source = { id: newId(), farmId, ...validated, status: "active", createdAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_sources", value: source }]);
  return source;
}

export async function listNutritionSources({ includeArchived = false } = {}) {
  return farmRows(await getAll("feed_sources"))
    .filter((source) => includeArchived || source.status !== "archived")
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function archiveNutritionSource(sourceId) {
  const farmId = requireFarm();
  const source = await get("feed_sources", sourceId);
  if (!source || source.farmId !== farmId || source.status === "archived") {
    throw new Error("Nutrition source is not active in this farm.");
  }
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const archived = { ...source, status: "archived", archivedAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_sources", value: archived }]);
  return archived;
}

export async function createNutritionObservation(feedId, input) {
  const farmId = requireFarm();
  const [feed, source] = await Promise.all([get("feed_library", feedId), get("feed_sources", input?.sourceId)]);
  if (!feed || feed.farmId !== farmId || feed.status === "archived") throw new Error("Feed is not active in this farm library.");
  if (!source || source.farmId !== farmId || source.status === "archived") throw new Error("Nutrition source is not active in this farm.");
  const validated = validateNutritionObservation(input);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const observation = { id: newId(), farmId, feedId, ...validated, status: "active",
    createdAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_observations", value: observation }]);
  return observation;
}

export async function archiveNutritionObservation(observationId) {
  const farmId = requireFarm();
  const observation = await get("feed_observations", observationId);
  if (!observation || observation.farmId !== farmId || observation.status === "archived") {
    throw new Error("Nutrition observation is not active in this farm.");
  }
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const archived = { ...observation, status: "archived", archivedAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_observations", value: archived }]);
  return archived;
}

export async function getNutritionProfile(feedId, { includeArchived = false } = {}) {
  const farmId = requireFarm();
  const feed = await get("feed_library", feedId);
  if (!feed || feed.farmId !== farmId || feed.status === "archived") return null;
  const [observations, sources] = await Promise.all([getAll("feed_observations"), getAll("feed_sources")]);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during read.");
  return buildNutritionProfile(feed,
    observations.filter((row) => row.farmId === farmId && row.feedId === feedId && (includeArchived || row.status !== "archived")),
    sources.filter((row) => row.farmId === farmId));
}

export async function createFeedCostSource(input) {
  const farmId = requireFarm();
  const validated = validateCostSource(input);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const source = { id: newId(), farmId, ...validated, status: "active", createdAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_cost_sources", value: source }]);
  return source;
}

export async function listFeedCostSources({ includeArchived = false } = {}) {
  return farmRows(await getAll("feed_cost_sources"))
    .filter((source) => includeArchived || source.status !== "archived")
    .sort((a, b) => b.documentDate.localeCompare(a.documentDate) || a.reference.localeCompare(b.reference));
}

export async function createFeedInventoryBatch(feedId, input) {
  const farmId = requireFarm();
  const [feed, source] = await Promise.all([get("feed_library", feedId), get("feed_cost_sources", input?.costSourceId)]);
  if (!feed || feed.farmId !== farmId || feed.status === "archived") throw new Error("Feed is not active in this farm library.");
  if (!source || source.farmId !== farmId || source.status === "archived") throw new Error("Cost source is not active in this farm.");
  const validated = validateInventoryBatch(input);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const batch = { id: newId(), farmId, feedId, ...validated, status: "active", createdAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_inventory_batches", value: batch }]);
  return batch;
}

export async function listFeedInventoryBatches({ feedId = null, includeArchived = false } = {}) {
  const farmId = requireFarm();
  const [batches, feeds, sources, movements] = await Promise.all([
    getAll("feed_inventory_batches"), getAll("feed_library"), getAll("feed_cost_sources"), getAll("feed_inventory_movements")
  ]);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during read.");
  const feedById = new Map(feeds.filter((row) => row.farmId === farmId).map((row) => [row.id, row]));
  const sourceById = new Map(sources.filter((row) => row.farmId === farmId).map((row) => [row.id, row]));
  return batches.filter((row) => row.farmId === farmId && (!feedId || row.feedId === feedId) &&
      (includeArchived || row.status !== "archived"))
    .map((row) => { const batchMovements = movements.filter((movement) => movement.farmId === farmId && movement.batchId === row.id);
      const remainingQuantityKg = Math.max(0, Math.round((row.receivedQuantityKg +
        batchMovements.reduce((sum, movement) => sum + movement.deltaQuantityKg, 0)) * 1000000) / 1000000);
      return { ...row, remainingQuantityKg, movements: batchMovements,
        feed: feedById.get(row.feedId) || null, costSource: sourceById.get(row.costSourceId) || null }; })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.createdAt.localeCompare(a.createdAt));
}

export async function recordFeedInventoryMovement(batchId, input) {
  const farmId = requireFarm();
  const validated = validateInventoryMovement(input);
  const timestamp = now();
  const movement = { id: newId(), farmId, batchId, ...validated, createdAt: timestamp };
  await appendInventoryMovementAtomically({ farmId, batchId, movement, assertCurrent: () => {
    if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  } });
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  return movement;
}

export async function selectNutritionObservation(feedId, input) {
  const farmId = requireFarm();
  const validated = validateNutritionSelection(input);
  const [feed, observation] = await Promise.all([get("feed_library", feedId), get("feed_observations", validated.observationId)]);
  if (!feed || feed.farmId !== farmId || feed.status === "archived") throw new Error("Feed is not active in this farm library.");
  if (!observation || observation.farmId !== farmId || observation.feedId !== feedId || observation.status === "archived") {
    throw new Error("Nutrition observation is not active for this farm feed.");
  }
  const source = await get("feed_sources", observation.sourceId);
  if (!source || source.farmId !== farmId || source.status === "archived") throw new Error("Nutrition source is not active in this farm.");
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const selection = { id: newId(), farmId, feedId, nutrientCode: observation.nutrientCode,
    observationId: observation.id, rationale: validated.rationale, selectedAt: now() };
  await putAtomically([{ storeName: "feed_nutrition_selections", value: selection }]);
  return selection;
}

export async function getNutritionSelections(feedId) {
  const farmId = requireFarm();
  const [feed, events, observations, sources] = await Promise.all([get("feed_library", feedId),
    getAll("feed_nutrition_selections"), getAll("feed_observations"), getAll("feed_sources")]);
  if (!feed || feed.farmId !== farmId || feed.status === "archived") return null;
  if (requireFarm() !== farmId) throw new Error("Farm session changed during read.");
  const observationById = new Map(observations.filter((row) => row.farmId === farmId).map((row) => [row.id, row]));
  const sourceById = new Map(sources.filter((row) => row.farmId === farmId).map((row) => [row.id, row]));
  const current = currentNutritionSelections(events.filter((row) => row.farmId === farmId && row.feedId === feedId));
  return Object.freeze(Object.fromEntries(Object.entries(current).map(([code, selection]) => {
    const observation = observationById.get(selection.observationId) || null;
    return [code, Object.freeze({ ...selection, observation,
      source: observation ? sourceById.get(observation.sourceId) || null : null })];
  })));
}

export async function createDiagnosticProfile(input) {
  const farmId = requireFarm();
  const validated = validateDiagnosticProfile(input);
  const duplicate = farmRows(await getAll("feed_diagnostic_profiles")).find((row) =>
    row.status !== "archived" && row.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase() && row.version === validated.version);
  if (duplicate) throw new Error("That diagnostic profile name and version already exist in this farm.");
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const timestamp = now();
  const profile = { id: newId(), farmId, ...validated, status: "active", createdAt: timestamp, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_diagnostic_profiles", value: profile }]);
  return profile;
}

export async function supersedeDiagnosticProfile(previousProfileId, input) {
  const farmId = requireFarm();
  const previous = await get("feed_diagnostic_profiles", previousProfileId);
  if (!previous || previous.farmId !== farmId || previous.status === "archived") throw new Error("Previous diagnostic profile is not active in this farm.");
  const validated = validateDiagnosticProfile(input);
  const duplicate = farmRows(await getAll("feed_diagnostic_profiles")).find((row) => row.status !== "archived" &&
    row.name.toLocaleLowerCase() === validated.name.toLocaleLowerCase() && row.version === validated.version);
  if (duplicate) throw new Error("That diagnostic profile name and version already exist in this farm.");
  if (validated.version <= previous.version) throw new Error("A superseding profile must have a higher version.");
  if (validated.animalClass !== previous.animalClass) throw new Error("A superseding profile must retain the same animal class.");
  const reason = String(input?.supersessionReason || "").trim();
  if (!reason || reason.length > 500) throw new Error("Supersession reason is required and must be at most 500 characters.");
  const timestamp = now();
  const profile = { id: newId(), farmId, ...validated, status: "active", supersedesProfileId: previous.id,
    supersessionReason: reason, createdAt: timestamp, updatedAt: timestamp };
  const archived = { ...previous, status: "archived", archivedAt: timestamp, archiveReason: reason,
    supersededByProfileId: profile.id, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_diagnostic_profiles", value: archived },
    { storeName: "feed_diagnostic_profiles", value: profile }]);
  return profile;
}

export async function archiveDiagnosticProfile(profileId, reasonInput) {
  const farmId = requireFarm();
  const profile = await get("feed_diagnostic_profiles", profileId);
  if (!profile || profile.farmId !== farmId || profile.status === "archived") throw new Error("Diagnostic profile is not active in this farm.");
  const reason = String(reasonInput || "").trim();
  if (!reason || reason.length > 500) throw new Error("Archive reason is required and must be at most 500 characters.");
  const timestamp = now();
  const archived = { ...profile, status: "archived", archivedAt: timestamp, archiveReason: reason, updatedAt: timestamp };
  await putAtomically([{ storeName: "feed_diagnostic_profiles", value: archived }]);
  return archived;
}

export async function listDiagnosticProfiles({ includeArchived = false } = {}) {
  return farmRows(await getAll("feed_diagnostic_profiles"))
    .filter((row) => includeArchived || row.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
}

export async function selectDiagnosticProfile(profileId, input) {
  const farmId = requireFarm();
  const validated = validateDiagnosticProfileSelection({ ...input, profileId });
  const profile = await get("feed_diagnostic_profiles", validated.profileId);
  if (!profile || profile.farmId !== farmId || profile.status === "archived") throw new Error("Diagnostic profile is not active in this farm.");
  const animals = await getAll("animals");
  const group = validated.animalIds.map((id) => animals.find((animal) => animal.id === id && animal.farmId === farmId &&
    ["active", "dry"].includes(animal.status)));
  if (group.some((animal) => !animal)) throw new Error("Every selected animal must be active in this farm.");
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const selection = { id: newId(), farmId, profileId: validated.profileId, rationale: validated.rationale,
    applicabilityConfirmed: true, applicabilityConfirmedAt: now(), animalGroup: group.map((animal) =>
      ({ id: animal.id, animalCode: animal.animalCode, type: animal.type, status: animal.status })), selectedAt: now() };
  await putAtomically([{ storeName: "feed_diagnostic_profile_selections", value: selection }]);
  return selection;
}

export async function getSelectedDiagnosticProfile() {
  const farmId = requireFarm();
  const [profiles, events] = await Promise.all([getAll("feed_diagnostic_profiles"), getAll("feed_diagnostic_profile_selections")]);
  if (requireFarm() !== farmId) throw new Error("Farm session changed during read.");
  const selection = currentDiagnosticProfileSelection(events.filter((row) => row.farmId === farmId));
  if (!selection || selection.applicabilityConfirmed !== true || !selection.animalGroup?.length) return null;
  const profile = profiles.find((row) => row.id === selection.profileId && row.farmId === farmId && row.status !== "archived");
  return profile ? Object.freeze({ profile, selection }) : null;
}

export async function recordDiagnosticWarningReview(ration, findings) {
  const farmId = requireFarm();
  const selected = await getSelectedDiagnosticProfile();
  if (!selected) throw new Error("Approve a diagnostic profile for a confirmed animal group before recording warnings.");
  const metrics = ["totalAsFedKg", "totalDMIKg", "forageDMKg", "meDensityMJPerKgDM", "cpPercentDM", "totalCostCents"];
  if (metrics.some((key) => !Number.isFinite(Number(ration?.[key])))) throw new Error("Diagnostic warning history received invalid ration metrics.");
  const codes = Array.isArray(findings) ? findings.map((finding) => String(finding?.code || "")).filter(Boolean) : [];
  if (!codes.length) throw new Error("Diagnostic warning history requires at least one finding.");
  if (requireFarm() !== farmId) throw new Error("Farm session changed during save.");
  const event = { id: newId(), farmId, profileId: selected.profile.id, profileVersion: selected.profile.version,
    profileName: selected.profile.name, animalClass: selected.profile.animalClass, applicability: selected.profile.applicability,
    sourceCitation: selected.profile.sourceCitation, selectionId: selected.selection.id,
    animalGroup: structuredClone(selected.selection.animalGroup), rationale: selected.selection.rationale,
    ration: Object.fromEntries(metrics.map((key) => [key, Number(ration[key])])), findingCodes: codes, calculatedAt: now() };
  await putAtomically([{ storeName: "feed_diagnostic_warning_events", value: event }]);
  return event;
}

export async function listDiagnosticWarningHistory() {
  return farmRows(await getAll("feed_diagnostic_warning_events"))
    .sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt));
}

export async function getPendingSyncCount() {
  const rows = farmRows(await getAll("sync_queue"));
  return rows.filter((item) => item.status === "pending" || item.status === "failed").length;
}

export async function getTodayMilkSummary(localDate) {
  const records = farmRows(await getAll("records"));
  const milk = records.filter((r) => r.kind === "milk" && r.localDate === localDate);
  const bySession = Object.fromEntries(["morning", "afternoon", "evening"].map((session) => [
    session,
    milk.filter((row) => row.session === session)
      .reduce((sum, row) => sum + Number(row.liters || 0), 0)
  ]));
  return {
    totalLiters: Number(Object.values(bySession).reduce((sum, value) => sum + value, 0).toFixed(1)),
    bySession
  };
}

export async function listMilkRecordsForDate(localDate) {
  const records = farmRows(await getAll("records"));
  return records.filter((record) => record.kind === "milk" && record.localDate === localDate);
}

export async function getHerdSummary() {
  const animals = await listAnimals();
  return {
    total: animals.length,
    dairyCows: animals.filter((a) => a.type === "dairy_cow").length,
    bulls: animals.filter((a) => a.type === "bull").length,
    calves: animals.filter((a) => a.type === "calf").length
  };
}


function cloudAnimalToLocal(row, existing = null) {
  return {
    ...(existing || {}),
    id: existing?.id || row.id,
    clientId: row.client_id || existing?.clientId || row.id,
    kind: "animal",
    animalCode: row.animal_id,
    type: row.type,
    sex: row.sex || null,
    breed: row.breed,
    birthDate: row.birth_date || null,
    acquiredDate: row.acquired_date || null,
    source: row.source || null,
    status: row.status || "active",
    damId: row.dam_id || null,
    sireId: row.sire_id || null,
    rfid: row.rfid || null,
    qrValue: row.qr_value || null,
    notes: row.notes || "",
    createdAt: row.created_at || existing?.createdAt || now(),
    updatedAt: row.updated_at || existing?.updatedAt || now(),
    photoAttachmentId: existing?.photoAttachmentId || null
  };
}

function cloudRecordToLocal(kind, row, animalId, existing = null) {
  const base = {
    ...(existing || {}),
    id: existing?.id || row.id,
    clientId: row.client_id || existing?.clientId || row.id,
    kind,
    animalId,
    createdAt: row.created_at || existing?.createdAt || now(),
    updatedAt: row.updated_at || existing?.updatedAt || now()
  };

  if (kind === "milk") {
    return {
      ...base,
      localDate: row.local_date || (row.recorded_at ? new Date(row.recorded_at).toISOString().slice(0, 10) : null),
      session: row.session || null,
      liters: Number(row.yield_liters)
    };
  }

  if (kind === "weight") {
    return {
      ...base,
      localDate: row.local_date,
      kilograms: Number(row.kilograms)
    };
  }

  if (kind === "breeding") {
    return {
      ...base,
      serviceDate: row.event_date,
      eventDate: row.event_date,
      expectedCalving: row.expected_calving || null,
      eventType: row.event_type || "service",
      result: row.result || null,
      notes: row.notes || ""
    };
  }

  if (kind === "health") {
    return {
      ...base,
      treatmentDate: row.treatment_date,
      treatmentType: row.treatment_type,
      description: row.description || "",
      medicine: row.medicine || null,
      dose: row.dose || null,
      provider: row.provider || null,
      withdrawalEndDate: row.withdrawal_end_date || null,
      cost: Number(row.cost || 0)
    };
  }

  if (kind === "expense") {
    return {
      ...base,
      category: row.category,
      amount: Number(row.amount),
      expenseDate: row.expense_date,
      notes: row.notes || "",
      supplier: row.supplier || null
    };
  }

  return base;
}

export async function importCloudSnapshot(snapshot) {
  const localAnimals = await getAll("animals");
  const localRecords = await getAll("records");
  const localByCode = new Map(localAnimals.map((animal) => [animal.animalCode.toLowerCase(), animal]));
  const localByClientId = new Map(localRecords.map((record) => [record.clientId, record]));
  const animalIdByCode = new Map();

  const importedAnimals = snapshot.animals.map((row) => {
    const existing = localByCode.get(String(row.animal_id).toLowerCase());
    const localAnimal = cloudAnimalToLocal(row, existing);
    animalIdByCode.set(String(row.animal_id).toLowerCase(), localAnimal.id);
    return localAnimal;
  });

  if (importedAnimals.length) await putMany("animals", importedAnimals);

  const rows = [
    ...snapshot.milk.map((row) => ["milk", row]),
    ...snapshot.weight.map((row) => ["weight", row]),
    ...snapshot.breeding.map((row) => ["breeding", row]),
    ...snapshot.health.map((row) => ["health", row]),
    ...snapshot.expense.map((row) => ["expense", row])
  ];

  const importedRecords = [];
  for (const [kind, row] of rows) {
    const animalId = animalIdByCode.get(String(row.animal_id || "").toLowerCase());
    if (!animalId && kind !== "expense") continue;
    const existing = localByClientId.get(row.client_id);
    importedRecords.push(cloudRecordToLocal(kind, row, animalId || null, existing));
  }

  if (importedRecords.length) {
    await putMany("records", importedRecords);
  }

  return {
    importedAnimals: importedAnimals.length,
    importedRecords: importedRecords.length
  };
}
