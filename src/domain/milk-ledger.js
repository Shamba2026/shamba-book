function requiredText(value, message) {
  const text = String(value || "").trim();
  if (!text) throw new Error(message);
  return text;
}

function milkVolume(value) {
  const raw = String(value ?? "").trim();
  const liters = Number(raw);
  if (!/^\d{1,2}(?:\.\d{1,3})?$/.test(raw) || !Number.isFinite(liters) || liters <= 0 || liters > 60) {
    throw new Error("Enter a replacement milk quantity between 0 and 60 litres, with at most three decimal places.");
  }
  const volumeMl = Math.round(liters * 1000);
  return { liters: volumeMl / 1000, volumeMl };
}

export function validateMilkCorrection(input) {
  const targetRecordId = requiredText(input?.targetRecordId, "Choose a milk entry to correct.");
  const action = requiredText(input?.action, "Choose correct or void.");
  if (!["correct", "void"].includes(action)) throw new Error("Choose correct or void.");
  const reason = requiredText(input?.reason, "A correction reason is required.");
  if (reason.length > 240) throw new Error("Correction reason must be 240 characters or fewer.");
  const actorUserId = requiredText(input?.actorUserId, "An authenticated reviewer is required.");
  const replacement = action === "correct" ? milkVolume(input?.replacementLiters) : null;
  return { targetRecordId, action, reason, replacementLiters: replacement?.liters ?? null,
    replacementVolumeMl: replacement?.volumeMl ?? null, actorUserId };
}

export function effectiveMilkRecords(rows) {
  const records = rows.filter((row) => row.kind === "milk");
  const corrections = rows.filter((row) => row.kind === "milk_correction");
  const corrected = new Set();
  for (const correction of corrections) {
    if (corrected.has(correction.targetRecordId)) throw new Error("Milk entry was already corrected.");
    corrected.add(correction.targetRecordId);
  }
  return records.filter((record) => !corrected.has(record.id));
}
