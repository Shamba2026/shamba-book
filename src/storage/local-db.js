const DB_NAME = "ngombe-herdbook";
const DB_VERSION = 1;

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local farm database."));
  });
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
export async function claimLegacyAnimalAtomically({ animalId, animalCode, farmId, userId, backupSha256, signal, assertCurrent }) {
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
