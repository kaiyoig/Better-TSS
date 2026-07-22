import { TssClient } from "../api/tss";
import { createBridgedFetch, describeBridge } from "./bridgeClient";
import { createPlanStore } from "../storage/planStore";
import { mountPanel } from "../ui/panel";

// Phase 3: mount the WebReg-style planner overlay on the TSS page. The panel renders entirely
// inside a Shadow DOM host, so it never depends on (or collides with) SAP Fiori's markup.
// TSS calls go through the main-world fetch bridge so they carry the page's exact credentials
// (Brave and friends don't always attach cookies to isolated-world fetches).
const client = new TssClient(createBridgedFetch(), describeBridge);
const store = createPlanStore();

const panel = mountPanel(client, store);

// Let the toolbar icon open/close the planner (background forwards the click here).
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "tsshook:toggle") panel.toggle();
});

console.info("[Better TSS] planner overlay mounted — look for the 📅 Planner button (bottom-right)");

export {};
