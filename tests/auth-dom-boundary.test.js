import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "")
  .replace("export async function initApp()", "async function initApp()");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function element() {
  const classes = new Set();
  const styles = new Map();
  return {
    hidden: false, textContent: "", innerHTML: "", value: "", src: "", dataset: {},
    listeners: {},
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
    },
    style: { setProperty(name, value) { styles.set(name, value); }, getPropertyValue(name) { return styles.get(name); } },
    matches(selector) { return selector === "[data-view]" && Boolean(this.dataset.view); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    reset() { this.value = ""; },
    replaceChildren() { this.innerHTML = ""; },
    removeAttribute(name) { if (name === "src") this.src = ""; }
  };
}

const nodes = new Map();
const get = (selector) => {
  if (!nodes.has(selector)) nodes.set(selector, element());
  return nodes.get(selector);
};
const views = ["home", "animals", "milk", "weight", "breeding", "health", "finance"].map((name) => {
  const node = element(); node.dataset.view = name; return node;
});
const nav = element();
const navButtons = views.map(({ dataset }) => { const node = element(); node.dataset.nav = dataset.view; return node; });
let authChanged;
let syncCallback;
let animalRead = Promise.resolve([]);
let dashboardRead = Promise.resolve({ total: 0, dairyCows: 0, bulls: 0, calves: 0 });
const animal = { id: "retained-test-id", animalCode: "TEST-B1A-20260921-001", type: "dairy_cow", status: "active", breed: "SYNTHETIC-TEST-NOT-REAL" };
const client = {
  auth: {
    onAuthStateChange(callback) { authChanged = callback; },
    async getSession() { return { data: { session: null } }; },
    async signOut() { authChanged("SIGNED_OUT", null); return { error: null }; }
  }
};
const context = vm.createContext({
  document: {
    querySelector: get,
    querySelectorAll(selector) {
      if (selector === ".auth-gated") return [...views, nav];
      if (selector === "[data-view]") return views;
      if (selector === "[data-nav]") return navButtons;
      if (selector === "[data-nav-action]") return [];
      return [];
    }
  },
  APP_CONFIG: { cloud: { enabled: false } },
  FarmRepository: {
    listAnimals: () => animalRead,
    getHerdSummary: () => dashboardRead,
    getTodayMilkSummary: async () => ({ totalLiters: 0 }),
    listMilkRecordsForDate: async () => [],
    getPendingSyncCount: async () => 1,
    getAnimal: async () => ({ animal, photo: {} })
  },
  getAuthClient: async () => client,
  startSyncLoop(callback) { syncCallback = callback; },
  toLocalDateString: () => "2026-09-21",
  calculateMilkValue: () => 0,
  getMilkWeekPeriod: () => ({ start: "2026-09-19", end: "2026-09-25" }),
  animalTypeLabel: () => "Other",
  URL: { createObjectURL: () => "blob:test-photo", revokeObjectURL() {} },
  navigator: { onLine: true },
  console
});
vm.runInContext(source + "\nthis.app = { initApp, openAnimal, refreshAnimalData, refreshDashboard };", context);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const farmText = () => [get("#animal-list").innerHTML, get("#profile-name").textContent,
  ...["#milk-animal", "#weight-animal", "#health-animal", "#breeding-animal"].map((s) => get(s).innerHTML)].join(" ");

await context.app.initApp();
await tick();
assert.equal(farmText().includes(animal.animalCode), false, "signed-out startup must not load animals");
assert.equal(get("#stat-total").textContent, "0");
await syncCallback();
assert.equal(get("#stat-total").textContent, "0", "background refresh must not reveal local counts while signed out");

animalRead = Promise.resolve([animal]);
dashboardRead = Promise.resolve({ total: 1, dairyCows: 0, bulls: 0, calves: 0 });
authChanged("SIGNED_IN", { user: { id: "test-user" } });
await tick();
assert.match(farmText(), /TEST-B1A-20260921-001/);
assert.equal(get("#stat-total").textContent, 1);
assert.match(get("#milk-checklist-summary").textContent, /1 of 1 active dairy cows have no morning record/);
await context.app.openAnimal(animal.id);
assert.equal(get("#profile-name").textContent, animal.animalCode);
assert.equal(get("#profile-photo").src, "blob:test-photo");
get("#animal-form").value = "partially entered farm data";

await get("#auth-sign-out").listeners.click();
assert.equal(farmText().includes(animal.animalCode), false, "sign-out must clear all rendered animal references");
assert.equal(get("#profile-photo").src, "");
assert.equal(get("#stat-total").textContent, "0");
assert.equal(get("#sync-count").textContent, "0");
assert.equal(get("#animal-form").value, "", "sign-out must clear incomplete form entries");
assert.equal(get("#milk-checklist").innerHTML, "", "sign-out must clear the milk checklist");
assert.equal(views.every((view) => view.hidden && view.style.getPropertyValue("display") === "none"), true);

const lateAnimals = deferred();
animalRead = lateAnimals.promise;
authChanged("SIGNED_IN", { user: { id: "test-user" } });
await tick();
await get("#auth-sign-out").listeners.click();
lateAnimals.resolve([animal]);
await tick();
assert.equal(farmText().includes(animal.animalCode), false, "in-flight animal refresh must not repopulate signed-out DOM");

animalRead = Promise.resolve([animal]);
const lateDashboard = deferred();
dashboardRead = lateDashboard.promise;
authChanged("SIGNED_IN", { user: { id: "test-user" } });
await tick();
await get("#auth-sign-out").listeners.click();
lateDashboard.resolve({ total: 1, dairyCows: 0, bulls: 0, calves: 0 });
await tick();
assert.equal(get("#stat-total").textContent, "0", "in-flight dashboard refresh must not repopulate signed-out DOM");

dashboardRead = Promise.resolve({ total: 1, dairyCows: 0, bulls: 0, calves: 0 });
authChanged("SIGNED_IN", { user: { id: "test-user" } });
await tick();
assert.match(farmText(), /TEST-B1A-20260921-001/, "retained local record must reappear after sign-in");
assert.equal(get("#stat-total").textContent, 1);
console.log("auth-dom-boundary.test.js: PASS");
