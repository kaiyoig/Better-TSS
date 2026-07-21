// Service worker. Placeholder for Phase 2+ (saved-plan storage lives in the content script's
// chrome.storage; cross-tab messaging can grow here later).
chrome.runtime.onInstalled.addListener(() => {
  console.info("[Better TSS] installed");
});

// The toolbar icon toggles the on-page planner. If the active tab isn't a TSS page (no content
// script to receive the message), open TSS instead.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) {
    void chrome.tabs.create({ url: "https://tss.ucsd.edu/fiori" });
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "tsshook:toggle" }).catch(() => {
    void chrome.tabs.create({ url: "https://tss.ucsd.edu/fiori" });
  });
});

export {};
