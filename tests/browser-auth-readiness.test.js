import assert from "node:assert/strict";
import { assessAuthReadiness } from "./support/browser-auth-readiness.js";

const readySnapshot = {
  sessionUserId: "isolated-test-user",
  expectedUserId: "isolated-test-user",
  membershipVerified: true,
  accountActionsVisible: true,
  authCardVisible: false,
  farmViewVisible: true,
  navigationVisible: true,
  appStatus: "Signed in to the farm cloud account.",
  appStatusKind: "success"
};

assert.deepEqual(assessAuthReadiness(readySnapshot), {
  ready: true,
  pending: []
});

assert.deepEqual(assessAuthReadiness({
  ...readySnapshot,
  membershipVerified: false,
  accountActionsVisible: false,
  farmViewVisible: false
}), {
  ready: false,
  pending: ["farm membership", "account actions", "farm view"]
});

assert.deepEqual(assessAuthReadiness({
  ...readySnapshot,
  sessionUserId: "other-test-user",
  appStatus: "This account is not a member of the configured farm.",
  appStatusKind: "error"
}), {
  ready: false,
  pending: ["expected session", "non-error application status"]
});

console.log("browser-auth-readiness.test.js: PASS");
