import { initApp } from "./ui.js?build=20260921-01";

const errorBox = document.querySelector("#fatal-error");

window.addEventListener("error", (event) => {
  if (!errorBox) return;
  errorBox.hidden = false;
  errorBox.textContent = event.error?.message || event.message || "Unexpected application error.";
});

window.addEventListener("unhandledrejection", (event) => {
  if (!errorBox) return;
  errorBox.hidden = false;
  errorBox.textContent = event.reason?.message || String(event.reason);
});

initApp().catch((error) => {
  if (errorBox) {
    errorBox.hidden = false;
    errorBox.textContent = error.message;
  }
});
