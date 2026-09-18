import assert from "node:assert/strict";
import { toCloudPayload } from "../src/cloud/supabase-adapter.js";

const milk = toCloudPayload({
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  kind: "milk",
  animalId: "33333333-3333-4333-8333-333333333333",
  localDate: "2026-09-19",
  session: "evening",
  liters: 12.5
}, "44444444-4444-4444-8444-444444444444");

assert.deepEqual(milk, {
  farm_id: "44444444-4444-4444-8444-444444444444",
  id: "11111111-1111-4111-8111-111111111111",
  client_id: "22222222-2222-4222-8222-222222222222",
  animal_id: "33333333-3333-4333-8333-333333333333",
  local_date: "2026-09-19",
  session: "evening",
  yield_liters: 12.5
});

console.log("cloud-mapping.test.js: PASS");
