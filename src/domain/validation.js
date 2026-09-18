export function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required.");
  return text;
}

export function validateAnimal(input) {
  const animalCode = requireText(input.animalCode, "Animal name/ID");
  const type = requireText(input.type, "Animal type");
  const breed = requireText(input.breed, "Breed");

  if (!["dairy_cow", "bull", "calf", "heifer", "other"].includes(type)) {
    throw new Error("Unsupported animal type.");
  }

  if (!input.photoBlob) throw new Error("Every animal needs a profile photo.");

  return {
    animalCode,
    type,
    breed,
    sex: input.sex || null,
    birthDate: input.birthDate || null,
    acquiredDate: input.acquiredDate || null,
    source: input.source || null,
    rfid: input.rfid || null,
    qrValue: input.qrValue || null,
    status: input.status || "active",
    notes: input.notes || ""
  };
}

export function validateMilk(input) {
  const liters = Number(input.liters);
  if (!input.animalId) throw new Error("Select an animal.");
  if (!["morning", "afternoon", "evening"].includes(input.session)) {
    throw new Error("Select a valid milking session.");
  }
  if (!Number.isFinite(liters) || liters <= 0 || liters > 60) {
    throw new Error("Enter a milk quantity between 0 and 60 litres.");
  }
  return {
    animalId: input.animalId,
    session: input.session,
    liters,
    localDate: input.localDate
  };
}

export function validateWeight(input) {
  const kilograms = Number(input.kilograms);
  if (!input.animalId) throw new Error("Select an animal.");
  if (!Number.isFinite(kilograms) || kilograms <= 0 || kilograms > 2000) {
    throw new Error("Enter a valid weight in kilograms.");
  }
  return {
    animalId: input.animalId,
    kilograms,
    localDate: input.localDate
  };
}
