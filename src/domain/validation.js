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

export function validateFinance(input) {
  const direction = requireText(input.direction, "Entry type");
  if (!["income", "expense"].includes(direction)) throw new Error("Choose income or expense.");
  const category = requireText(input.category, "Category");
  const allowed = direction === "income"
    ? ["Milk sale", "Animal sale", "Other income"]
    : ["Feed", "Veterinary", "Labour", "Maintenance", "Transport", "Other expense"];
  if (!allowed.includes(category)) throw new Error("Choose a valid category.");
  const amount = String(input.amount ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("Enter a positive amount in KSh, with at most two decimal places.");
  }
  const [whole, fraction = ""] = amount.split(".");
  const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const localDate = requireText(input.localDate, "Date");
  const date = new Date(localDate + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== localDate) throw new Error("Enter a valid date.");
  const details = requireText(input.details, "Description");
  if (details.length > 240) throw new Error("Description must be 240 characters or fewer.");
  const paymentMethod = requireText(input.paymentMethod, "Payment method");
  if (!["Cash", "M-Pesa", "Bank", "Other"].includes(paymentMethod)) throw new Error("Choose a valid payment method.");
  const paymentReference = String(input.paymentReference || "").trim();
  if (paymentReference.length > 100) throw new Error("Payment reference must be 100 characters or fewer.");
  return { direction, category, amountCents, localDate, details, paymentMethod, paymentReference };
}
