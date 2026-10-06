const DB_NAME = "ngombe-herdbook";
const DB_VERSION = 13;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
  });
}

export function openLocalDatabase() {
  if (!("indexedDB" in window)) {
    throw new Error("This browser does not support local farm storage.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("animals")) {
        const store = db.createObjectStore("animals", { keyPath: "id" });
        store.createIndex("animalCode", "animalCode", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("animalId", "animalId", { unique: false });
        store.createIndex("localDate", "localDate", { unique: false });
      }

      if (!db.objectStoreNames.contains("attachments")) {
        const store = db.createObjectStore("attachments", { keyPath: "id" });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      if (!db.objectStoreNames.contains("sync_queue")) {
        const store = db.createObjectStore("sync_queue", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      // Version 2 is additive: existing farm rows are never read, rewritten or
      // deleted during the upgrade. A failed upgrade therefore rolls back the
      // new store and leaves the version 1 database intact.
      if (!db.objectStoreNames.contains("feed_library")) {
        const store = db.createObjectStore("feed_library", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("farmNameKey", "farmNameKey", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("feed_sources")) {
        const store = db.createObjectStore("feed_sources", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("feed_observations")) {
        const store = db.createObjectStore("feed_observations", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("feedId", "feedId", { unique: false });
        store.createIndex("sourceId", "sourceId", { unique: false });
        store.createIndex("nutrientCode", "nutrientCode", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      // Version 4 remains additive. Inventory and cost provenance are stored
      // separately from nutrition observations and are not connected to TMR.
      if (!db.objectStoreNames.contains("feed_cost_sources")) {
        const store = db.createObjectStore("feed_cost_sources", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("feed_inventory_batches")) {
        const store = db.createObjectStore("feed_inventory_batches", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("feedId", "feedId", { unique: false });
        store.createIndex("costSourceId", "costSourceId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      // Version 5 adds immutable inventory movements and explicit nutrition
      // selections. Neither store is consumed by ration or TMR calculations.
      if (!db.objectStoreNames.contains("feed_inventory_movements")) {
        const store = db.createObjectStore("feed_inventory_movements", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("batchId", "batchId", { unique: false });
        store.createIndex("movementDate", "movementDate", { unique: false });
      }

      if (!db.objectStoreNames.contains("feed_nutrition_selections")) {
        const store = db.createObjectStore("feed_nutrition_selections", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("feedId", "feedId", { unique: false });
        store.createIndex("nutrientCode", "nutrientCode", { unique: false });
        store.createIndex("observationId", "observationId", { unique: false });
      }

      // Version 6 is additive. Diagnostic profiles carry their own evidence,
      // applicability and version; only an explicit selection can activate one.
      if (!db.objectStoreNames.contains("feed_diagnostic_profiles")) {
        const store = db.createObjectStore("feed_diagnostic_profiles", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("animalClass", "animalClass", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("feed_diagnostic_profile_selections")) {
        const store = db.createObjectStore("feed_diagnostic_profile_selections", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("profileId", "profileId", { unique: false });
        store.createIndex("selectedAt", "selectedAt", { unique: false });
      }
      // Version 7 adds immutable warning-review history. No inventory, farm
      // record, queue or cloud row is created by this local audit store.
      if (!db.objectStoreNames.contains("feed_diagnostic_warning_events")) {
        const store = db.createObjectStore("feed_diagnostic_warning_events", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("profileId", "profileId", { unique: false });
        store.createIndex("calculatedAt", "calculatedAt", { unique: false });
      }
      // Version 8 stores immutable, sourced animal classification observations.
      // It does not infer classes or activate diagnostic or ration logic.
      if (!db.objectStoreNames.contains("animal_nutrition_classifications")) {
        const store = db.createObjectStore("animal_nutrition_classifications", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("animalId", "animalId", { unique: false });
        store.createIndex("animalVersion", ["animalId", "version"], { unique: true });
        store.createIndex("observedAt", "observedAt", { unique: false });
      }
      // Version 9 adds immutable reviewer decisions. These audit events do not
      // activate diagnostic profiles or create farm records, queue or cloud rows.
      if (!db.objectStoreNames.contains("animal_nutrition_classification_reviews")) {
        const store = db.createObjectStore("animal_nutrition_classification_reviews", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false });
        store.createIndex("animalId", "animalId", { unique: false });
        store.createIndex("classificationId", "classificationId", { unique: false });
        store.createIndex("profileId", "profileId", { unique: false });
        store.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
      // Version 10 adds sourced requirement equations, immutable approvals and
      // calculation audits. These stores never mutate inventory or sync state.
      if (!db.objectStoreNames.contains("nutrition_requirement_profiles")) {
        const store = db.createObjectStore("nutrition_requirement_profiles", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("animalClass", "animalClass", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("nutrition_requirement_profile_reviews")) {
        const store = db.createObjectStore("nutrition_requirement_profile_reviews", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("profileId", "profileId", { unique: false });
        store.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("nutrition_requirement_calculations")) {
        const store = db.createObjectStore("nutrition_requirement_calculations", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("animalId", "animalId", { unique: false });
        store.createIndex("calculatedAt", "calculatedAt", { unique: false });
      }
      // Version 11 stores immutable, explicit profile-to-classification
      // applicability decisions. It does not select a ration or consume stock.
      if (!db.objectStoreNames.contains("nutrition_requirement_applicability_reviews")) {
        const store = db.createObjectStore("nutrition_requirement_applicability_reviews", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("profileId", "profileId", { unique: false });
        store.createIndex("animalId", "animalId", { unique: false }); store.createIndex("classificationId", "classificationId", { unique: false });
        store.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
      // Version 12 stores immutable human review of a source-attributed
      // requirement/ration comparison. It does not alter rations, inventory,
      // farm records, the sync queue or cloud state.
      if (!db.objectStoreNames.contains("nutrition_requirement_ration_reviews")) {
        const store = db.createObjectStore("nutrition_requirement_ration_reviews", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("animalId", "animalId", { unique: false });
        store.createIndex("requirementCalculationId", "requirementCalculationId", { unique: false });
        store.createIndex("rationReviewId", "rationReviewId", { unique: false }); store.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
      // Version 13 stores reviewed, ingredient-level allocations of a group
      // ration. It is an audit store only and cannot consume inventory.
      if (!db.objectStoreNames.contains("feed_ration_allocation_reviews")) {
        const store = db.createObjectStore("feed_ration_allocation_reviews", { keyPath: "id" });
        store.createIndex("farmId", "farmId", { unique: false }); store.createIndex("rationReviewId", "rationReviewId", { unique: false });
        store.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
    };

    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error("Close other Ngombe Herdbook tabs before upgrading local storage."));
    request.onerror = () => reject(request.error || new Error("Could not open local farm database."));
  });
}

export async function appendInventoryMovementAtomically({ farmId, batchId, movement, assertCurrent }) {
  const db = await openLocalDatabase();
  const transaction = db.transaction(["feed_inventory_batches", "feed_inventory_movements"], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    const batch = await requestResult(transaction.objectStore("feed_inventory_batches").get(batchId));
    if (!batch || batch.farmId !== farmId || batch.status === "archived") throw new Error("Inventory batch is not active in this farm.");
    const existing = await requestResult(transaction.objectStore("feed_inventory_movements").index("batchId").getAll(batchId));
    const balance = batch.receivedQuantityKg + existing.reduce((sum, row) => sum + row.deltaQuantityKg, 0);
    if (balance + movement.deltaQuantityKg < -0.0000001) throw new Error("Inventory movement exceeds the available batch quantity.");
    assertCurrent();
    transaction.objectStore("feed_inventory_movements").put(movement);
    await completed;
    return movement;
  } catch (error) {
    try { transaction.abort(); } catch { /* Transaction may already have completed. */ }
    await completed.catch(() => {});
    throw error;
  } finally { db.close(); }
}

export async function put(storeName, value) {
  const db = await openLocalDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionComplete(transaction);
  db.close();
  return value;
}

export async function putMany(storeName, values) {
  const db = await openLocalDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  values.forEach((value) => store.put(value));
  await transactionComplete(transaction);
  db.close();
}

export async function putAtomically(entries) {
  if (!entries.length) return;
  const db = await openLocalDatabase();
  const transaction = db.transaction([...new Set(entries.map((entry) => entry.storeName))], "readwrite");
  const completed = transactionComplete(transaction);
  try {
    for (const { storeName, value } of entries) {
      transaction.objectStore(storeName).put(value);
    }
    await completed;
  } catch (error) {
    try { transaction.abort(); } catch { /* Transaction may already have aborted. */ }
    await completed.catch(() => {});
    throw error;
  } finally {
    db.close();
  }
}

// Claim one explicitly selected legacy animal and its existing photo/queue as
// one transaction. Checks run against the rows inside the write transaction.
// Synchronous snapshot for the transaction's final comparison. Blob bytes are
// checked by the backup preflight; only Blob metadata can be checked while an
// IndexedDB transaction remains active.
export function recoveryRowSnapshot(row) {
  return JSON.stringify(row, (_key, value) => {
    if (value instanceof Blob) return { blobType: value.type, blobSize: value.size,
      fileName: value instanceof File ? value.name : null,
      lastModified: value instanceof File ? value.lastModified : null };
    if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
    if (ArrayBuffer.isView(value)) return [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)];
    return value;
  });
}

export async function claimLegacyAnimalAtomically({ animalId, animalCode, farmId, userId, backupSha256, expectedRows, signal, assertCurrent }) {
  const db = await openLocalDatabase();
  const names = ["animals", "attachments", "records", "sync_queue", "settings"];
  const transaction = db.transaction(names, "readwrite");
  let settled = false;
  let failure = null;
  const result = new Promise((resolve, reject) => {
    const abort = () => { try { transaction.abort(); } catch { /* Already completed. */ } };
    signal?.addEventListener("abort", abort, { once: true });
    transaction.oncomplete = () => { settled = true; signal?.removeEventListener("abort", abort); resolve(); };
    transaction.onerror = () => { failure ||= transaction.error; };
    transaction.onabort = () => { settled = true; signal?.removeEventListener("abort", abort);
      reject(failure || transaction.error || new Error("Ownership claim aborted.")); };
    const rows = {};
    let remaining = names.length;
    for (const name of names) {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => {
        rows[name] = request.result;
        if (--remaining !== 0) return;
        try {
          if (signal?.aborted) throw new Error("Session changed before ownership claim.");
          assertCurrent();
          const animal = rows.animals.find((row) => row.id === animalId);
          const sameCode = rows.animals.filter((row) =>
            String(row.animalCode || "").toLocaleLowerCase() === animalCode.toLocaleLowerCase());
          if (!animal || animal.farmId || animal.animalCode !== animalCode || sameCode.length !== 1) {
            throw new Error("Animal identity changed or its code is ambiguous.");
          }
          const photos = rows.attachments.filter((row) => row.ownerId === animalId);
          const queue = rows.sync_queue.filter((row) => row.recordId === animalId);
          if (photos.length !== 1 || photos[0].id !== animal.photoAttachmentId || photos[0].farmId ||
              queue.length !== 1 || queue[0].id !== animalId || queue[0].farmId ||
              queue[0].recordType !== "animal" || queue[0].status !== "pending" ||
              queue[0].payload?.id !== animalId || rows.records.some((row) => row.animalId === animalId)) {
            throw new Error("Animal, photo, records or queue links require individual review.");
          }
          if (!expectedRows || recoveryRowSnapshot(animal) !== expectedRows.animal ||
              recoveryRowSnapshot(photos[0]) !== expectedRows.photo ||
              recoveryRowSnapshot(queue[0]) !== expectedRows.queue) {
            throw new Error("Local rows changed after backup comparison; make a new verified backup.");
          }
          const key = "legacy-claim:" + farmId + ":" + animalId;
          if (rows.settings.some((row) => row.key === key)) throw new Error("Animal already has a recovery claim.");
          transaction.objectStore("animals").put({ ...animal, farmId });
          transaction.objectStore("attachments").put({ ...photos[0], farmId });
          transaction.objectStore("sync_queue").put({ ...queue[0], farmId,
            payload: { ...queue[0].payload, farmId } });
          transaction.objectStore("settings").put({ key, userId, farmId, animalId, backupSha256,
            claimedAt: new Date().toISOString() });
        } catch (error) { failure = error; abort(); }
      };
    }
  });
  try { await result; } finally { if (!settled) try { transaction.abort(); } catch { /* Already closed. */ }
    db.close(); }
}

export async function get(storeName, key) {
  const db = await openLocalDatabase();
  const result = await requestResult(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  db.close();
  return result || null;
}

export async function getAll(storeName) {
  const db = await openLocalDatabase();
  const result = await requestResult(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
  db.close();
  return result;
}

export async function deleteItem(storeName, key) {
  const db = await openLocalDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await transactionComplete(transaction);
  db.close();
}
