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
