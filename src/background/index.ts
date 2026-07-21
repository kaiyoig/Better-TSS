// Service worker. Placeholder for Phase 2+ (saved-plan storage, cross-tab messaging). The TSS
// OData client runs in the content script so requests inherit the page's same-origin session.
chrome.runtime.onInstalled.addListener(() => {
  console.info("[TSS Hook] installed");
});

export {};
