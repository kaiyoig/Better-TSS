import { TssClient } from "../api/tss";
import { createPlanStore } from "../storage/planStore";
import { mountPanel } from "../ui/panel";

// Phase 3: mount the WebReg-style planner overlay on the TSS page. The panel renders entirely
// inside a Shadow DOM host, so it never depends on (or collides with) SAP Fiori's markup.
const client = new TssClient();
const store = createPlanStore();

mountPanel(client, store);

console.info("[TSS Hook] planner overlay mounted");

export {};
