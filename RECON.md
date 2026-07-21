# Better-TSS — Recon Findings (Phase 0)

Source: `tss.ucsd.edu.har` (194 requests, all on `tss.ucsd.edu`), captured while browsing the
Schedule of Classes in the TSS Fiori UI. TSS is SAP Student Lifecycle Management fronted by
SAP Fiori/UI5. The whole Schedule of Classes is served by a **custom UCSD OData v4 service** —
no legacy `act.ucsd.edu` scraping needed.

## Verdict
Fully hookable. The Fiori UI calls plain OData v4 JSON endpoints with the user's session
cookies. An extension running on `tss.ucsd.edu` can make the same credentialed calls, get the
same data (courses, sections, meeting times, seats, waitlist, instructors, prereqs), and drive
WebReg-style planning. **Booking is not yet mapped** — this HAR only covers browsing (read).

## Base
```
https://tss.ucsd.edu/sap/opu/odata4/sap/yucsd_con_module_sb/srvd/sap/yucsd_con_module_servicedef/0001/
```
Every request carries `?sap-client=500`.

## Auth
- Standard SAP session cookies (`MYSAPSSO2`/`SAP_SESSIONID_*`) established via UCSD SSO.
  The HAR export stripped cookie values, but a same-origin `fetch(..., {credentials:'include'})`
  from a content script or the service worker reuses the live logged-in session automatically —
  we never handle credentials ourselves.
- **CSRF handshake** (required for `$batch` POSTs):
  1. `HEAD <serviceRoot>/` with header `X-CSRF-Token: Fetch`
  2. Response returns `x-csrf-token: <token>` (e.g. `44JIjy-BVBS00OVa2bYfBg==`)
  3. Replay that token as `X-CSRF-Token` on subsequent `$batch` POSTs.
  Token expires — on `403` + `CSRF_Token_Missing` (seen in the HAR), re-fetch and retry.

## Key endpoints

### Course search — `YUCSD_CON_MODULE`
Sent inside a `$batch` POST (multipart). The inner request:
```
GET YUCSD_CON_MODULE?$count=true
  &$search="CSE-103"
  &$filter=AcYearText eq '2026/2027' and AcademicPeriodText eq 'Fall Quarter'
  &$select=AcademicLevel,AcademicPeriod,AcademicYear,CourseAbbr,CourseTitle,
           CreditsDisplay,DepartmentAbbr,DepartmentText,ModuleID,incrementDisplay
  &$skip=0&$top=30
```
Returns rows keyed by `(AcademicYear, AcademicPeriod, ModuleID)`. `$search` is full-text;
`$filter` scopes to a term. Example row:
```json
{"AcademicYear":"2026","AcademicPeriod":"2","ModuleID":"8754",
 "AcademicLevel":"Upper Division","DepartmentAbbr":"CSE","CourseAbbr":"CSE-103",
 "CourseTitle":"A Practical Introduction to Probability and Statistics","CreditsDisplay":"4.00"}
```

### Sections + meetings + seats — `.../_sections`
```
GET YUCSD_CON_MODULE(AcademicYear='2026',AcademicPeriod='2',ModuleID='8754')/_sections?$top=1000
```
This is the WebReg payload. Each event (lecture/discussion/lab/final):
```json
{"TeachingMethod":"LE","TeachingMethod_Text":"Lecture","InstructorName":"Yoav Freund",
 "InstructorEmail":"mailto: YFREUND@UCSD.EDU","EventAbbr":"001-000-LE",
 "Sched":"M, W, F 11:00 AM - 11:50 AM In Person @ Pepper Canyon Hall Room 106\nFinal Examination 12/08/2026 11:30 AM - 02:29 PM In Person",
 "EventPkgText":"CSE-103 (P-001-001)","EventPkgLimit":"192",
 "EventPkgSeatsAvailable":"192","EventPkgNumOnWaitl":0,
 "EventPkgSemanticColorCapacity":3,"BeginDate":"2026-09-25","EndDate":"2026-12-08"}
```
- `Sched` is a human-readable string bundling days/time/mode/location + final exam. **Needs
  parsing** into structured `{days, start, end, mode, location}` for calendar rendering.
- Seats: `EventPkgLimit` / `EventPkgSeatsAvailable` / `EventPkgNumOnWaitl`.
  `*SemanticColorCapacity` is the red/yellow/green fullness indicator.

### Course detail / notes — `YUCSD_CON_MODULE(...)`
`$expand=_deptNotesDescriptions,_notesDescriptions` for materials fee + department/course notes
(prereq blurbs, enrollment-method links).

### Prerequisites — `YUCSD_I_PREREQ_TREE`
```
GET YUCSD_I_PREREQ_TREE(moduleid='8754',keydate=2026-09-21)/Set?$top=100
```
Flat parent/child tree (classifications, majors, course requirements).

### Term value help — `YUCSD_I_PERYRT_SOC`, `YUCSD_I_PERIDT_SOC`
Academic-year and academic-period lists that populate the `AcYearText` / `AcademicPeriodText`
filter dropdowns. (`AcademicPeriod='2'` = Fall Quarter in the samples.)

### Current enrollment — `BC_OVP_BOOKED_MODULES_SRV/ModuleSet`
Separate OVP service; lists already-booked modules. Useful to gray out / dedupe planned courses.

## Gaps / next capture
- **Booking action** — no write op (`POST`/`PUT` to book/enroll) appears in this HAR; it only
  browses. Need a second HAR of an actual booking (or waitlist) click to map the assisted-booking
  request. Until then, "assisted booking" = deep-link/hand off into TSS's own booking UI.
- **Term codes** — confirm the full `AcademicPeriod` ↔ quarter mapping (1=?, 2=Fall, 3=?…).
- **Rate limits / anti-automation** on repeated section polling — unknown; poll conservatively.

## Data model (normalized target)
```
Course {year, period, moduleID, dept, abbr, title, units, level}
  Section {eventPkgText, limit, seatsAvailable, waitlist, capacityColor}
    Meeting {method, days[], start, end, mode, location, instructor, isFinal}
```
