import { get, getAll, put, putMany, deleteItem } from "./local-db.js";

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

async function queue(record) {
  await put("sync_queue", {
    id: record.id,
    recordType: record.kind || "animal",
    recordId: record.id,
    status: "pending",
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    payload: structuredClone(record)
  });
}

export async function saveAnimal(animal, photoBlob) {
  const animalRecord = {
    ...animal,
    id: animal.id || newId(),
    kind: "animal",
    createdAt: animal.createdAt || now(),
    updatedAt: now(),
    photoAttachmentId: animal.photoAttachmentId || newId()
  };

  const attachment = {
    id: animalRecord.photoAttachmentId,
    ownerId: animalRecord.id,
    kind: "animal_profile_photo",
    filename: String(animalRecord.animalCode).replace(/[^a-z0-9_-]/gi, "_") + ".jpg",
    mimeType: photoBlob.type || "image/jpeg",
    createdAt: now(),
    blob: photoBlob
  };

  await putMany("animals", [animalRecord]);
  await put("attachments", attachment);
  await queue(animalRecord);
  return animalRecord;
}

export async function listAnimals() {
  const animals = await getAll("animals");
  return animals.sort((a, b) => a.animalCode.localeCompare(b.animalCode));
}

export async function getAnimal(animalId) {
  const animal = await get("animals", animalId);
  if (!animal) return null;
  const attachment = await get("attachments", animal.photoAttachmentId);
  return { animal, photo: attachment ? attachment.blob : null };
}

export async function saveMilkRecord(input) {
  const record = {
    id: newId(),
    kind: "milk",
    animalId: input.animalId,
    localDate: input.localDate,
    session: input.session,
    liters: Number(input.liters),
    createdAt: now(),
    updatedAt: now()
  };
  await put("records", record);
  await queue(record);
  return record;
}

export async function saveWeightRecord(input) {
  const record = {
    id: newId(),
    kind: "weight",
    animalId: input.animalId,
    localDate: input.localDate,
    kilograms: Number(input.kilograms),
    createdAt: now(),
    updatedAt: now()
  };
  await put("records", record);
  await queue(record);
  return record;
}

export async function saveGenericRecord(kind, payload) {
  const record = { id: newId(), kind, ...payload, createdAt: now(), updatedAt: now() };
  await put("records", record);
  await queue(record);
  return record;
}

export async function getPendingSyncCount() {
  const rows = await getAll("sync_queue");
  return rows.filter((item) => item.status === "pending" || item.status === "failed").length;
}

export async function getTodayMilkSummary(localDate) {
  const records = await getAll("records");
  const milk = records.filter((r) => r.kind === "milk" && r.localDate === localDate);
  const bySession = Object.fromEntries(["morning", "afternoon", "evening"].map((session) => [
    session,
    milk.filter((row) => row.session === session).reduce((sum, row) => sum + Number(row.liters || 0), 0)
  ]));
  return {
    totalLiters: Number(Object.values(bySession).reduce((sum, value) => sum + value, 0).toFixed(1)),
    bySession
  };
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
