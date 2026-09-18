import { APP_CONFIG } from "../config.js";

const DAY_INDEX = Object.freeze({
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6
});

function assertDateString(dateString) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateString)) {
    throw new Error("Date must be YYYY-MM-DD.");
  }
}

export function toLocalDateString(date = new Date()) {
  const local = new Date(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function addDays(dateString, days) {
  assertDateString(dateString);
  const date = new Date(dateString + "T12:00:00");
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function calculateExpectedCalving(serviceDate, gestationDays = 283) {
  assertDateString(serviceDate);
  if (!Number.isInteger(gestationDays) || gestationDays <= 0 || gestationDays > 400) {
    throw new Error("Gestation days must be a positive integer.");
  }
  return addDays(serviceDate, gestationDays);
}

export function getMilkWeekPeriod(dateString = toLocalDateString()) {
  assertDateString(dateString);
  const date = new Date(dateString + "T12:00:00");
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const daysSinceSaturday = (DAY_INDEX[dayName] + 1) % 7;
  const start = addDays(dateString, -daysSinceSaturday);
  return Object.freeze({
    start,
    end: addDays(start, 6),
    paymentDate: addDays(start, 7)
  });
}

export function calculateMilkValue(liters) {
  const numeric = Number(liters);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("Invalid milk quantity.");
  return Number((numeric * APP_CONFIG.milk.pricePerLiter).toFixed(2));
}

export function animalTypeLabel(type) {
  return ({
    dairy_cow: "Dairy cow",
    bull: "Bull",
    calf: "Calf",
    heifer: "Heifer",
    other: "Other"
  })[type] || "Animal";
}
