import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const rationAllocationUiTest = await readFile(
  new URL("./ration-allocation-ui.browser.test.js", import.meta.url),
  "utf8"
);
assert.match(rationAllocationUiTest, /import \{ waitForAuthenticatedApp \} from "\.\/support\/browser-auth-readiness\.js";/);
assert.doesNotMatch(rationAllocationUiTest, /#account-actions:not\(\[hidden\]\).*waitFor/);
assert.equal(
  (rationAllocationUiTest.match(/await authenticatedAppReady\(/g) || []).length,
  3,
  "each authenticated startup or reload must use the complete readiness gate"
);

const feedReviewUiTest = await readFile(
  new URL("./feed-review-ui.browser.test.js", import.meta.url),
  "utf8"
);
assert.match(feedReviewUiTest, /import \{ waitForAuthenticatedApp \} from "\.\/support\/browser-auth-readiness\.js";/);
assert.doesNotMatch(feedReviewUiTest, /#account-actions:not\(\[hidden\]\).*waitFor/);
assert.equal(
  (feedReviewUiTest.match(/await authenticatedAppReady\(/g) || []).length,
  4,
  "each authenticated feed-review startup or reload must use the complete readiness gate"
);

console.log("browser-auth-readiness.test.js: PASS");
