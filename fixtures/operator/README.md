# Operator samples

Everything here is invented for the Operator demo. The port is the Port
Authority of Meridia, in the fictional Republic of Meridia; no vessel, agent,
consignee, container or release order is real. Every file is marked SPECIMEN.

## What a sample Task is

A sample Task (`src/features/operator/domain/tasks.ts`) is a brief in plain
words, the Fixture it starts from, the changes a correct Run makes to the
Books, the traps on the way and a Script that does it correctly.

| Task | What is asked | Traps |
| --- | --- | --- |
| `arrival-corvina` | Register MV Corvina, key its six manifest lines, hold one container for X-ray | Dates are DDMMYY, F10 files the arrival, fields cut what does not fit |
| `release-and-berth` | Release a customs hold, book berth B03 for MV Halcyon Tern | Release needs a person, the berth record is in use by CLERK07 twice |
| `manifest-correction` | Delete a duplicate line, correct a gross weight | The line is on page 2, delete needs a person, only the weight may change |

## The Books

Every Fixture starts from the same Books, `src/features/operator/legacy/base-books.ts`:
10 vessels, 45 manifest lines on 5 voyages (voyage 0377E has 16, so its list
runs to a second page), 4 customs holds and 7 berth bookings. Container
numbers carry a valid ISO 6346 check digit.

## Manifest files

`public/operator/samples/corvina-0412n.csv` is the manifest of the first
Task, served at `/operator/samples/corvina-0412n.csv`. It is byte for byte
the `text` of that Task's `manifest`; `tasks.test.ts` checks it. Change the
two together.

The format, read by `parseManifest` (`src/features/operator/domain/manifest.ts`):

- lines starting with `#` are comments; the first says
  `# SPECIMEN - Port Authority of Meridia - cargo manifest`
- `vessel,<name>` and `voyage,<number>`
- a header row `container,iso_type,seal,gross_kg,pol,consignee,haz,goods`
- one row per container; `goods` is last and is quoted when it holds a comma

The sample carries what a clerk meets on paper: one container written with
spaces (`MRDU 482113 1`) and one goods description longer than the 24
characters HARBOURMASTER keeps.
