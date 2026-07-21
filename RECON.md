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

## Booking service — `PR_MY_MODULES_V2_SRV` (from `tss.ucsd.edu.2.har`)
The booking **detail page** runs on a *different* service from the catalog — OData **v2**, not v4:
```
https://tss.ucsd.edu/sap/opu/odata/ITUS/PR_MY_MODULES_V2_SRV/
```
This is the "My Modules" (enrollment) side. Same session cookies; v2 CSRF/`$batch` conventions
(writes go in a `$batch` **changeset**, or a direct POST to a creatable entity set).

Section detail is read via a fully-keyed `ModuleHeaderSet` entity:
```
ModuleHeaderSet(SmObjid='8754',SmOtype='SM',ScObjid='00000257',
  ModregId=guid'00000000-0000-0000-0000-000000000000',
  EventPackageId='154425',AcademicYear='2026',AcademicSession='2')
```
Nav props: `/Exam /Event /Person /ModuleGroup /WebLink /IndividualWork /Information /Template`.
Live values seen for CSE-103 (module 8754):
`ModregId=0000…` (not booked), `SmStatus='00'` ("Waitlist Inactive"), `OnWishList=False`,
`OpenSeats=192`, `RegistrationBeginDate=2026-07-22`, `RegistrationEndDate=2026-12-04`.

### Why the Book write STILL isn't captured
The capture was taken **2026-07-21, before `RegistrationBeginDate` (07-22)** — the window wasn't
open, so the Book button was inert. No POST/MERGE/PUT changeset appears anywhere in this HAR.
**Next capture:** a HAR taken *after* the window opens, clicking Book / Add-to-Waitlist.

### Writable now: `WishListSet`
Of all 31 entity sets, SAP's `sap:creatable/updatable/deletable` flags mark **only `WishListSet`
as writable** (everything else read-only). Key = `SmObjid` (module ID). This is a server-side
wishlist/cart we can POST to *today*, pre-registration — a real "planned, not enrolled" cart that
persists on UCSD's servers (unlike our local `chrome.storage`). Fields incl. `Priox` (priority),
`Credits`, `SmStatus`, `OnWishList`.

### The bridge ID: `EventPackageId` == catalog `EventPkgObjid`
Booking is keyed by numeric **`EventPackageId`** (e.g. `154425`) + `SmObjid`,`SmOtype='SM'`,`ScObjid`
(program; `'00000000'` works for a program-agnostic read),`AcademicYear`,`AcademicSession`. That
numeric ID is **already in the catalog `_sections` payload** as `EventPkgObjid` (`'154425'`;
`EventPkgOtjid`/`EventPkgDisplayID` are the prefixed `'SE00154425'` form) — no extra lookup needed.
So live status for a section is a plain credentialed GET (reads need no CSRF):
```
GET /sap/opu/odata/ITUS/PR_MY_MODULES_V2_SRV/ModuleHeaderSet(
  SmObjid='<ModuleID>',SmOtype='SM',ScObjid='00000000',
  ModregId=guid'00000000-0000-0000-0000-000000000000',
  EventPackageId='<EventPkgObjid>',AcademicYear='<year>',AcademicSession='<period>')?sap-client=500
Accept: application/json   →  {"d":{ OpenSeats, OpenSeatsWaitlist, SmStatusText,
                                     RegistrationBeginDate:/Date(ms)/, ... }}
```
This is wired into the sections view (`TssClient.getLiveStatus`). Note `AcademicSession` is `'2'`
here but zero-padded to `'002'` on `EventPackageSet`; v2 dates are `/Date(<epoch-ms>)/` (UTC).

Other enrollment-relevant sets (all read-only here, likely populated during a booking changeset):
`BookingCheckLogSet` (prereq/rule check results), `ActionHdrSet`/`ActionItmSet`
(`ActionName`,`Cancel`,`ModregId`,`TemplateId` — the submit-book/cancel payload shape),
`RequestSet` (messages).

## Gaps / next capture
- **Booking action** — the actual write op is still unmapped (reg window opened the day after
  capture, 2026-07-22). Need a HAR of a real Book / waitlist / add-to-wishlist click. Until then,
  "assisted booking" = deep-link/hand off into TSS's own booking UI. Buildable now from the above:
  a real `WishListSet` write, and live seat/waitlist/registration-window status per section.
- **Term codes** — confirm the full `AcademicPeriod` ↔ quarter mapping (1=?, 2=Fall, 3=?…).
- **Rate limits / anti-automation** on repeated section polling — unknown; poll conservatively.

## Data model (normalized target)
```
Course {year, period, moduleID, dept, abbr, title, units, level}
  Section {eventPkgText, limit, seatsAvailable, waitlist, capacityColor}
    Meeting {method, days[], start, end, mode, location, instructor, isFinal}
```
