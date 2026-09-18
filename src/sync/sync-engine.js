import { APP_CONFIG } from "../config.js";
import { getAll, put, deleteItem } from "../storage/local-db.js";
import { push } from "../cloud/supabase-adapter.js";

function backoff(attempts) {
  return Math.min(60000, Math.max(1000, 2 ** attempts * 1000));
}

export async function syncPending() {
  if (!APP_CONFIG.cloud.enabled || !navigator.onLine) {
    return { attempted: 0, synced: 0, skipped: true };
  }

  const queue = (await getAll("sync_queue"))
    .filter((item) => item.status === "pending" || item.status === "failed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let synced = 0;

  for (const item of queue) {
    if (item.nextAttemptAt && Date.now() < new Date(item.nextAttemptAt).getTime()) continue;

    try {
      await put("sync_queue", { ...item, status: "syncing", updatedAt: new Date().toISOString() });
      const payload = { ...item.payload, client_id: item.payload.client_id || item.payload.id };
      await push(payload);
      await deleteItem("sync_queue", item.id);
      synced += 1;
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      await put("sync_queue", {
        ...item,
        status: "failed",
        attempts,
        lastError: String(error.message || error),
        nextAttemptAt: new Date(Date.now() + backoff(attempts)).toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  return { attempted: queue.length, synced, skipped: false };
}

export function startSyncLoop(onSync) {
  const run = async () => {
    const result = await syncPending();
    if (onSync) await onSync(result);
  };

  window.addEventListener("online", run);
  window.setInterval(run, 30000);
  run();
}
