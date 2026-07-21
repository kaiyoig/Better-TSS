# Better TSS

Plan your courses in **TSS** the way you did in **WebReg** — a Chrome extension that overlays a
WebReg-style manual schedule planner on UCSD's new registration system (Triton Student System,
`tss.ucsd.edu`).

WebReg let you build a schedule yourself and enroll when your window opened. TSS replaced that with
guided, one-course-at-a-time planning. Better TSS brings back the old workflow: search the catalog,
build a weekly schedule, and catch conflicts before you book — reading the same data TSS's own UI
uses, over your existing logged-in session.

> **Planning only.** Better TSS never enrolls you or touches your account. You still book in TSS.

## Download & install (no build needed)

1. **[⬇ Download better-tss.zip](https://github.com/kaiyoig/Better-TSS/releases/latest/download/better-tss.zip)** (always the latest build).
2. Unzip it somewhere permanent (not your Downloads/temp folder — Chrome loads it from that path).
3. Open `chrome://extensions`, turn on **Developer mode** (top-right), click **Load unpacked**, and
   select the unzipped folder.
4. Open a `tss.ucsd.edu` tab and click the floating **📅 Planner** button.

To update later, download the zip again and reload the extension. (Building from source instead?
See [below](#install-from-source).)

## Features

- **Course search** — full-text search of the Schedule of Classes. Loose codes auto-normalize, so
  `CHEM 7L` finds `CHEM-007L`. A single match loads its sections automatically.
- **Sections browser** — seats, capacity indicator, and waitlist per section, with:
  - **Live status** — real-time open seats, open waitlist seats, and the registration window
    (opens / open / closed) pulled straight from TSS's booking service.
  - **Conflict flags** — names the exact clashing part, e.g. "Time conflict with CSE-103 Discussion".
  - **One section per course** — pick a lecture+discussion package once; other sections offer a
    one-click **Switch** instead of letting you double-book the same course.
- **Weekly calendar** — a WebReg-style grid with time, course, part (LE/DI/LA) + location, and
  instructor on each block; side-by-side lanes for overlaps; per-block conflict highlighting; unit
  totals; and notes for things that don't sit on the grid (midterms/finals, and labs with no set
  time yet — shown as **TBA** rather than left blank).
- **List view** — the familiar WebReg table, including exam rows (Final / Midterm).
- **Finals view** — a full finals-week grid plus any TBA finals.
- **Switch / Drop** on every tab — change a course's section or remove it from any view.
- **Saved plans** — keep multiple named schedules; they persist locally in your browser.

## Install from source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run build     # type-checks, then builds into dist/
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` folder.

## Usage

1. Open a `tss.ucsd.edu` tab and sign in as usual.
2. Click the floating **📅 Planner** button (bottom-right) or the extension's toolbar icon.
3. Search a course, add sections, and switch between the Calendar / List / Finals tabs.

After changing the code, run `npm run build` again, reload the extension at `chrome://extensions`,
and refresh the TSS tab.

## Privacy

Better TSS runs entirely in your browser and makes the same requests TSS's own pages already make,
reusing the session you're logged into. It never sees or stores your password, and it sends your
data nowhere — saved plans live only in `chrome.storage.local` on your machine.

## Status

Working as an unpacked extension against a live TSS session; the build is green (TypeScript strict,
no runtime dependencies). Booking is intentionally not implemented — Better TSS is a planner, and
you complete enrollment in TSS itself.

See [CLAUDE.md](CLAUDE.md) for architecture and [RECON.md](RECON.md) for the reverse-engineered TSS
API this is built on.
