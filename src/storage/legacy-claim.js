import { get } from "./local-db.js?build=20260922-02";
import { claimLegacyAnimalAtomically } from "./local-db.js?build=20260922-02";
import { inspectRecoveryBackup, readRecoveryEvidence } from "./recovery-preflight.js";
import { verifyFarmAccess } from "../farm-access.js";

export async function claimLegacyAnimal({ client, userId, animalId, animalCode, file, signal, assertCurrent }) {
  if (!navigator.onLine || signal?.aborted) throw new Error("Connect to verify membership before claiming ownership.");
  if (!userId || !animalId || !animalCode || !file || typeof assertCurrent !== "function") {
    throw new Error("Select an animal and explicitly confirm its code.");
  }
  const { payload, sha256 } = await readRecoveryEvidence(file);
  if (signal?.aborted) throw new Error("Session changed before ownership claim.");
  const session = await client.auth.getSession();
  if (session.error || session.data?.session?.user?.id !== userId) throw new Error("Sign in again to confirm ownership.");
  const farmId = await verifyFarmAccess(client, session.data.session.user);
  const current = await client.auth.getSession();
  if (current.error || current.data?.session?.user?.id !== userId || signal?.aborted) {
    throw new Error("Session changed before ownership claim.");
  }
  assertCurrent();

  const key = "legacy-claim:" + farmId + ":" + animalId;
  const previous = await get("settings", key);
  if (previous) {
    const animal = await get("animals", animalId);
    const photo = animal && await get("attachments", animal.photoAttachmentId);
    const queue = await get("sync_queue", animalId);
    if (previous.backupSha256 !== sha256 ||
        animal?.farmId !== farmId || animal.animalCode !== animalCode ||
        photo?.farmId !== farmId || photo.ownerId !== animalId ||
        queue?.farmId !== farmId || queue.recordId !== animalId || queue.payload?.farmId !== farmId) {
      throw new Error("Existing ownership claim differs; preserve records for review.");
    }
    return { status: "already_claimed", animalId, farmId };
  }

  const comparison = await inspectRecoveryBackup(file);
  const selected = comparison.unownedAnimals.find((item) => item.id === animalId);
  if (!selected || selected.animalCode !== animalCode || !selected.linksValid || selected.recordCount !== 0) {
    throw new Error("This animal group needs individual review before attribution.");
  }
  // The file checksum covers the entire original snapshot, including the photo.
  // No mutation is authorized merely because the snapshot matches this device.
  if (payload.stores.animals.length !== comparison.counts.animals) throw new Error("Backup changed during inspection.");
  if (signal?.aborted) throw new Error("Session changed before ownership claim.");
  assertCurrent();
  await claimLegacyAnimalAtomically({ animalId, animalCode, farmId, userId, backupSha256: sha256,
    signal, assertCurrent });
  return { status: "claimed", animalId, farmId };
}
