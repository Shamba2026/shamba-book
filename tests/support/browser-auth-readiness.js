export function assessAuthReadiness(snapshot) {
  const pending = [];
  if (!snapshot.sessionUserId || snapshot.sessionUserId !== snapshot.expectedUserId) pending.push("expected session");
  if (!snapshot.membershipVerified) pending.push("farm membership");
  if (!snapshot.accountActionsVisible) pending.push("account actions");
  if (snapshot.authCardVisible) pending.push("sign-in form hidden");
  if (!snapshot.farmViewVisible) pending.push("farm view");
  if (!snapshot.navigationVisible) pending.push("navigation");
  if (snapshot.appStatusKind === "error") pending.push("non-error application status");
  return { ready: pending.length === 0, pending };
}

export async function collectAuthReadiness(page, { expectedUserId, farmId }) {
  const snapshot = await page.evaluate(async ({ expectedUserId: userId, farmId: configuredFarmId }) => {
    const visible = (element) => Boolean(element && !element.hidden && getComputedStyle(element).display !== "none" &&
      getComputedStyle(element).visibility !== "hidden");
    const { getAuthClient } = await import("/src/auth.js?build=20261010-03");
    const { data } = await (await getAuthClient()).auth.getSession();
    const sessionUserId = data?.session?.user?.id || null;
    const membershipVerified = await new Promise((resolve) => {
      const request = indexedDB.open("ngombe-herdbook");
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("settings")) { db.close(); resolve(false); return; }
        const transaction = db.transaction("settings", "readonly");
        const getRequest = transaction.objectStore("settings").get(`verified-farm:${userId}:${configuredFarmId}`);
        getRequest.onerror = () => { db.close(); resolve(false); };
        getRequest.onsuccess = () => {
          const row = getRequest.result;
          db.close();
          resolve(row?.authorized === true && row.userId === userId && row.farmId === configuredFarmId);
        };
      };
    });
    const appStatus = document.querySelector("#app-status");
    return {
      sessionUserId,
      expectedUserId: userId,
      membershipVerified,
      accountActionsVisible: visible(document.querySelector("#account-actions")),
      authCardVisible: visible(document.querySelector("#auth-card")),
      farmViewVisible: [...document.querySelectorAll("[data-view]")].some(visible),
      navigationVisible: visible(document.querySelector(".bottom-nav")),
      appStatus: appStatus?.textContent?.trim() || "",
      appStatusKind: appStatus?.dataset?.tone || "unknown",
      fatalError: document.querySelector("#fatal-error")?.textContent?.trim() || ""
    };
  }, { expectedUserId, farmId });
  return { ...snapshot, ...assessAuthReadiness(snapshot) };
}

export async function waitForAuthenticatedApp(page, options) {
  const timeout = options.timeout ?? 10_000;
  const pollInterval = options.pollInterval ?? 100;
  const deadline = Date.now() + timeout;
  let snapshot;
  do {
    snapshot = await collectAuthReadiness(page, options);
    if (snapshot.ready) return snapshot;
    await page.waitForTimeout(pollInterval);
  } while (Date.now() < deadline);
  if (options.artifactPath) await page.screenshot({ path: options.artifactPath, fullPage: true });
  throw new Error(`Authenticated application did not become ready: ${JSON.stringify(snapshot)}`);
}
