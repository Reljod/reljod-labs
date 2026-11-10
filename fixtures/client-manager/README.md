# Client Manager sample files

Synthetic client files for the Client Manager demo, to drag into the Intake form. They match the two example Intakes in `src/features/client-manager/domain/examples.ts` and add detail the notes leave out (account numbers, positions, dates, co-owners, a second company, insurance), so the extracted graph gets richer.

Every person, company, bank and place is fictional and set in the Republic of Meridia; money is in Meridian dollars (M$). Every PDF page carries a diagonal SPECIMEN watermark, a "Page X of Y" footer and the line "Synthetic document for the Reljod Labs Client Manager demo. Not a real record." The spreadsheet carries the same line in its last row.

The rendered files are served from `public/client-manager/samples/<client>/` and listed in `src/features/client-manager/domain/sample-files.ts`.

## Rafael Okoro (`rafael-okoro/`)

| File | Pages | What it is |
| --- | --- | --- |
| `brokerage-statement.html` → `.pdf` | 3 | Northgate Securities quarterly statement, Q3 2026, account NGS-4471-0928-3. Summary, holdings (two index funds, two bonds, a bond fund, cash; M$1,204,540 in total), 10,560,000 restricted Lumen Freight shares in a custody-only sub-account, cash transactions (including M$60,000 to Okoro Ventures Ltd), standing instructions (no beneficiary on death), disclosures. |
| `cap-table-summary.html` → `.pdf` | 3 | Lumen Freight Holdings Ltd register extract and fully diluted cap table at 30 June 2026: his 22.00% (M$132M at the M$12.50 Series C price), co-founder Mireille Danso, three VC leads, option pool, financing history, quarterly re-vesting of 1,200,000 shares to Dec 2027, lock-up to 31 March 2027, permitted M$15M secondary, and his holding company Okoro Ventures Ltd. |
| `mortgage-statement.html` → `.pdf` | 2 | Halvard Building Society statement, 1 May to 31 October 2026, for 14 Aster Rise, Kestrel Heights. Joint borrowers Rafael and Ada Okoro, balance M$1,887,183.30, fixed to 31 August 2028, early repayment charges, buildings insurance. |
| `life-insurance-policy.html` → `.pdf` | 2 | Corvane Life policy schedule: M$8M level term cover to 2042 with M$1M critical illness, Ada as primary beneficiary and the three children as contingent beneficiaries, not written in trust, plus a M$5M key person policy owned by Lumen Freight. |
| `angel-portfolio.xlsx` | 1 sheet | Okoro Ventures Ltd workbook of the four angel investments: Pallas Bio, Brightwater Robotics, Fennick Pay and Tallis Learning. Columns: company, sector, date, amount, instrument, terms, stake %, status, valuation basis, estimated value, notes. M$575,000 invested. |

**Deliberate inconsistency:** the mortgage statement shows the fixed rate as **4.15%**. The Intake note says 4.1%.

## Elena Marsh (`elena-marsh/`)

| File | Pages | What it is |
| --- | --- | --- |
| `private-bank-statement.html` → `.pdf` | 3 | Calder Private Bank consolidated statement, Q3 2026, client CPB-208114. Current account, Premier Reserve, 95-day notice account and two term deposits (M$9,008,963 in total). It records the joint accounts with Daniel re-registered in her sole name on 22 May 2026, the M$620,000 pension death benefit, a M$25,000 gift to Tidewatch Trust, a gift to Ivy, maturities and the expected escrow release. |
| `share-sale-completion.html` → `.pdf` | 2 | Nair & Cole completion statement for the sale of Marsh Dynamics Ltd to Brennock Marine Group plc on 30 September 2025. Headline M$18M: M$14.4M at completion, M$1.8M escrow to 31 March 2027, up to M$1.8M earn-out. Daniel 60%, Elena 40%, funds flow and post-completion terms. |
| `property-schedule.html` → `.pdf` | 2 | Nair & Cole schedule of real property: Linden House, Henlow (title MR-HN-118204), Gull Cottage, Saltmere (tenants in common with Daniel, intended for Ivy), mooring SH-114 and the yacht "Ivy May" (left to Tom), plus planning points for gifting the cottage. |
| `estate-letter.html` → `.pdf` | 3 | Letter from Priya Nair dated 28 October 2026: a one-box summary, executors (Elena and Priya Nair), the will's legacies, the estate at date of death, inheritance tax (nil, with 41% of the nil-rate band transferable), remaining steps, and an estimate of about M$7.3M tax on Elena's own estate, with recommendations (new will, powers of attorney, a giving fund in Daniel's name). |

**Deliberate inconsistency:** the property schedule lists a **M$350,000 legal charge in favour of Calder Private Bank** on the Henlow home, with no discharge registered. The Intake note says she owns the home outright, and no other document mentions a loan.

## Regenerating

The HTML files are the source. Each is self-contained (inline CSS, no web fonts or external assets).

```bash
# Only if the workbook data changes: rebuild the .xlsx with fflate
node --experimental-strip-types scripts/build-client-manager-xlsx.mts

# Print every HTML file to an A4 PDF and copy the .xlsx into public/
pnpm render:client-manager-samples
```

The render script uses Playwright's Chromium. If the bundled build is not installed, point `CHROMIUM_PATH` at another Chromium binary. After regenerating, update the byte sizes in `sample-files.ts`.
