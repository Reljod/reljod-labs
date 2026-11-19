# Tidewater Bank fixtures

The bank has no document fixtures: its sample data is the seed world every Owner's bank opens with, written by `src/features/bank/core/seed.ts`. Everything is fictional (the Republic of Meridia, the Meridian florin) and play money.

- **Staff**: Ines Maro (teller), Tomas Vell and Renske Aldo (supervisors), Odile Karn (compliance).
- **Customers**: Mara Voss (salary, rent, card spending, a savings habit), Joren Pike (a house fund, a 6-month term deposit, a car loan two instalments in), Selin Aro (new, identity pending), Tavi Dunmore of Dunmore Bakery (weekly takings and suppliers, high risk).
- **Things to try on purpose**: Tavi's payee "Old Mill Supplies" has an account number ending `0000`, which the simulated rail returns as "account closed"; a number ending `9999` is returned as "no such account". A first payment of MRF 2,000 or more to a payee added in the last two days is held for review. A payment of MRF 10,000 or more needs a second supervisor.

Statements are generated from the ledger and downloaded as PDF or CSV built in the browser (`domain/statement-files.ts`); every PDF carries a SPECIMEN watermark.
