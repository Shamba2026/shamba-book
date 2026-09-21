import { APP_CONFIG } from "./config.js";
import { get, put } from "./storage/local-db.js";

// Membership evidence is per signed-in user and configured farm. Cached evidence
// permits offline work only after a successful online membership check.
export async function verifyFarmAccess(client, user) {
  const farmId = APP_CONFIG.cloud.farmId;
  if (!farmId || !user?.id) throw new Error("A signed-in farm member is required.");
  const key = "verified-farm:" + user.id + ":" + farmId;

  if (!navigator.onLine) {
    const cached = await get("settings", key);
    if (cached?.authorized === true && cached.userId === user.id && cached.farmId === farmId) return farmId;
    throw new Error("Connect once to verify your farm membership before recording offline.");
  }

  const { data, error } = await client.from("farm_members")
    .select("farm_id").eq("farm_id", farmId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  await put("settings", { key, userId: user.id, farmId, authorized: Boolean(data), checkedAt: new Date().toISOString() });
  if (!data) throw new Error("This account is not a member of the configured farm.");
  return farmId;
}
