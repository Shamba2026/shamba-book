import { APP_CONFIG } from "../config.js";

const DAY_INDEX = Object.freeze({
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
});

export function toLocalDateString(date = new Date()) {
  const local = new Date(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function addDays(dateString, days) {
  const date = new Date(dateString + "T12:00:00");
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date.");
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

export function calculateExpectedCalving(serviceDate, gestationDays = 283) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(serviceDate)) {
    throw new Error("Service date must be YYYY-MM-DD.");
  }
  return addDays(serviceDate, gestationDays);
}

export function getMilkWeekPeriod(dateString = toLocalDateString()) {
  const date = new Date(dateString + "T12:00:00");
  if (Number.isNaN(date.getTime())) throw new Error("Invalid milk date.");
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
  const value = Number(liters) * APP_CONFIG.milk.pricePerLiter;
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid milk quantity.");
  return Number(value.toFixed(2));
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
