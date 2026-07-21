// All styling for the planner, injected as a single <style> element inside the shadow root.
// Everything is scoped under `.tsh-*` classes so nothing leaks in or out of the page.

export const STYLES = `
:host { all: initial; }

.tsh-wrap {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: #1a1f2b;
}

/* Floating toggle button */
.tsh-toggle {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  padding: 10px 16px;
  border: none;
  border-radius: 24px;
  background: #1d4ed8;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}
.tsh-toggle:hover { background: #1e40af; }

/* Sliding drawer */
.tsh-drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483001;
  width: 100vw;
  max-width: 100vw;
  height: 100vh;
  background: #f4f6fb;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.22s ease;
}
.tsh-wrap.open .tsh-drawer { transform: translateX(0); }
.tsh-wrap.open .tsh-toggle { display: none; }

.tsh-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #1d4ed8;
  color: #fff;
}
.tsh-title { font-weight: 700; font-size: 14px; }
.tsh-close {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.tsh-content {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 16px 20px 40px;
  display: grid;
  grid-template-columns: minmax(380px, 460px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.tsh-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
/* Keep the calendar in view while scrolling the browse column on tall lists. */
.tsh-col-right { position: sticky; top: 0; }

/* Collapse to a single stacked column when the drawer is narrow. */
@media (max-width: 900px) {
  .tsh-content { grid-template-columns: 1fr; }
  .tsh-col-right { position: static; }
}

.tsh-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin-bottom: 6px;
}

/* Inputs & buttons */
.tsh-in {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #1a1f2b;
  box-sizing: border-box;
}
.tsh-in:focus { outline: 2px solid #93c5fd; border-color: #93c5fd; }

.tsh-btn {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #1a1f2b;
  cursor: pointer;
  white-space: nowrap;
}
.tsh-btn:hover:not(:disabled) { background: #eef2ff; border-color: #a5b4fc; }
.tsh-btn:disabled { opacity: 0.5; cursor: default; }
.tsh-btn-danger:hover:not(:disabled) { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
.tsh-add { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
.tsh-add:hover:not(:disabled) { background: #1e40af; color: #fff; }

/* Term selector */
.tsh-term-presets { width: 100%; margin-bottom: 8px; }
.tsh-term-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.tsh-field { display: flex; flex-direction: column; gap: 2px; }
.tsh-field span { font-size: 10px; color: #64748b; }
.tsh-field .tsh-in { width: 100%; }

/* Plans */
.tsh-plan-row { display: flex; gap: 6px; align-items: center; }
.tsh-plan-select { flex: 1 1 auto; min-width: 0; }

/* Search results */
.tsh-search-in { width: 100%; }
.tsh-status { font-size: 12px; color: #64748b; margin: 6px 0; }
.tsh-error {
  font-size: 12px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 8px;
}
.tsh-results { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.tsh-course-row {
  text-align: left;
  font: inherit;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  padding: 8px 10px;
  cursor: pointer;
}
.tsh-course-row:hover { background: #eef2ff; border-color: #a5b4fc; }
.tsh-course-top { display: flex; justify-content: space-between; align-items: baseline; }
.tsh-course-abbr { font-weight: 700; }
.tsh-course-units { font-size: 11px; color: #64748b; }
.tsh-course-title { margin-top: 2px; }
.tsh-course-title-sm { color: #475569; }
.tsh-course-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }

/* Sections */
.tsh-sections { display: flex; flex-direction: column; gap: 8px; }
.tsh-sec-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 2px; }
.tsh-empty { font-size: 12px; color: #94a3b8; font-style: italic; }
.tsh-sec {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 8px 10px;
}
.tsh-sec-added { border-color: #86efac; background: #f0fdf4; }
.tsh-sec-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tsh-sec-name { font-weight: 600; flex: 1 1 auto; }
.tsh-seats { font-size: 11px; color: #475569; }
.tsh-wl { font-size: 11px; color: #b45309; }
.tsh-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.tsh-dot-green { background: #16a34a; }
.tsh-dot-yellow { background: #eab308; }
.tsh-dot-red { background: #dc2626; }
.tsh-dot-unknown { background: #cbd5e1; }
.tsh-meetings { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.tsh-m { font-size: 11px; color: #475569; }
.tsh-m-method { font-weight: 600; color: #334155; }
.tsh-m-final { color: #7c3aed; }

/* Calendar */
.tsh-cal-wrap { display: flex; flex-direction: column; gap: 8px; }
.tsh-cal-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.tsh-cal-title { font-weight: 700; font-size: 14px; }
.tsh-cal-units { font-size: 12px; color: #475569; }
.tsh-cal-warn { font-size: 12px; color: #b91c1c; font-weight: 600; }

.tsh-cal { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; }
.tsh-cal-daysrow { display: flex; border-bottom: 1px solid #e2e8f0; }
.tsh-cal-gutter-head { flex: 0 0 40px; }
.tsh-cal-dayhead {
  flex: 1 1 0;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
  padding: 4px 0;
  border-left: 1px solid #eef2f6;
}
.tsh-cal-body { display: flex; position: relative; }
.tsh-cal-gutter { flex: 0 0 40px; position: relative; }
.tsh-cal-hour {
  position: absolute;
  right: 4px;
  font-size: 9px;
  color: #94a3b8;
  transform: translateY(-50%);
}
.tsh-cal-day {
  flex: 1 1 0;
  position: relative;
  border-left: 1px solid #eef2f6;
}
.tsh-ev {
  position: absolute;
  left: 2px;
  right: 2px;
  border-radius: 4px;
  padding: 2px 3px;
  font-size: 10px;
  line-height: 1.15;
  color: #10233f;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.12);
}
.tsh-ev > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tsh-ev-abbr { font-weight: 700; }
.tsh-ev-time { opacity: 0.75; }
.tsh-ev-loc { opacity: 0.85; }
.tsh-ev-inst { opacity: 0.85; font-style: italic; }

/* Method legend under the grid */
.tsh-cal-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 11px;
  color: #64748b;
  padding: 2px 2px 0;
}
.tsh-legend-code {
  font-weight: 700;
  color: #334155;
  background: #e2e8f0;
  border-radius: 4px;
  padding: 0 4px;
}
.tsh-ev-conflict {
  border: 2px solid #dc2626;
  background-image: repeating-linear-gradient(
    45deg,
    rgba(220, 38, 38, 0.18) 0,
    rgba(220, 38, 38, 0.18) 5px,
    transparent 5px,
    transparent 10px
  );
}

/* Planned-section list under the calendar */
.tsh-planned { display: flex; flex-direction: column; gap: 4px; }
.tsh-planned-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.tsh-planned-row.tsh-conflict { border-color: #fca5a5; background: #fef2f2; }
.tsh-planned-abbr { font-weight: 700; }
.tsh-planned-name { flex: 1 1 auto; color: #475569; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tsh-planned-units { color: #94a3b8; font-size: 11px; }
.tsh-remove {
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
}
.tsh-remove:hover { color: #dc2626; }

.tsh-section { display: flex; flex-direction: column; }
`;
