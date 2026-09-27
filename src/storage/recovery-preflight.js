import { getAll, recoveryRowSnapshot } from "./local-db.js?build=20260922-03";

// The existing evidence exporter serializes binary attachments as base64. This
// comparison runs entirely in the browser and never uploads or imports a file.
const STORE_NAMES = ["animals", "attachments", "records", "sync_queue"];

function base64(bytes) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(text);
}

async function encode(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : { $type: "number", value: String(value) };
  if (typeof value === "undefined") return { $type: "undefined" };
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (typeof value !== "object" || seen.has(value)) throw new Error("Cannot compare this stored value safely.");
  seen.add(value);
  try {
    if (value instanceof Blob) {
      const item = { $type: value instanceof File ? "File" : "Blob", mimeType: value.type,
        base64: base64(new Uint8Array(await value.arrayBuffer())) };
      if (value instanceof File) { item.name = value.name; item.lastModified = value.lastModified; }
      return item;
    }
    if (value instanceof Date) return { $type: "Date", value: value.toISOString() };
    if (value instanceof ArrayBuffer) return { $type: "ArrayBuffer", base64: base64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { $type: value.constructor.name,
      base64: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    if (Array.isArray(value)) return { $type: "Array", items: await Promise.all(value.map((item) => encode(item, seen))) };
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("Cannot compare this stored object safely.");
    }
    const entries = [];
    for (const [key, item] of Object.entries(value)) entries.push([key, await encode(item, seen)]);
    return { $type: "Object", entries };
  } finally { seen.delete(value); }
}

async function digest(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function field(row, name) {
  if (row?.$type !== "Object" || !Array.isArray(row.entries)) return undefined;
  return row.entries.find(([key]) => key === name)?.[1];
}

export async function readRecoveryEvidence(file) {
  if (!file || typeof file.text !== "function") throw new Error("Select a local evidence backup file.");
  // A very large or corrupt file should not exhaust the browser while verifying.
  if (file.size > 100 * 1024 * 1024) throw new Error("Backup exceeds the 100 MB inspection limit.");
  const backup = JSON.parse(await file.text());
  const { payload, sha256 } = backup;
  if (payload?.format !== "ngombe-local-evidence-v1" || payload.database !== "ngombe-herdbook" ||
      payload.databaseVersion !== 1 || payload.origin !== location.origin + location.pathname ||
      !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Backup identity does not match this app and database.");
  if (await digest(payload) !== sha256) throw new Error("Backup checksum mismatch. Local records were not changed.");
  if (![...STORE_NAMES, "settings"].every((name) => Array.isArray(payload.stores?.[name]))) {
    throw new Error("Backup is missing an expected store.");
  }
  return { payload, sha256 };
}

export async function inspectRecoveryBackup(file) {
  const { payload, sha256 } = await readRecoveryEvidence(file);

  const live = {};
  for (const name of STORE_NAMES) {
    const expected = payload.stores?.[name];
    if (!Array.isArray(expected)) throw new Error("Backup is missing the " + name + " store.");
    const rows = await getAll(name);
    if (rows.length !== expected.length) throw new Error("The " + name + " count changed since backup. Make a new verified backup before recovery.");
    const encoded = await Promise.all(rows.map((row) => encode(row)));
    const byId = new Map(expected.map((row) => [field(row, "id"), row]));
    if (byId.size !== expected.length || encoded.some((row) => !byId.has(field(row, "id")) ||
        JSON.stringify(byId.get(field(row, "id"))) !== JSON.stringify(row))) {
      throw new Error("The " + name + " rows differ from the backup. Local records were not changed.");
    }
    live[name] = rows;
  }

  const unowned = live.animals.filter((animal) => !animal.farmId);
  const linked = unowned.map((animal) => {
    const photos = live.attachments.filter((photo) => photo.ownerId === animal.id && !photo.farmId);
    const queue = live.sync_queue.filter((item) => item.recordId === animal.id && !item.farmId);
    const records = live.records.filter((item) => item.animalId === animal.id && !item.farmId);
    return { id: animal.id, animalCode: animal.animalCode, photoCount: photos.length,
      queueCount: queue.length, recordCount: records.length,
      expectedRows: photos.length === 1 && queue.length === 1 ? {
        animal: recoveryRowSnapshot(animal), photo: recoveryRowSnapshot(photos[0]),
        queue: recoveryRowSnapshot(queue[0]) } : null,
      linksValid: photos.length === 1 && photos[0].id === animal.photoAttachmentId &&
        queue.length === 1 && queue[0].recordType === "animal" && queue[0].id === animal.id &&
        queue[0].payload?.id === animal.id };
  });
  return { sha256, counts: Object.fromEntries(STORE_NAMES.map((name) => [name, live[name].length])),
    unownedAnimals: linked, matched: true };
}
