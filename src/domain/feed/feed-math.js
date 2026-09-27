const FEED_ROLES = new Set(["forage", "concentrate", "mineral", "other"]);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(label + " must be a finite number.");
  return number;
}

function percentage(value, label, { allowZero = true } = {}) {
  const number = finiteNumber(value, label);
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (number < minimum || number > 100) throw new Error(label + " must be between 0 and 100.");
  return number;
}

function validateFeed(feed) {
  if (!feed || typeof feed !== "object") throw new Error("A feed profile is required.");
  if (!String(feed.id || "").trim()) throw new Error("Feed ID is required.");
  if (!String(feed.name || "").trim()) throw new Error("Feed name is required.");
  if (!FEED_ROLES.has(feed.role)) throw new Error("Unsupported feed role.");
  const dmPercent = percentage(feed.dmPercent, "DM percentage", { allowZero: false });
  const meMJPerKgDM = finiteNumber(feed.meMJPerKgDM, "ME density");
  if (meMJPerKgDM < 0) throw new Error("ME density cannot be negative.");
  const cpPercentDM = percentage(feed.cpPercentDM, "CP percentage");
  if (!Number.isSafeInteger(feed.costPerAsFedTonneCents) || feed.costPerAsFedTonneCents < 0) {
    throw new Error("As-fed tonne cost must be a non-negative integer number of cents.");
  }
  return { dmPercent, meMJPerKgDM, cpPercentDM };
}

export function calculateRation(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("At least one ration row is required.");

  let totalAsFedKg = 0;
  let totalDMIKg = 0;
  let forageDMKg = 0;
  let totalMEMJ = 0;
  let totalCPKg = 0;
  let exactCostCents = 0;

  const ingredients = rows.map((row) => {
    const feed = row?.feed;
    const { dmPercent, meMJPerKgDM, cpPercentDM } = validateFeed(feed);
    const asFedKg = finiteNumber(row.asFedKg, "As-fed weight");
    if (asFedKg < 0) throw new Error("As-fed weight cannot be negative.");

    const dmKg = asFedKg * (dmPercent / 100);
    const meMJ = dmKg * meMJPerKgDM;
    const cpKg = dmKg * (cpPercentDM / 100);
    const costCents = (asFedKg / 1000) * feed.costPerAsFedTonneCents;

    totalAsFedKg += asFedKg;
    totalDMIKg += dmKg;
    if (feed.role === "forage") forageDMKg += dmKg;
    totalMEMJ += meMJ;
    totalCPKg += cpKg;
    exactCostCents += costCents;

    return Object.freeze({
      feedId: feed.id,
      feedName: feed.name,
      role: feed.role,
      asFedKg,
      dmKg,
      meMJ,
      cpKg,
      costCents: Math.round(costCents)
    });
  });

  if (totalDMIKg <= 0) throw new Error("Total dry matter intake must be greater than zero.");
  if (!Number.isSafeInteger(Math.round(exactCostCents))) throw new Error("Ration cost is outside the supported range.");

  return Object.freeze({
    ingredients: Object.freeze(ingredients),
    totalAsFedKg,
    totalDMIKg,
    forageDMKg,
    totalMEMJ,
    totalCPKg,
    meDensityMJPerKgDM: totalMEMJ / totalDMIKg,
    cpPercentDM: (totalCPKg / totalDMIKg) * 100,
    totalCostCents: Math.round(exactCostCents)
  });
}

export const feedRoles = Object.freeze([...FEED_ROLES]);
