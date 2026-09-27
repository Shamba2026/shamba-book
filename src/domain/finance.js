export function filterFinanceEntries(entries, period, today) {
  if (period === "all") return [...entries];
  if (period !== "month" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("Unsupported finance reporting period.");
  }
  const month = today.slice(0, 7);
  return entries.filter((entry) => entry.localDate?.slice(0, 7) === month);
}

export function summarizeFinanceEntries(entries) {
  const summary = { incomeCents: 0, expenseCents: 0, netCents: 0, categoryTotals: [] };
  const categories = new Map();
  const addCents = (left, right) => {
    const total = left + right;
    if (!Number.isSafeInteger(total)) throw new Error("Finance total is outside the supported range.");
    return total;
  };
  for (const entry of entries) {
    if (!["income", "expense"].includes(entry.direction) ||
        !Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) continue;
    if (entry.direction === "income") summary.incomeCents = addCents(summary.incomeCents, entry.amountCents);
    else summary.expenseCents = addCents(summary.expenseCents, entry.amountCents);
    const key = entry.direction + "\u0000" + entry.category;
    categories.set(key, addCents(categories.get(key) || 0, entry.amountCents));
  }
  summary.netCents = addCents(summary.incomeCents, -summary.expenseCents);
  summary.categoryTotals = [...categories].map(([key, amountCents]) => {
    const [direction, category] = key.split("\u0000");
    return { direction, category, amountCents };
  }).sort((a, b) => b.amountCents - a.amountCents || a.category.localeCompare(b.category));
  return summary;
}

export function formatFinanceMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error("Finance total is outside the supported range.");
  const sign = cents < 0 ? "−" : "";
  return sign + "KSh " + (Math.abs(cents) / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
