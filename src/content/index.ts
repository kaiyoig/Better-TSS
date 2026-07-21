import { TssClient } from "../api/tss";
import { createPlanStore } from "../storage/planStore";
import { mountPanel } from "../ui/panel";

// Phase 3: mount the WebReg-style planner overlay on the TSS page. The panel renders entirely
// inside a Shadow DOM host, so it never depends on (or collides with) SAP Fiori's markup.
const client = new TssClient();
const store = createPlanStore();

const panel = mountPanel(client, store);

// Let the toolbar icon open/close the planner (background forwards the click here).
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === "tsshook:toggle") panel.toggle();
});

console.info("[TSS Hook] planner overlay mounted — look for the 📅 Planner button (bottom-right)");

export {};
