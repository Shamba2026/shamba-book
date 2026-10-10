import { APP_CONFIG } from "./config.js";
import { get, put } from "./storage/local-db.js?build=20260928-02";

// Membership evidence is per signed-in user and configured farm. Cached evidence
// permits offline work only after a successful online membership check.
const OFFLINE_MEMBERSHIP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function hasCurrentMembershipEvidence(cached, userId, farmId) {
  if (cached?.authorized !== true || cached.userId !== userId || cached.farmId !== farmId) return false;
  const checkedAt = Date.parse(cached.checkedAt);
  const age = Date.now() - checkedAt;
  return Number.isFinite(checkedAt) && age >= -CLOCK_SKEW_MS && age <= OFFLINE_MEMBERSHIP_MAX_AGE_MS;
}

export async function verifyFarmAccess(client, user) {
  const farmId = APP_CONFIG.cloud.farmId;
  if (!farmId || !user?.id) throw new Error("A signed-in farm member is required.");
  const key = "verified-farm:" + user.id + ":" + farmId;

  if (!navigator.onLine) {
    const cached = await get("settings", key);
    if (hasCurrentMembershipEvidence(cached, user.id, farmId)) return farmId;
    throw new Error("Connect to verify your farm membership before recording offline. Locally saved records are preserved.");
  }

  const { data, error } = await client.from("farm_members")
    .select("farm_id").eq("farm_id", farmId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  await put("settings", { key, userId: user.id, farmId, authorized: Boolean(data), checkedAt: new Date().toISOString() });
  if (!data) throw new Error("This account is not a member of the configured farm.");
  return farmId;
}
