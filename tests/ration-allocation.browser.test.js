import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const server = createServer(async (request, response) => { const relative = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
  const filename = path.resolve(root, relative); if (!filename.startsWith(root + path.sep) || !relative.startsWith("src/")) return response.writeHead(404).end();
  try { response.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(await readFile(filename)); }
  catch { response.writeHead(404).end(); } });

const browser = await chromium.launch({ headless: true }); let context;
try { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/src/config.js`);
  const result = await page.evaluate(async () => {
    const localDb = await import("/src/storage/local-db.js?allocation-browser"); const repository = await import("/src/storage/farm-repository.js?allocation-browser");
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase("ngombe-herdbook"); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    await localDb.put("animals", { id: "preserved", farmId: "farm-a", animalCode: "PRESERVED" });
    const ration = { id: "ration-group", farmId: "farm-a", profileId: "diagnostic-profile", profileVersion: 1,
      sourceCitation: "TEST feed evidence", selectionId: "diagnostic-selection", calculatedAt: "2026-10-07T08:00:00.000Z",
      rationBasis: "DAILY_OFFERED_RATION", rationBasisConfirmed: true,
      animalGroup: [{ id: "cow-a" }, { id: "cow-b" }], ration: { ingredients: [
        { feedId: "silage", feedName: "Synthetic silage", role: "forage", asFedKg: 20, dmKg: 6, meMJ: 60, cpKg: 0.6, costCents: 2000 },
        { feedId: "meal", feedName: "Synthetic meal", role: "concentrate", asFedKg: 4, dmKg: 3.6, meMJ: 39.6, cpKg: 0.72, costCents: 800 }
      ] } };
    await localDb.put("feed_diagnostic_warning_events", ration); repository.setActiveFarm("farm-a");
    const input = { allocationMethod: "DOCUMENTED_INGREDIENT_WEIGHTS", rationale: "Observed and weighed individual allocations.",
      reviewerUserId: "reviewer-a", reviewerConfirmed: true, allocations: [
        { animalId: "cow-a", ingredients: [{ feedId: "silage", asFedKg: 12 }, { feedId: "meal", asFedKg: 2.5 }] },
        { animalId: "cow-b", ingredients: [{ feedId: "silage", asFedKg: 8 }, { feedId: "meal", asFedKg: 1.5 }] }
      ] };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) { if (this.name === "feed_ration_allocation_reviews")
      throw new DOMException("Synthetic allocation failure", "AbortError"); return originalPut.call(this, value, ...args); };
    let rollbackRejected = false; try { await repository.recordRationAllocationEvidence(ration.id, input); } catch { rollbackRejected = true; }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const afterRollback = await repository.listRationAllocationEvidence(); const saved = await repository.recordRationAllocationEvidence(ration.id, input);
    repository.setActiveFarm("farm-b"); const hidden = (await repository.listRationAllocationEvidence()).length === 0;
    let crossFarmRejected = false; try { await repository.recordRationAllocationEvidence(ration.id, input); } catch { crossFarmRejected = true; }
    const requirement = { id: "requirement-cow-a", farmId: "farm-a", animalId: "cow-a", profileId: "requirement-profile",
      profileVersion: 1, sourceCitation: "TEST requirement evidence", classificationId: "classification-cow-a",
      calculatedAt: "2026-10-07T08:30:00.000Z", outputs: [
        { outputCode: "DMI_KG_DAY", outputUnit: "kg DM/day", value: 6 },
        { outputCode: "ME_MJ_DAY", outputUnit: "MJ ME/day", value: 65 },
        { outputCode: "CP_KG_DAY", outputUnit: "kg CP/day", value: 0.9 }
      ] };
    await localDb.put("nutrition_requirement_calculations", requirement); repository.setActiveFarm("farm-a");
    const comparison = await repository.reviewRequirementRationComparison(requirement.id, ration.id, {
      allocationReviewId: saved.id, decision: "ACKNOWLEDGED", rationale: "Reviewed the documented individual allocation arithmetic.",
      reviewerUserId: "reviewer-a", reviewerConfirmed: true });
    const db = await localDb.openLocalDatabase(); const version = db.version; const stores = [...db.objectStoreNames]; db.close();
    return { version, stores, rollbackRejected, afterRollback, saved, hidden, crossFarmRejected, comparison,
      preserved: await localDb.get("animals", "preserved"), records: await localDb.getAll("records"),
      queue: await localDb.getAll("sync_queue"), movements: await localDb.getAll("feed_inventory_movements") };
  });
  assert.equal(result.version, 13); assert.equal(result.stores.includes("feed_ration_allocation_reviews"), true);
  assert.equal(result.rollbackRejected, true); assert.equal(result.afterRollback.length, 0);
  assert.equal(result.saved.allocations.length, 2); assert.equal(result.saved.allocations[0].ration.totalDMIKg, 5.85);
  assert.equal(result.comparison.allocationReviewId, result.saved.id);
  assert.equal(result.comparison.report.comparisons[0].suppliedValue, 5.85);
  assert.equal(result.hidden, true); assert.equal(result.crossFarmRejected, true); assert.equal(result.preserved.animalCode, "PRESERVED");
  assert.equal(result.records.length, 0); assert.equal(result.queue.length, 0); assert.equal(result.movements.length, 0);
  console.log("ration-allocation.browser.test.js: PASS");
} finally { await context?.close(); await browser.close(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
