import { get, getAll, put, putMany } from "./local-db.js";

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

async function assertUniqueAnimalCode(animalCode, existingId = null) {
  const animals = await getAll("animals");
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
  await assertUniqueAnimalCode(animal.animalCode, animal.id || null);

  const animalRecord = {
    ...animal,
    id: animal.id || newId(),
    clientId: animal.clientId || newId(),
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
    clientId: newId(),
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
    clientId: newId(),
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
  const record = {
    id: newId(),
    clientId: newId(),
    kind,
    ...payload,
    createdAt: now(),
    updatedAt: now()
  };
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
    milk.filter((row) => row.session === session)
      .reduce((sum, row) => sum + Number(row.liters || 0), 0)
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
