// This isolated extension bridge never receives the publishing token. It only
// carries public AMC snapshot data from the ordinary page context to the
// extension service worker, which keeps the token in extension-local storage.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "odyssey-seat-monitor") return;
  chrome.runtime.sendMessage({ type: "amc_collection_result", ...event.data });
});
