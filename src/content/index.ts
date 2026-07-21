import { TssClient } from "../api/tss";

// Phase 1 smoke test: instantiate the client and expose it on the page for manual poking from
// the DevTools console while we build the planner UI (Phase 3). No UI injected yet.
const client = new TssClient();

// e.g. in the TSS tab console:
//   await window.__tssHook.searchCourses({ term: {year:'2026',period:'2',
//     yearText:'2026/2027', periodText:'Fall Quarter'}, query: 'CSE-103' })
(window as unknown as { __tssHook: TssClient }).__tssHook = client;

console.info("[TSS Hook] content script ready — client on window.__tssHook");

export {};
