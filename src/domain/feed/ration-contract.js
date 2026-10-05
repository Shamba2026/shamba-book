import { calculateRation } from "./feed-math.js";

const REQUIRED_NUTRIENTS = Object.freeze({
  DM: Object.freeze({ basis: "AS_FED", units: Object.freeze({ PERCENT: 1, G_PER_KG_AS_FED: 0.1 }) }),
  ME: Object.freeze({ basis: "DRY_MATTER", units: Object.freeze({ MJ_PER_KG_DM: 1 }) }),
  CP: Object.freeze({ basis: "DRY_MATTER", units: Object.freeze({ PERCENT: 1, G_PER_KG_DM: 0.1 }) })
});

function selectedValue(feed, selections, nutrientCode) {
  const selection = selections?.[nutrientCode];
  const observation = selection?.observation;
  const source = selection?.source;
  const rule = REQUIRED_NUTRIENTS[nutrientCode];
  const factor = rule.units[observation?.unit];
  if (!selection?.id || !observation?.id || observation.status === "archived" || observation.feedId !== feed.id ||
      observation.nutrientCode !== nutrientCode || observation.basis !== rule.basis || factor == null ||
      !source?.id || source.status === "archived" || !Number.isFinite(Number(observation.value))) {
    throw new Error("A compatible active selected " + nutrientCode + " observation with retained source is required.");
  }
  return Object.freeze({ value: Number(observation.value) * factor, selectionId: selection.id,
    observationId: observation.id, sourceId: source.id, citation: source.citation || "",
    rationale: selection.rationale || "" });
}

function contractRow(row) {
  const feed = row?.feed;
  const batch = row?.batch;
  if (!feed?.id || feed.status === "archived") throw new Error("An active farm feed is required.");
  if (!batch?.id || batch.status === "archived" || batch.feedId !== feed.id) {
    throw new Error("Inventory batch does not belong to the selected active feed.");
  }
  const asFedKg = Number(row.asFedKg);
  const availableKg = Number(batch.remainingQuantityKg);
  if (!Number.isFinite(asFedKg) || asFedKg <= 0) throw new Error("As-fed weight must be greater than zero.");
  if (!Number.isFinite(availableKg) || availableKg < 0) throw new Error("Available inventory is invalid.");
  if (asFedKg > availableKg + 0.0000001) throw new Error("Proposed ration amount exceeds available inventory.");
  if (!Number.isFinite(batch.receivedQuantityKg) || batch.receivedQuantityKg <= 0 ||
      !Number.isSafeInteger(batch.totalCostCents) || batch.totalCostCents < 0) {
    throw new Error("Inventory cost provenance is incomplete.");
  }
  const dm = selectedValue(feed, row.selections, "DM");
  const me = selectedValue(feed, row.selections, "ME");
  const cp = selectedValue(feed, row.selections, "CP");
  return Object.freeze({ asFedKg, calculationFeed: Object.freeze({ id: feed.id, name: feed.name, role: feed.role,
    dmPercent: dm.value, meMJPerKgDM: me.value, cpPercentDM: cp.value,
    costPerAsFedTonneCents: Math.round(batch.totalCostCents / batch.receivedQuantityKg * 1000) }),
  evidence: Object.freeze({ DM: dm, ME: me, CP: cp }), costProvenance: Object.freeze({ batchId: batch.id,
    costSourceId: batch.costSourceId, currencyCode: batch.currencyCode, receivedQuantityKg: batch.receivedQuantityKg,
    totalCostCents: batch.totalCostCents }), availableKg });
}

export function buildReadOnlyRation(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("At least one inventory batch is required.");
  const prepared = rows.map(contractRow);
  const currencies = new Set(prepared.map((row) => row.costProvenance.currencyCode));
  if (currencies.size !== 1 || ![...currencies][0]) throw new Error("All ration rows must use one recorded currency.");
  const ration = calculateRation(prepared.map((row) => ({ feed: row.calculationFeed, asFedKg: row.asFedKg })));
  return Object.freeze({ ...ration, currencyCode: [...currencies][0], ingredients: Object.freeze(ration.ingredients.map((ingredient, index) =>
    Object.freeze({ ...ingredient, availableKg: prepared[index].availableKg, evidence: prepared[index].evidence,
      costProvenance: prepared[index].costProvenance }))) });
}
