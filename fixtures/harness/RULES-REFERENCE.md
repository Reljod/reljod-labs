# Cayman Islands private-sector pension rules: reference for the Pensions Operations Desk demo

**Status:** research note for a software demo about a fictional bank. It is not legal advice and must not be used to decide a real pension case.
**Date of research:** 2026-11-17. Every "current" statement below means "as far as the sources read on that date show".
**Scope:** private-sector plans under the National Pensions Act. Civil servants fall under the Public Service Pensions Act and are out of scope.
**Regulator:** the Director of Labour and Pensions (Department of Labour and Pensions, "DLP"). CIMA is not the pensions regulator; the only CIMA link found is that some administrators hold CIMA trust licences (S16).

## How to read this note

- Confidence labels: `verified-primary` (read in the Act, regulations, a Bill, or a DLP document), `verified-secondary` (read only in a law-firm note, news report, provider document or guide), `unverified` (no reliable source found, or the value is a demo design choice).
- Each rule cites a source key (S1 to S22) plus the section. The key table below gives the name, URL and date of each source.
- "The Act" is the National Pensions Act (2024 Revision), which consolidates amendments up to Act 23 of 2023 and is revised as at 31 December 2023. No amending Act after 2023 was found; DLP documents dated September 2026 still cite the 2024 Revision.
- Money is in Cayman Islands dollars, written "CI$" in the statute and DLP documents.

### Caveats that apply to the whole note

1. The Act was read from a copy hosted on a government site (procure.gov.ky), not from legislation.gov.ky, which could not be searched directly.
2. The General Regulations were read as the **2011 Revision** plus the **2017 amending regulations as tabled** (an undated draft). The DLP lists a **2018 Revision** as current; its text was not retrieved. Regulation numbers and periods below should be checked against the 2018 Revision.
3. Three Cabinet Orders that matter were not retrieved as text: the Normal Age of Pension Entitlement Option Order, 2016; the Order setting the time for refund applications under s.53(7); and the 2016 Commencement Order. Their effect is taken from DLP and law-firm summaries.
4. Pages on rfgroup.com and caymancompass.com refused automated fetches (HTTP 403). Nothing from them is quoted; where a fact comes only from a search-result summary of such a page, it is marked as that.

### Source keys

| Key | Source | URL | Date |
|---|---|---|---|
| S1 | National Pensions Act (2024 Revision) | https://www.procure.gov.ky/upimages/commonfiles/1751266504NationalPensionsAct2024Revision_1751266507.pdf | Revised as at 31 Dec 2023; gazetted 8 Feb 2024 |
| S2 | National Pensions (General) Regulations (2011 Revision) | https://caymanlawschool.ky/n0c-storage/legislation2/national_pensions_general_regulations_2011_revision.pdf | 31 Jul 2011 |
| S3 | National Pensions (General) (Amendment) Regulations, 2017 (as tabled, undated draft) | https://parliament.ky/wp-content/uploads/2022/05/12436412.pdf | 2017 |
| S4 | DLP "FAQ National Pensions Act (2024 Revision)" | https://gov.ky/documents/35692/0/FAQ+National+Pensions+-+September+2026+Revised.pdf (page: https://gov.ky/w/national-pensions-faq) | Updated Sep 2026; published 14 Sep 2026 |
| S5 | DLP "FAQ Property Withdrawal" | https://gov.ky/w/dlp-property-withdrawal-faqs | Updated Nov 2025; published 24 Feb 2026 |
| S6 | DLP Pensions Investigation Unit page | https://gov.ky/web/dlp/pensions-investigation-unit | Undated; read 17 Nov 2026 |
| S7 | DLP Guidance Note Part 2 for Pension Plan Administrators, National Pensions (Amendment) Act, 2023 (copy hosted by a plan administrator) | https://ky.cgcoralisle.com/wp-content/uploads/sites/6/2024/09/Guidance-Note-Pension-Plan-Administrators-30-December-2023-1.pdf | 30 Dec 2023 |
| S8 | DLP Guidance Note "Retirement Savings Arrangement Schedule effective 1 July 2026" | https://gov.ky/w/guidance-note-rsa-disbursement | 23 Jun 2026 |
| S9 | DLP Guidance Note "International Transfers" | https://gov.ky/documents/d/dlp/overseas-transfers | Revised 4 Jun 2021 |
| S10 | DLP forms "Individual Transfer Request – Defined Contribution Plan" and "Supplemental Form – International Transfer Questionnaire" | https://gov.ky/w/guidance-note-individual-transfer-request-form and https://gov.ky/w/guidance-note-individual-transfer-request-form-supplemental | Published 19 Oct 2023 |
| S11 | DLP Guidance Note "Access to Additional Voluntary Contributions" | https://gov.ky/w/guidance-note-access-to-additional-voluntary-contributions-avc- | Revision May 2017 |
| S12 | National Pensions (Amendment) Act, 2016 (Commencement) Order, 2022 (SL 55 of 2022) | https://caymanlawschool.ky/n0c-storage/legislation3/national-pensions-amendment-act-2016-commencement-order-2022.pdf | 13 Dec 2022 |
| S13 | DLP brochure "Know the National Pensions (Amendment) Law, 2016" (copy hosted by a plan administrator) | https://ky.cgcoralisle.com/wp-content/uploads/sites/6/2024/09/Know-the-National-Pensions-Amendment-Law-2016-a__-Information-and-FAQa__s-for-Employers-Employees.pdf | Feb 2017 |
| S14 | National Pensions (Amendment) Bill, 2020 (as introduced; enacted as Law 12 of 2020) | https://parliament.ky/wp-content/uploads/2022/05/12946587.pdf | 22 Apr 2020 |
| S15 | Bedell Cristin, "Cayman pension updates: the really useful guide" | https://www.bedellcristin.com/knowledge/briefings/cayman-pension-updates-the-really-useful-guide | 7 Dec 2023 |
| S16 | Coralisle (BritCay) pension FAQ and Termination/Withdrawal Form | https://ky.cgcoralisle.com/faq/pensions/ and https://ky.cgcoralisle.com/wp-content/uploads/sites/6/2023/03/BCI_Pension_Custodian_TerminationWithdrawal_0820f.pdf | FAQ undated; form Rev. 08-20 |
| S17 | Solomon Harris / Bedell Cristin, "Five dates for Cayman Island pension law changes in 2017" | https://www.legal500.com/intelligence/cayman-islands/employment-and-hr/five-dates-for-cayman-island-pension-law-changes-in-2017 | 24 May 2017 |
| S18 | "CITA Presentation: Commencement of National Pensions (Amendment) Law" slides (third-party upload) | https://api.sambuz.com/doc/cita-presentation-ppt-presentation-425817 | 13 Dec 2016 |
| S19 | Radio Cayman (government), "New guidelines for pension refunds"; Cayman News Service, "Rules change on pension refunds" | https://radiocayman.gov.ky/news/new-guidelines-for-pension-refunds ; https://caymannewsservice.com/?p=68541 | 13 Dec 2019 ; 12 Dec 2019 |
| S20 | Radio Cayman (government), "Emergency pensions withdrawal final figures" | https://www.radiocayman.gov.ky/news/emergency-pensions-withdrawal-final-figures | 19 Apr 2021 |
| S21 | Caymanian Times, "DLP probes pace of pensions payout"; Cayman News Service, "Pension firms face 14,000 requests in a week" | https://www.caymaniantimes.ky/news/dlp-probes-pace-of-pensions-payout ; https://caymannewsservice.com/?p=73828 | 29 Jun 2020 ; 6 May 2020 |
| S22 | Cayman Resident, "Private (non-government) pensions" | https://caymanresident.com/work/pension-requirements/private-non-government-pensions | Updated 30 Jan 2026 |

---

## 1. Who must be covered and when

### 1.1 Employees in the age range are members

- **Rule:** Every employee between age 18 and the normal age of pension entitlement must be a member of a pension plan, and every employer in the Islands must provide or contribute to one.
- **Values:**
  - `min_age: 18`
  - `max_age: normal age of pension entitlement (65; see 4.1)`
  - `part_time_covered: true`
  - `multiple_employers: each employer contributes`
- **Source:** S1 s.4(1), s.25(1), s.25(4); S4 p.3.
- **Confidence:** `verified-primary`
- **Notes:** S4 states the range as "between 18 and 65". Part-time employees and interns aged 18 or over who are paid earnings are covered (S4). Penalty for an employer with no plan: CI$20,000 or 2 years (first offence), CI$50,000 or 3 years (second), CI$100,000 or 5 years (third), S1 s.4(4).

### 1.2 The nine-month rule for non-Caymanians

- **Rule:** An employer need not cover an employee who is neither Caymanian nor a permanent resident until that employee has worked in the Islands for a continuous period of more than nine months.
- **Values:**
  - `non_caymanian_waiting_period: 9 months continuous work in the Islands`
  - `caymanian_or_pr_waiting_period: none (pensionable immediately, probation irrelevant)`
  - `continuous: breaks under 6 months do not interrupt (definition of "continuous")`
- **Source:** S1 s.25(2)(a), s.3 ("continuous"); S4 p.3; S6.
- **Confidence:** `verified-primary`
- **Notes:** The Act says "nine months or less". S4 adds that the nine months need not be with one employer and that later probation periods do not restart it. **Pending change:** s.18(2)(i) of the 2016 Amendment Act would cut nine months to six; the 2024 Revision footnote says it "has not yet commenced". No commencement was found as of the research date.

### 1.3 Exemptions

- **Rule:** Three groups are outside mandatory coverage: Caymanians under 23 in full-time education, non-Caymanian household domestics, and non-Caymanians inside the nine-month period.
- **Values:**
  - `student_exemption: Caymanian AND under 23 AND in full-time education (all three)`
  - `household_domestic_exemption: non-Caymanian, non-PR, employed as a household domestic (for example domestic worker or gardener)`
- **Source:** S1 s.3 ("employee"), s.25(2)(b); S4 p.3; S13.
- **Confidence:** `verified-primary`
- **Notes:** The student exemption works by excluding the person from the definition of "employee". Both exemptions took effect on 1 March 2017 (S17, S18, secondary).

### 1.4 Self-employed persons

- **Rule:** Every self-employed person must belong to an approved pension plan or contribute to an individual pension entitlement account with an approved provider.
- **Values:**
  - `self_employed_covered: true`
  - `self_employed_rate: 10% of earnings up to YMPE`
  - `self_employed_frequency: at least monthly`
- **Source:** S1 s.25(3), s.47(2); S2 reg.29(3); S4 p.4.
- **Confidence:** `verified-primary`
- **Notes:** Self-employed earnings are "prescribed and calculated in accordance with the regulations" (S1 s.3); the calculation was not researched.

### 1.5 After the normal age of pension entitlement

- **Rule:** Once an employee reaches 65, neither employee nor employer must contribute; anything either pays after that is an additional voluntary contribution.
- **Values:**
  - `mandatory_contributions_stop_at: 65`
- **Source:** S4 pp.6-7; S1 s.47(8)(c).
- **Confidence:** `verified-primary`
- **Notes:** S16 says a member born on or before 31 Dec 1969 who took benefits at 60 and returns to work resumes mandatory contributions until 65 (secondary, one provider).

---

## 2. Contribution rates and earnings

### 2.1 Rates

- **Rule:** The employer must pay 10% of each employee's earnings into the plan and may deduct up to 5% of earnings from the employee, so the standard split is 5% employer and 5% employee.
- **Values:**
  - `employer_rate_min: 5%`
  - `employee_rate_max_without_consent: 5%`
  - `total_rate: 10%`
  - `employer_may_pay_more: true (employee share then falls so the total is 10%)`
  - `employer_may_recover_own_share_from_employee: false`
- **Source:** S1 s.47(3)(a)-(c), s.47(5), s.47(9); S4 p.4; S6.
- **Confidence:** `verified-primary`
- **Notes:** These are the defined-contribution rules. A defined-benefit plan follows its actuarial report, with the member capped at 5% (s.47(3)(d)). An employee cannot refuse the deduction (S4). An employer cannot pay the contribution to the employee instead of the plan (S4).

### 2.2 Year's Maximum Pensionable Earnings (YMPE)

- **Rule:** Mandatory contributions apply only to earnings up to the year's maximum pensionable earnings.
- **Values:**
  - `ympe: CI$87,000 per year`
  - `ympe_effective_from: 2017-01-01`
  - `ympe_before: CI$60,000`
  - `above_ympe: treated as additional voluntary contributions`
- **Source:** S1 s.3 ("year's maximum pensionable earnings"); S4 p.4; S6 (figure). Effective date and prior figure: S13, S17, S18.
- **Confidence:** figure `verified-primary`; effective date `verified-secondary`
- **Notes:** Cabinet may set another amount by Order; none was found. S4 (Sep 2026) still says CI$87,000. The Act defines the cap per year; a monthly cap of CI$7,250 and a maximum monthly contribution of CI$362.50 per side are arithmetic from 87,000 / 12 and are not stated in any source, so how a plan applies the cap within a year is `unverified`.

### 2.3 Year's Basic Exemption

- **Rule:** No basic exemption (floor) was found; contributions apply from the first dollar of earnings.
- **Values:**
  - `basic_exemption: none found`
- **Source:** S1 s.3, s.47 (no floor appears).
- **Confidence:** `verified-primary` (absence in the Act as read)

### 2.4 What counts as earnings

- **Rule:** Earnings are wages, salary, leave pay, fees, commissions, gratuities and certain bonuses paid in consideration of employment.
- **Values:**
  - `included: wages, salary, leave pay, fee, commission, gratuity, bonus (see note)`
  - `excluded: severance payments, normal pension entitlement payments, long service recognition payments, health insurance premiums`
  - `bonus_test: "to the extent that the bonus is equivalent to more than twenty per cent of the employee's basic salary or wage for the period in question"`
- **Source:** S1 s.3 ("earnings"); S4 p.4.
- **Confidence:** `verified-primary`
- **Notes:** The bonus wording is ambiguous: it can be read as "only the part above 20% of basic pay" or "the whole bonus once it exceeds 20%". S4 says only "some bonuses"; S16 says "bonuses over 20% of basic pay count". A rules engine should make the reading a parameter.

### 2.5 Additional voluntary contributions (AVCs)

- **Rule:** A member may pay AVCs at any time before normal pension entitlement, and may withdraw them early for four purposes.
- **Values:**
  - `avc_purposes: medical (not covered by insurance, not elective), temporary unemployment, housing, education (member, or dependent child under 23 in full-time education)`
  - `avc_unemployment_window: the 6 months that follow the first 3 months after termination`
  - `avc_access_limit: 4 times per calendar year`
  - `avc_repayment: none`
  - `avc_at_65: may be paid as a lump sum`
  - `avc_admin_report_to_dlp: monthly, due by the 10th`
- **Source:** S1 s.47(8)(d), s.47(10)-(12); S3 reg.17A; S11; S4 p.6.
- **Confidence:** `verified-primary`
- **Notes:** In force since 31 March 2017 (S11). S11 (May 2017) says AVCs cannot be used for a partial mortgage payment; the Act as amended on 9 Dec 2023 now allows a "reduction payment" from AVCs (s.47(10)(c)(iii)), so S11 is out of date on that point. Supporting documents per purpose are listed in S11 (insurer letter; termination letter dated within 9 months; purchase agreement, land register, quote or lender letter; acceptance letter from the school).

---

## 3. Remittance deadline and delinquency

### 3.1 Contribution date deadline

- **Rule:** Contributions for a month in which the employee worked must reach the plan on or before the 15th day of the following month, regardless of pay period.
- **Values:**
  - `contribution_due_day: 15`
  - `contribution_due_month_offset: +1 (month after the service month)`
  - `cutoff: close of business on the deadline`
- **Source:** S1 s.48(2)-(3); S2 reg.29(2); S4 p.4; S6.
- **Confidence:** `verified-primary`
- **Notes:** Example in S4: April contributions are due by 15 May. The regulation's older wording is "within fifteen days after the last day of the month". The Act says nothing about a deadline falling on a weekend or public holiday (`unverified`).

### 3.2 Delinquent contribution

- **Rule:** A contribution not received by close of business on the deadline is a delinquent contribution, and the administrator must immediately act to collect it with accrued interest.
- **Values:**
  - `delinquent_from: day after the contribution date deadline`
  - `administrator_action: immediate collection effort; keep a record of each effort`
- **Source:** S1 s.48(3)-(4); S3 reg.10D.
- **Confidence:** `verified-primary`
- **Notes:** Permitted efforts include contacting the member or employer and negotiating payment on terms approved by the Director (S3 reg.10D). These delinquency provisions (sections 29 and 30 of the 2016 Amendment Act) came into force on **1 July 2023** (S12; S15).

### 3.3 Reporting to the Director

- **Rule:** A delinquent contribution still unpaid on the 15th of the month after the deadline must be reported in writing to the Director by the 20th of that month, in the Director's form.
- **Values:**
  - `reportable_date: 15th of month +2 (one month after the deadline)`
  - `delinquent_notification_date: 20th of month +2`
  - `report_form: form approved by the Director`
  - `days_late_at_reportable_date: about 28 to 31 calendar days`
- **Source:** S1 s.48(5)-(6)(a).
- **Confidence:** `verified-primary`
- **Notes:** Month offsets are counted from the service month: service in April, due 15 May, reportable 15 June, notify Director by 20 June. This reading follows the Act's words "the month next following the contribution date deadline"; no DLP worked example was found.

### 3.4 Telling the affected employees

- **Rule:** The administrator must notify the affected employees in writing within 60 days of notifying the Director, and may publish the names of delinquent employers.
- **Values:**
  - `employee_notification_deadline: 60 days after the Director is notified`
  - `electronic_notice: allowed with the employee's written consent`
- **Source:** S1 s.48(6)(b), s.48(8); S13.
- **Confidence:** `verified-primary`

### 3.5 Interest on late contributions

- **Rule:** The employer owes the fund interest at the current Cayman prime rate plus five percentage points, calculated daily, starting the day after the deadline.
- **Values:**
  - `late_interest_rate: prime + 5%`
  - `late_interest_basis: daily`
  - `late_interest_start: day after the contribution date deadline`
- **Source:** S1 s.50(1)-(3); S4 p.4.
- **Confidence:** `verified-primary`
- **Notes:** The administrator must check that interest was calculated correctly and credited to the employee's account (s.50(3)). The prime rate value itself was not sourced (`unverified`); S6 says an interest calculator is "to be released".

### 3.6 Director's enforcement and penalties

- **Rule:** By the 20th of the month after the notification date the Director must start recovery, using a demand letter, a summons to explain, a delinquency collection fee, court proceedings or publication.
- **Values:**
  - `director_action_deadline: 20th of month +3`
  - `demand_letter_window: payment within 14 days of the letter`
  - `delinquency_collection_fee: greater of 10% of the amount delinquent or CI$50 per day, from the deadline until paid`
  - `employer_offence: fine CI$20,000 or 2 years, or both`
  - `limitation: summary proceedings within 5 years of the report to the Director`
- **Source:** S1 s.48(9), s.48(12), s.90(3).
- **Confidence:** `verified-primary`
- **Notes:** The administrator's extra reporting costs are borne by the employer, not the plan (s.48(11)). An employee may report an employer directly to the Director (s.48(15)). Employer contributions due and unpaid are held on trust, and the administrator has a lien on the employer's assets for them (s.49).

---

## 4. Retirement

### 4.1 Normal age of pension entitlement

- **Rule:** The normal age of pension entitlement is 65, except that a person who reaches 60 within the period set by Cabinet Order may opt for 60.
- **Values:**
  - `normal_age: 65`
  - `normal_age_effective_from: 2017-01-01`
  - `normal_age_before: 60`
  - `age_60_option: persons who reach 60 between 2017-01-01 and 2029-12-31 (born on or before 1969-12-31)`
- **Source:** S1 s.3 ("normal age of pension entitlement"); S4 p.6. Option window and dates: S17, S18, S16.
- **Confidence:** age 65 and the existence of the option `verified-primary`; the option window `verified-secondary`
- **Notes:** The Order's text was not retrieved. Sources describe the cut-off differently: S4 says "born prior to 1969"; S16 says "born before 31st December 1969"; S18 says a person who attains 60 between 1 Jan 2017 and 31 Dec 2029; S17 says aged 48 or over in 2017. The S18 window is the most precise and is consistent with the others. A demo should store the date of birth cut-off as a parameter.

### 4.2 Normal pension entitlement date and first payment

- **Rule:** The entitlement date is no later than three months after reaching the normal age, and the first instalment is due no later than the first day of the following month unless the member elects otherwise.
- **Values:**
  - `entitlement_date_latest: normal age + 3 months`
  - `first_instalment_latest: first day of the month after the entitlement date`
- **Source:** S1 s.26(1), s.26(3).
- **Confidence:** `verified-primary`
- **Notes:** A member who keeps working may elect to keep accruing (s.26(4)).

### 4.3 Early pension entitlement

- **Rule:** A member who has terminated employment may elect an early pension within ten years of the normal pension entitlement date.
- **Values:**
  - `early_age: 55 (normal age 65)`
  - `early_age_for_age_60_group: 50`
  - `requires: employment terminated (inactive member, or active member on termination)`
  - `election: in writing, signed, delivered to the administrator`
- **Source:** S1 s.33(1)-(2), s.33(6); S4 p.6; S16.
- **Confidence:** `verified-primary`
- **Notes:** Disagreement: S4 (Sep 2026) says persons born before 1969 may still use an early age of 50; S8 (Jun 2026) says the early age "is now age 55, for all persons" and drops ages 50 to 54 from the drawdown table. In practice everyone in the age-60 group is 56 or older by 2026, so the point is moot for new cases.

### 4.4 Benefit options at retirement

- **Rule:** At the normal age a member either buys an annuity from an approved insurer or moves the balance to a Retirement Savings Arrangement (RSA) with the administrator; the balance is not paid as a lump sum.
- **Values:**
  - `options: annuity from an insurer approved by the DLP; RSA`
  - `lump_sum_of_mandatory_balance: not available (see 4.6 for small balances)`
  - `avc_lump_sum_at_normal_age: allowed`
  - `ill_health: plan may pay greater benefits where life expectancy is reduced by disability`
- **Source:** S4 p.6; S1 s.34(1)(a), s.40, s.57; S8.
- **Confidence:** `verified-primary`
- **Notes:** Every pension paid to a member with a spouse or civil partner is a joint and survivor pension at 100% (s.36(1)). A refund at the normal age is possible only where the member proves the benefit cannot be transferred to a plan, RSA or annuity, on the administrator's application and with the Director's approval (s.53(2)-(3)).

### 4.5 RSA drawdown limits

- **Rule:** Each calendar year an RSA holder may withdraw up to an age-based percentage of the account value, or CI$16,200 if that is higher.
- **Values:**
  - `rsa_annual_floor: CI$16,200 (CI$1,350 per month)`
  - `rsa_floor_effective_from: 2026-07-01`
  - `rsa_previous_floor: CI$15,400`
  - `rsa_age_basis: age at the start of the calendar year of payment`
  - `rsa_pct_examples: 55 = 4.45%, 60 = 4.73%, 65 = 5.11%, 70 = 5.68%, 75 = 6.51%, 80 = 7.66%, 85 = 9.38%, 89 = 11.36%`
  - `rsa_unused_allowance: cannot be carried to a later year`
  - `rsa_full_lump_sum: from age 89, with at least 60 days' written notice`
  - `rsa_exit: may terminate at any time and transfer the balance to an approved annuity`
- **Source:** S8 (full table for ages 55 to 102).
- **Confidence:** `verified-primary`
- **Notes:** The floor has risen over time: CI$12,480 from 9 Jan 2017 (S18); CI$15,400 until 30 June 2026 (S8 implies it through the CI$800 top-up; S22 confirms). Members whose RSA was approved before January 2017 on a more generous schedule keep it (S8). Applications received from 1 Jan 2026 get the new floor at the next disbursement.

### 4.6 Small balances

- **Rule:** Where the commuted value on termination is under CI$5,000 the administrator may pay it as a single lump sum.
- **Values:**
  - `small_balance_threshold: under CI$5,000`
  - `discretion: administrator's (subject to the plan rules)`
- **Source:** S1 s.42; S4 p.6; S6.
- **Confidence:** `verified-primary`
- **Notes:** Cabinet may prescribe another sum; none was found. Provider practice: S16's form offers a cash refund "only applicable if amount does not exceed CI$5,000" and says redemption takes 6 to 8 weeks once contributions are up to date; S22 says the same. The statute says "less than", the provider form says "does not exceed".

### 4.7 Retirement paperwork deadlines

- **Rule:** The administrator must tell a member the payment options at least 60 days before the normal retirement date, and give a retirement statement within 30 days after retirement.
- **Values:**
  - `options_notice: at least 60 days before the normal entitlement date or announced retirement date`
  - `options_notice_if_late_notice: within 30 days of receiving a completed application`
  - `retirement_statement: within 30 days after retirement, or of receiving the application`
- **Source:** S2 reg.27(1)-(4); S3 reg.19 (terminology only).
- **Confidence:** `verified-primary` (2011 Revision; check the 2018 Revision)
- **Notes:** The documents a member must file to start an RSA are in a DLP "RSA Application Checklist – Normal Retirement" hosted at rfgroup.com, which could not be fetched. Required documents for retirement are therefore `unverified`.

---

## 5. Leaving Cayman

There are three separate routes, and they are often confused. The cash refund for leavers has been closed since the end of 2019.

### 5.1 Cash refund on ceasing residence (closed)

- **Rule:** A member with CI$5,000 or more can no longer take a cash refund on leaving; the refund existed until 31 December 2019 for those who met three conditions and applied in time.
- **Values:**
  - `refund_available_now: false (for balances of CI$5,000 or more)`
  - `refund_application_cutoff: 2019-12-30 (refunds end 2019-12-31)`
  - `historic_condition_1: employment terminated`
  - `historic_condition_2: no mandatory contributions for 2 years or more, and 2 years since termination`
  - `historic_condition_3: absent from the Islands for 6 months or more (stays under 3 continuous months ignored)`
  - `last_contribution_to_qualify: by 2017-12-30`
- **Source:** S1 s.53(1), s.53(4)-(5), s.53(7); S13; S19; S18.
- **Confidence:** conditions `verified-primary`; the cut-off date `verified-primary` via the DLP brochure and government radio, but the Cabinet Order itself was not read
- **Notes:** The conditions still sit in the Act at s.53(4)-(5), but s.53(7) says a person "may only apply ... within the time prescribed by Order made by Cabinet". No extension of the 2019 cut-off was found. Sources differ by one day on wording: "after December 30, 2019" (S13), "as of December 31, 2019" (S13, S18), "from 30 December 2019" (S19). The 2016 Amendment Act set this three years ahead, so members had a window from 2016 to 2019. Before the 2016 amendment the same six-month and two-year test applied with no end date (Cayman Compass, 5 May 2016, read only as a search summary).

### 5.2 Transfer to a plan outside the Islands (current route)

- **Rule:** A member may ask the administrator to transfer the balance to a pension plan, savings arrangement or life annuity outside the Islands once three conditions are all true.
- **Values:**
  - `condition_1: employment terminated`
  - `condition_2: ceased to reside, meaning absent from the Islands for 2 years or more`
  - `condition_3: no contributions by or for the member for 2 years or more`
  - `absence_counting: stays in the Islands totalling under 3 months are ignored`
  - `effective_from: 2017-12-31`
  - `regulator_approval: required (application packet goes to the DLP)`
- **Source:** S1 s.34(3)-(5); S9; S6.
- **Confidence:** `verified-primary`
- **Notes:** These conditions do not apply to transfers between registered Cayman plans (s.34(4)). S6 adds "unless the member's account value is less than CI$5,000", which points back to the small-balance route. S22 describes approval as case by case.

### 5.3 What the receiving overseas plan must be

- **Rule:** The receiving plan must lock in and fully vest the money, protect it from creditors, and bar access before age 55.
- **Values:**
  - `locked_in_and_fully_vested: required`
  - `protected_from_seizure_and_garnishment: required`
  - `earliest_access: no earlier than 10 years before the normal age (age 55)`
  - `deferred_annuity: may qualify with documentation`
- **Source:** S9; S10 (questionnaire items 2 to 13).
- **Confidence:** `verified-primary`

### 5.4 Documents for an overseas transfer

- **Rule:** The member applies to the Cayman administrator with a signed transfer form, a questionnaire completed by the receiving administrator, the receiving plan's rules, and photo ID.
- **Values:**
  - `doc_1: Individual Transfer Request form, signed by the member and by the receiving plan's administrator`
  - `doc_2: Supplemental Form (International Transfer Questionnaire), completed and signed by the receiving administrator`
  - `doc_3: full technical prospectus and/or plan document of the receiving plan`
  - `doc_4: valid government photo ID (driver's licence or passport)`
- **Source:** S9; S10.
- **Confidence:** `verified-primary`
- **Notes:** No source was found that requires proof of residence abroad, a utility bill or an affidavit of non-residence, although s.34(5) makes two years' absence a condition. How administrators evidence the absence is `unverified`. A third-party form site describes one provider's "Termination of Residence" election as witnessed outside the Islands; it is not a reliable source and is not relied on here.

### 5.5 Small balance, or staying in the plan

- **Rule:** A leaver with under CI$5,000 may be cashed out at the administrator's discretion; otherwise the member may simply stay as a deferred member.
- **Values:**
  - `small_balance_route: see 4.6`
  - `remain_in_plan: allowed (s.34(1)(b))`
  - `leaver_information: administrator must give a departing member details of how benefits can be accessed`
- **Source:** S1 s.42, s.34(1)(b), s.53(6); S16; S22.
- **Confidence:** `verified-primary` for the statute; `verified-secondary` for the 6 to 8 week practice

### 5.6 How the rules changed

| Date | Change | Source | Confidence |
|---|---|---|---|
| Before 2016 | Refund on leaving: employment ended, 6 months absent, 2 years without contributions | Cayman Compass 5 May 2016 (search summary only) | `verified-secondary` |
| 6 May 2016 | National Pensions (Amendment) Law, 2016 enacted, commenced in stages | S1 publishing details | `verified-primary` |
| 31 Dec 2017 | Overseas transfer test in s.34 takes effect (2 years absent, 2 years no contributions) | S9; S13 | `verified-primary` |
| 30 Dec 2017 | Last date for a final contribution if a refund was wanted before the cut-off | S13 | `verified-primary` |
| 30/31 Dec 2019 | Cash refunds on leaving end | S13; S19 | `verified-primary` |
| 1 May to 31 Oct 2020 | Temporary emergency withdrawal, open also to members who left on or after 1 Feb 2020 (see part 9 of this note) | S14; S20 | `verified-primary` |
| Not yet commenced | Nine-month rule to become six months | S1 s.25(2) footnote | `verified-primary` |

---

## 6. Pension for property (housing withdrawals)

All of this section is Part 7A of the Act as amended by Act 23 of 2023, in force from **9 December 2023**.

### 6.1 Who qualifies

- **Rule:** Only a Caymanian may withdraw mandatory pension money for housing, and a deposit withdrawal also requires that the person owns no dwelling unit in the Islands.
- **Values:**
  - `caymanian_required: true (Immigration (Transition) Act definition)`
  - `non_current_home_owner_required: deposit withdrawals only`
  - `primary_residence_required: dwelling purchases, construction, mortgage reduction and pay-off`
  - `joint_applicants: allowed, each up to the cap, toward one loan`
  - `unemployed_or_past_normal_age: may apply`
  - `government_pension_fund: not accessible; a civil servant's old private plan is`
- **Source:** S1 s.52B(1), s.52B(5), s.52B(13), s.52BA(1), s.52BA(15), s.52C(1), s.52C(12); S7 paras 1-4, 10; S5.
- **Confidence:** `verified-primary`
- **Notes:** A non-home-owner who owns land may still withdraw a deposit to buy residential land (s.52B(2)). S16 says the land purchaser must own no other land, which the Act as read does not say.

### 6.2 Purposes and maximum amounts

- **Rule:** The cap is CI$50,000 for a deposit or a reduction payment, and CI$100,000 to pay off a mortgage in full, measured across all the person's plans.
- **Values:**
  - `deposit_cap: CI$50,000 (buy an existing dwelling, build a new dwelling, buy residential land)`
  - `reduction_payment_cap: CI$50,000 (existing mortgage, residential land loan, plus strata fee arrears on the mortgaged property)`
  - `payoff_cap: CI$100,000 (pay off an existing mortgage so the dwelling is unencumbered, plus strata fee arrears)`
  - `aggregate_across_plans: CI$50,000 for deposit and reduction together; CI$100,000 for pay-off`
  - `max_dwelling_units: 2`
  - `avc_may_be_added: true`
  - `application_fee_max: CI$50`
  - `cap_before_2023-12-09: CI$35,000`
- **Source:** S1 s.52A, s.52B(1), s.52BA(1), s.52C(1), s.52E; S5; S7 paras 11, 18, 25. Earlier cap: Cayman Compass 25 Nov 2023 (search summary only).
- **Confidence:** current caps `verified-primary`; the earlier CI$35,000 cap `verified-secondary`
- **Notes:** "Deposit" means all money the lender requires as a condition of the loan, including legal fees and stamp duty (s.52A). A reduction payment covers principal only when the loan is in good standing, and principal plus interest arrears when it is in foreclosure (s.52A(2)). Search summaries of two news reports gave conflicting figures for the pay-off cap; the Act and the DLP FAQ settle it at CI$100,000.

### 6.3 Documents required

- **Rule:** The application uses the form in the Schedule to the Act and must be accompanied by proof of Caymanian status, the lender's approval-in-principle letter and, depending on the type, proof of title and declarations.
- **Values:**
  - `all_types: Schedule form; evidence the applicant is Caymanian; lender's letter showing approval in principle and the amount; evidence of compliance for any previous withdrawal; fee if charged`
  - `deposit_only: Part B declaration of non-current home owner`
  - `reduction_and_payoff: evidence of legal title (land register issued within the last 30 calendar days)`
  - `primary_residence: Part C declaration`
  - `strata_arrears: letter from the strata corporation certifying the arrears (Strata Titles Registration Act s.6(4))`
  - `witness: declarations witnessed by a person who is not an immediate family member`
  - `status_evidence_form: notarised copies of photo ID and status documents, plus an original affidavit covering all names used`
  - `lender_letter_must_state: applicant names; block and parcel number; sources of funding with each amount and plan; breakdown of planned use (deposit)`
  - `eligible_lenders: Class A banks, building societies, credit unions, Cayman Islands Development Bank`
- **Source:** S1 s.52B(3)-(4A), s.52BA(2)-(5), s.52C(2)-(3B), Schedule; S7 paras 12, 19, 26; S5.
- **Confidence:** `verified-primary`
- **Notes:** The 30-day land register and the notarised ID plus affidavit come from the DLP guidance note, not the Act.

### 6.4 Processing deadline

- **Rule:** The administrator must issue the cheque, payable to the financial institution, within 60 days of the application, or refuse within 7 days with written reasons.
- **Values:**
  - `payment_deadline: 60 days from submission`
  - `refusal_reasons_deadline: 7 days from submission`
  - `payee: the financial institution, never the member`
  - `administrator_offence: CI$20,000 or 2 years, plus CI$1,000 per day if continuing`
  - `monthly_report_to_director: applicants, withdrawals, repayments, refusal letters`
- **Source:** S1 s.52B(6)-(9), s.52BA(8)-(11), s.52C(5)-(8); S7 paras 13, 20, 27.
- **Confidence:** `verified-primary`
- **Notes:** The Act counts from "the application being submitted". S7 counts the 60 calendar days from when the administrator "has received all of the required documentation". A demo should record both dates.

### 6.5 Repayment

- **Rule:** After a withdrawal the member must contribute an extra 3% of earnings, starting the month after the cheque is issued, until the amount is repaid or the member reaches the normal age.
- **Values:**
  - `additional_contribution_rate: 3% of earnings (withdrawals applied for on or after 2023-12-09)`
  - `additional_contribution_rate_legacy: 1% (applications before 2023-12-09), for at most 10 years`
  - `starts: month after the cheque is issued`
  - `ends: withdrawn amount repaid, or normal age of pension entitlement, whichever is earlier`
  - `subject_to_ympe: false`
  - `employer_match: not required`
  - `lump_sum_prepayment: allowed`
  - `treated_as: mandatory contributions (not withdrawable as AVCs)`
- **Source:** S1 s.52D; S7 paras 14, 21, 28; S5.
- **Confidence:** `verified-primary`
- **Notes:** A legacy 1% withdrawal moves to 3% if the member takes another withdrawal after 9 Dec 2023 (S1 s.96(4); S7 para 8). The employee must tell the employer in writing; the employer deducts and shows the amount separately on the contribution sheet (S7).

### 6.6 Unused money, sale of the property and the land restriction

- **Rule:** Unused money goes back to the plan, a sale before full repayment triggers repayment, and the Director registers a restriction on the property.
- **Values:**
  - `unused_return_deadline: 6 months from withdrawal; 12 months if the dwelling is being built`
  - `on_sale_repay: greater of the amount withdrawn or 10% of fair market value, less additional contributions already paid`
  - `valuation_age: under 1 year`
  - `restriction: entered by the Registrar of Lands on the Director's application; removed on full repayment or sale`
  - `false_declaration_offence: CI$10,000 or 1 year`
- **Source:** S1 s.52B(4B), s.52B(10)-(12), s.52BA(12)-(13), s.52C(9)-(9A), s.52F, s.52G; S5; S7.
- **Confidence:** `verified-primary`
- **Notes:** The 12-month figure for construction and the 6-month figure for purchases appeared in different news reports as if they conflicted; the Act has both.

---

## 7. Transfers between plans on changing employer

### 7.1 The member's options

- **Rule:** A member who leaves an employer may transfer the balance to another registered plan that agrees to take it, move it to a prescribed savings arrangement, buy a deferred life annuity, or leave it where it is.
- **Values:**
  - `option_1: transfer to another registered plan (receiving administrator must agree)`
  - `option_2: prescribed pension entitlement savings arrangement (individual retirement account or RSA)`
  - `option_3: life annuity starting no earlier than the earliest pension date`
  - `option_4: remain in the plan`
  - `option_5: transfer to the Public Service Pensions plan if its Board agrees`
  - `must_join_new_employer_plan: true`
- **Source:** S1 s.34(1); S4 p.5; S2 reg.19.
- **Confidence:** `verified-primary`
- **Notes:** A member of a multi-employer plan with no contributions for 24 consecutive months may terminate active membership (s.29).

### 7.2 Time limit and penalty

- **Rule:** The administrator must comply with a transfer direction no later than 45 days after it is delivered.
- **Values:**
  - `transfer_deadline: 45 days from delivery of the direction`
  - `administrator_offence: CI$20,000 or 2 years, plus CI$1,000 per day if continuing`
  - `fee_deduction: only actual administrative expenses, provided for in the plan, approved by the Director, the same for all classes of member`
- **Source:** S1 s.34(6)-(9).
- **Confidence:** `verified-primary`
- **Notes:** S2 reg.22(9) (2011 Revision, defined benefit transfers) says payment under s.34(1) "shall be made within one hundred and eighty days of the date of termination". How that sits with the 45 days in the Act, and whether it survives in the 2018 Revision, is `unverified`. The old 90-day window for the member to elect (reg.18(1)) was repealed by S3 reg.14.

### 7.3 Form and data passed on

- **Rule:** The DLP's Individual Transfer Request form is signed by the member and by the receiving plan's administrator, and the transferring administrator must send an attested breakdown of contributions.
- **Values:**
  - `form_fields: member name, account number, date of birth, transferring plan, employer, date employment ended, receiving plan and administrator`
  - `breakdown: employee mandatory and voluntary; employer mandatory and voluntary; additional contributions under s.52D`
  - `attestation: accuracy of the breakdown`
  - `discharge: member releases the transferring administrator`
- **Source:** S10; S3 reg.18(4); S1 s.34(7).
- **Confidence:** `verified-primary` (form); regulation from the 2017 draft
- **Notes:** S16's provider form also asks for the employer's signature and the termination date; that is one provider's practice.

---

## 8. Death of a member

### 8.1 Who is paid

- **Rule:** If a member dies before a pension starts, the spouse or civil partner at the date of death is entitled to a pension worth at least the member's deferred pension; a named beneficiary is paid only if there is no spouse or civil partner and no dependent child; the estate is paid if there is neither spouse nor beneficiary.
- **Values:**
  - `priority_1: spouse or civil partner at date of death`
  - `priority_2: designated beneficiary (only if no spouse or civil partner and no dependent children)`
  - `priority_3: personal representative of the estate (no beneficiary designated and no spouse or civil partner)`
  - `spouse_choice: immediate or deferred pension, or transfer to a s.34(1) vehicle`
  - `children_with_surviving_spouse: spouse holds 50% for the children until 23 or the end of full-time education`
  - `small_balance: under CI$5,000 may be paid as a lump sum to spouse, dependent child or beneficiary`
- **Source:** S1 s.39(1)-(6), s.36(5), s.42; S4 p.7.
- **Confidence:** `verified-primary`
- **Notes:** S16 tells married members to name the spouse at 100% (or 50% with the rest split among children under 18); S22 says a married member must name the spouse. The Act as read does not say what happens to a member with dependent children but no spouse; the plan may provide for children (s.39(7)).

### 8.2 Administrator's steps and time limits

- **Rule:** Within 30 days of notice of the death the administrator must give the spouse, beneficiary or legal representative a statement of the benefit and options.
- **Values:**
  - `death_statement_deadline: 30 days from notice of the date of death`
  - `spouse_election_window: 180 days from that statement (90 days in the 2011 Revision)`
  - `comply_with_election: 60 days from the spouse's direction`
  - `default_if_no_election: pension at the spouse's normal age`
- **Source:** S2 reg.23(1)-(3); S3 reg.17.
- **Confidence:** `verified-primary` (2011 Revision and 2017 draft; check the 2018 Revision)

### 8.3 Documents

- **Rule:** The person claiming must give the administrator "the relevant information"; no statutory list of documents was found.
- **Values:**
  - `documents: not specified in the Act or DLP material read`
- **Source:** S1 s.39(8)-(9), s.37.
- **Confidence:** `unverified` (document list)
- **Notes:** A death certificate, proof of relationship, ID and, for an estate, a grant of probate or letters of administration are the obvious set, but no Cayman source read lists them. Treat any list in the demo as a design choice.

---

## 9. The 2020 COVID emergency withdrawal (background)

### 9.1 Amount formula

- **Rule:** A member could take one lump sum: the whole balance if it was CI$10,000 or less, otherwise CI$10,000 plus up to 25% of the balance above CI$10,000.
- **Values:**
  - `formula: balance <= 10,000 ? balance : 10,000 + 25% * (balance - 10,000)`
  - `payments: single lump sum`
  - `eligible: member in the Islands, or one who left on or after 2020-02-01`
  - `excluded: members already drawing normal or early pension; public servants with contributions paid by a statutory authority or government company`
  - `documents: Director's form plus government photo ID (original, or a copy notarised or certified by a Justice of the Peace)`
- **Source:** S14 cl.5 (new s.52I(1)-(6)); S21 (CNS).
- **Confidence:** `verified-primary` for the Bill as introduced
- **Notes:** The enacted Law 12 of 2020 was not retrieved (the copy is on a site that blocks fetches); the Bill and contemporary reporting agree on the formula. The Part has expired and is not in the 2024 Revision.

### 9.2 Processing deadlines

- **Rule:** The administrator had to acknowledge within 7 days, decide within a further 14 days, and pay within 45 days of receiving the application.
- **Values:**
  - `acknowledge: 7 days from receipt`
  - `decide: 14 days from the acknowledgement`
  - `pay: 45 days from receipt`
  - `refusal_reasons: within 14 days of notifying the refusal`
  - `appeal: applicant may refer the decision to the Director`
  - `administrator_offence: CI$10,000 or 1 year`
- **Source:** S14 cl.5 (new s.52I(8)-(14)); S21 (Caymanian Times).
- **Confidence:** `verified-primary` for the Bill; the penalty figure `verified-secondary`

### 9.3 Dates and the contribution holiday

- **Rule:** Contributions were suspended from 1 April 2020 and the suspension was extended by Order six times until 30 September 2022; withdrawals opened on 1 May 2020 and closed on 31 October 2020.
- **Values:**
  - `holiday_start: 2020-04-01`
  - `holiday_end: 2022-09-30`
  - `withdrawals_open: 2020-05-01`
  - `withdrawals_close: 2020-10-31`
  - `during_holiday: employee, employer and self-employed contributions not required; existing arrears kept accruing interest; property repayment contributions paused`
- **Source:** S1 s.5A and Endnotes (Orders SL 126/2020, 167/2020, 46/2021, 78/2021, 8/2022, 24/2022); S14 cl.1-4; S20.
- **Confidence:** `verified-primary`
- **Notes:** The Bill gave an expiry of 30 November 2020; the Act's endnote records expiry of the withdrawal provisions on 31 October 2020. Mandatory contributions resumed for service from 1 October 2022. An earlier holiday ran from 26 April 2010 to 25 April 2011 (Caymanians) and 25 April 2012 (non-Caymanians), S1 s.5A(2).

### 9.4 What happened in practice

- **Rule:** Not a rule; a record of volumes and delays.
- **Values:**
  - `applications: 53,361`
  - `approved: 43,090`
  - `rejected: 10,271`
  - `paid: CI$489,258,534.65`
  - `peak: more than 25,000 applications in May 2020`
- **Source:** S20 (final figures, 19 Apr 2021); S21.
- **Confidence:** final figures `verified-secondary` (government radio release); peak figure from search summaries only
- **Notes:** On 29 June 2020 the DLP said it was reviewing several administrators' processing times against the 45-day limit and preparing files for the Director of Public Prosecutions where it was breached (S21). Search summaries of Cayman Compass reports (not opened) describe unanswered calls in May 2020, one plan that changed owner on 1 May 2020 beginning payments in mid-June, and administrators waiting for month-end valuations before paying. No record of a penalty actually imposed was found. Interim totals reported in December 2020 were about CI$443 million.

---

## 10. Administrator duties with deadlines

### 10.1 Member statements

- **Rule:** The administrator must give each member a written statement at least twice a year, within three months after the end of the second and fourth quarters of the plan's financial year.
- **Values:**
  - `statement_frequency: semi-annual (or more often if the plan says so)`
  - `statement_deadline: 3 months after the end of Q2 and Q4 of the plan year`
  - `electronic_delivery: with the member's written consent`
  - `default_plan_year_end: 30 June`
  - `effective_from: 2023-01-01`
- **Source:** S1 s.22(1)-(2); S3 reg.11 (amending reg.15(2)); S2 reg.4; S4 p.5; S15 (date).
- **Confidence:** `verified-primary`; effective date `verified-secondary`
- **Notes:** Before 1 January 2023 statements were annual. Contents under the 2017 amendments include the date each payment was received and the period it covers.

### 10.2 Requests to inspect documents

- **Rule:** The administrator must make the prescribed documents available within 30 days of a written request, free of charge, at most once every six months per person.
- **Values:**
  - `inspection_deadline: 30 days`
  - `request_frequency: once per 6 months unless the documents changed`
- **Source:** S1 s.23(1), s.23(4); S2 reg.16(5).
- **Confidence:** `verified-primary`

### 10.3 Enrolment and termination

- **Rule:** The employer must send enrolment information within 21 days of an employee becoming eligible, and the administrator must give a statement when a member leaves.
- **Values:**
  - `employer_enrolment_info: 21 days from eligibility`
  - `administrator_enrolment_pack: immediately on application (plan terms, rights, returns and expense ratios)`
  - `termination_statement: required on termination of employment or membership`
- **Source:** S1 s.20(1)-(2), s.22(3).
- **Confidence:** `verified-primary`
- **Notes:** The deadline for the termination statement is in the regulations and was not confirmed in the 2018 Revision (`unverified`).

### 10.4 Filings with the Director

- **Rule:** The administrator files an annual return and fee within three months of the plan year end, audited accounts within six months, and employer movements monthly.
- **Values:**
  - `annual_return_and_fee: 3 months after plan year end`
  - `audited_financial_statements: 6 months after plan year end`
  - `returns_and_expense_ratios: 6 months after plan year end`
  - `training_evidence: 3 months after plan year end`
  - `employer_list: annually, then monthly movements`
  - `agm: within 6 months of plan year end; record to the Director within 3 months of the meeting`
  - `member_register: with the audited statements (name, date of birth, employer, value)`
  - `monthly_reports: AVC withdrawals (by the 10th), property withdrawals`
- **Source:** S1 s.16(4), s.47(12), s.52B(8); S3 reg.10B; S11.
- **Confidence:** `verified-primary`
- **Notes:** Breach of s.16 carries CI$100,000 or 5 years and possible dismissal of the administrator (s.16(5), (7)).

### 10.5 Record keeping

- **Rule:** Employers must keep payroll and pension records for at least five years; administrators must keep all plan records in a central location notified to the Director.
- **Values:**
  - `employer_retention: 5 years from the date prepared`
  - `employer_records: name and contact, start date, full or part time, pay rate, gross and net pay, bonuses, terminations, plan name, deductions, contributions and proof of payment, periods, payment dates, interest paid`
  - `no_commingling: pension contributions shown separately from other payments such as health insurance`
  - `administrator_retention_period: not found`
- **Source:** S1 s.18A, s.16(4)(k); S6.
- **Confidence:** employer rules `verified-primary`; administrator retention period `unverified`

### 10.6 Statutory time limits for paying or deciding (summary)

| Request | Limit | Source | Confidence |
|---|---|---|---|
| Transfer to another plan, RSA or annuity | 45 days from delivery of the direction | S1 s.34(8) | `verified-primary` |
| Overseas transfer | 45 days under s.34(8), but only after DLP approval; no separate DLP time limit found | S1 s.34(8); S9 | `verified-primary` / approval time `unverified` |
| Property withdrawal | 60 days to pay; 7 days to refuse with reasons | S1 s.52B(6) | `verified-primary` |
| First pension instalment | First day of the month after the entitlement date | S1 s.26(3) | `verified-primary` |
| Retirement statement | 30 days after retirement | S2 reg.27(4) | `verified-primary` (2011 Revision) |
| Death statement | 30 days from notice of death | S2 reg.23(1) | `verified-primary` (2011 Revision) |
| Spouse's election after death | Complied with in 60 days | S2 reg.23(3) | `verified-primary` (2011 Revision) |
| Document inspection request | 30 days | S1 s.23(1) | `verified-primary` |
| Small-balance cash-out | No statutory limit; 6 to 8 weeks in provider practice | S16; S22 | `verified-secondary` |
| AVC withdrawal | No statutory limit found | S1 s.47(10)-(11) | `unverified` |
| RSA set-up at retirement | No statutory limit found | S8 | `unverified` |
| COVID emergency withdrawal (expired) | 45 days | S14 | `verified-primary` |

---

## 11. Vesting and locking-in

### 11.1 Vesting

- **Rule:** A member of a plan who leaves before the normal entitlement date is entitled to a deferred pension for service after 1 June 1998, with no minimum service period stated.
- **Values:**
  - `vesting_period: none stated for post-1998 service`
  - `pre_1998_service: 10 years' service or membership and age 45`
- **Source:** S1 s.28, s.27.
- **Confidence:** `verified-primary` for the text
- **Notes:** "Immediate vesting" is this note's reading of s.28, not a phrase the Act or DLP uses; no DLP statement confirming it was found. In a defined benefit plan the member's own contributions may not fund more than 50% of the commuted value, with any excess refunded on termination (s.31(5)-(6)).

### 11.2 Locking-in

- **Rule:** No member is entitled to a refund, payment or transfer from a plan except where the Act allows it, and any assignment, charge or surrender of pension money is void.
- **Values:**
  - `permitted_exits: retirement (annuity or RSA); early pension from 55; transfer under s.34; small balance under s.42; refund at normal age with Director approval (s.53(2)-(3)); property withdrawal (Part 7A); AVC access (s.47(10)); death (s.39); court order on divorce or dissolution, up to 50% of the benefit accrued during the relationship (s.43); reduced life expectancy (s.40)`
  - `creditor_protection: exempt from execution, seizure or attachment`
  - `contracting_out: void`
- **Source:** S1 s.53(1), s.55, s.56, s.57, s.43(2), s.40.
- **Confidence:** `verified-primary`
- **Notes:** S4 says mandatory contributions may be accessed where life expectancy is likely to be reduced by a life-threatening condition or permanent disability; the conditions and documents were not found.

---

## 12. Currency and identifiers

- **Rule:** Amounts are in Cayman Islands dollars, and the official forms identify a member's holding by a pension plan account number.
- **Values:**
  - `currency_notation: "CI$" (statutory form and DLP documents)`
  - `member_identifier: "Pension Plan Account Number" (Act, Schedule, A3 and A4); "Account Number" (DLP transfer form)`
  - `plan_identifier: plan name plus "registration number" (statements under regs 23 and 27)`
  - `property_identifier: block and parcel number`
  - `provider_internal_codes_example: "ERID", "PLANID", "DIV.CODE" on one provider's form`
- **Source:** S1 Schedule; S10; S2 reg.23(1)(a), reg.27(3)(a); S16.
- **Confidence:** `verified-primary` for the statutory form; provider codes `verified-secondary`
- **Notes:** The ISO code "KYD" does not appear in any source read. No source defines a standard format for member or employer numbers; formats are each administrator's own.

---

## Parameters a rules engine would need

| # | Parameter | Value | Unit | Rule | Citation | Confidence |
|---|---|---|---|---|---|---|
| 1 | `coverage.min_age` | 18 | years | 1.1 | S1 s.25(1) | verified-primary |
| 2 | `coverage.max_age` | 65 | years | 1.1, 1.5 | S1 s.3, s.25(1); S4 | verified-primary |
| 3 | `coverage.non_caymanian_wait` | 9 | months continuous | 1.2 | S1 s.25(2)(a) | verified-primary |
| 4 | `coverage.student_exempt_under_age` | 23 | years (Caymanian, full-time education) | 1.3 | S1 s.3 | verified-primary |
| 5 | `contrib.employer_rate_min` | 5 | % of earnings | 2.1 | S1 s.47(3)(b) | verified-primary |
| 6 | `contrib.employee_rate_max` | 5 | % of earnings | 2.1 | S1 s.47(3)(a) | verified-primary |
| 7 | `contrib.total_rate` | 10 | % of earnings | 2.1 | S1 s.47(3)(c); S4 | verified-primary |
| 8 | `contrib.self_employed_rate` | 10 | % of earnings | 1.4 | S1 s.47(2) | verified-primary |
| 9 | `contrib.ympe_annual` | 87,000 | CI$ per year | 2.2 | S1 s.3; S4 | verified-primary |
| 10 | `contrib.ympe_effective_from` | 2017-01-01 | date | 2.2 | S17; S18 | verified-secondary |
| 11 | `contrib.ympe_monthly` | 7,250 | CI$ per month (derived) | 2.2 | arithmetic only | unverified |
| 12 | `contrib.bonus_threshold` | 20 | % of basic pay | 2.4 | S1 s.3 | verified-primary |
| 13 | `contrib.arithmetic_tolerance` | 0.01 (demo choice) | CI$ | 2.1 | none | unverified |
| 14 | `remit.due_day` | 15 | day of month +1 | 3.1 | S1 s.48(2) | verified-primary |
| 15 | `delinq.reportable_day` | 15 | day of month +2 | 3.3 | S1 s.48(5) | verified-primary |
| 16 | `delinq.notify_director_day` | 20 | day of month +2 | 3.3 | S1 s.48(6)(a) | verified-primary |
| 17 | `delinq.notify_employees_within` | 60 | days after Director notified | 3.4 | S1 s.48(6)(b) | verified-primary |
| 18 | `delinq.interest_margin_over_prime` | 5 | percentage points, daily | 3.5 | S1 s.50(1) | verified-primary |
| 19 | `delinq.prime_rate` | not sourced | % | 3.5 | none | unverified |
| 20 | `delinq.collection_fee` | max(10% of arrears, 50 per day) | CI$ | 3.6 | S1 s.48(9)(c) | verified-primary |
| 21 | `delinq.demand_letter_window` | 14 | days | 3.6 | S1 s.48(9)(a) | verified-primary |
| 22 | `retire.normal_age` | 65 | years | 4.1 | S1 s.3 | verified-primary |
| 23 | `retire.age_60_option_dob_cutoff` | 1969-12-31 | date of birth on or before | 4.1 | S18; S16 | verified-secondary |
| 24 | `retire.early_age` | 55 | years (employment ended) | 4.3 | S1 s.33; S4 | verified-primary |
| 25 | `retire.rsa_annual_floor` | 16,200 | CI$ per year, from 2026-07-01 | 4.5 | S8 | verified-primary |
| 26 | `retire.rsa_pct_at_65` | 5.11 | % of balance per year | 4.5 | S8 | verified-primary |
| 27 | `retire.small_balance_threshold` | 5,000 | CI$ (under) | 4.6 | S1 s.42 | verified-primary |
| 28 | `leave.refund_available` | false since 2019-12-31 | boolean | 5.1 | S13; S19; S1 s.53(7) | verified-primary |
| 29 | `leave.transfer_absence_min` | 2 | years absent | 5.2 | S1 s.34(5) | verified-primary |
| 30 | `leave.transfer_no_contrib_min` | 2 | years | 5.2 | S1 s.34(3)(c) | verified-primary |
| 31 | `leave.transfer_required_docs` | transfer form; supplemental questionnaire; receiving plan document; photo ID | list | 5.4 | S9; S10 | verified-primary |
| 32 | `leave.proof_of_residence_doc` | not sourced | document | 5.4 | none | unverified |
| 33 | `property.deposit_or_reduction_cap` | 50,000 | CI$ per person, all plans | 6.2 | S1 s.52B(1), s.52BA(1), s.52E(1) | verified-primary |
| 34 | `property.payoff_cap` | 100,000 | CI$ per person, all plans | 6.2 | S1 s.52C(1), s.52E(1A) | verified-primary |
| 35 | `property.caps_effective_from` | 2023-12-09 | date | 6.2 | S1 s.96; S7 | verified-primary |
| 36 | `property.pay_within` | 60 | days from application | 6.4 | S1 s.52B(6)(a) | verified-primary |
| 37 | `property.refuse_within` | 7 | days from application | 6.4 | S1 s.52B(6)(b) | verified-primary |
| 38 | `property.repayment_rate` | 3 (1 for applications before 2023-12-09) | % of earnings | 6.5 | S1 s.52D(1); S7 | verified-primary |
| 39 | `property.unused_return_within` | 6 (12 if building) | months | 6.6 | S1 s.52B(4B) | verified-primary |
| 40 | `transfer.complete_within` | 45 | days from direction | 7.2 | S1 s.34(8) | verified-primary |
| 41 | `death.statement_within` | 30 | days from notice of death | 8.2 | S2 reg.23(1) | verified-primary |
| 42 | `death.required_docs` | not sourced | list | 8.3 | none | unverified |
| 43 | `admin.statement_frequency` | 2 | per year, within 3 months of Q2 and Q4 | 10.1 | S1 s.22(1); S4 | verified-primary |
| 44 | `admin.employer_record_retention` | 5 | years | 10.5 | S1 s.18A(3), (6) | verified-primary |

---

## Could not verify

1. **Text of the National Pensions (General) Regulations (2018 Revision).** The DLP lists it as current; only the 2011 Revision and the 2017 amending draft were read. All regulation-based periods (30, 60, 180 days) need checking against it.
2. **Normal Age of Pension Entitlement Option Order, 2016.** Not retrieved. The date-of-birth cut-off (1969-12-31) rests on a slide deck, a provider FAQ and a law-firm note, and the DLP FAQ words it differently ("born prior to 1969").
3. **The Cabinet Order under s.53(7)** fixing the last date for refund applications, and whether any later Order reopened refunds. No reopening was found.
4. **Enacted text of the National Pensions (Amendment) Law, 2020 (Law 12 of 2020).** Only the Bill was read. Differences between Bill and Law, if any, are unknown.
5. **Documents proving residence abroad** for an overseas transfer (proof of address, affidavit, immigration stamps). No source lists them.
6. **Documents for a death claim** (death certificate, probate, proof of relationship). No Cayman source read lists them.
7. **Documents for retirement and RSA set-up.** The DLP checklist exists but sits on a site that refused fetches.
8. **A statutory time limit for paying a small-balance refund, an AVC withdrawal, or starting an RSA.** None found; 6 to 8 weeks is provider practice only.
9. **DLP's own turnaround time** for approving an overseas transfer or a refund at normal age.
10. **The prime rate** used for late-contribution interest, and whose published rate counts.
11. **A monthly YMPE cap or per-pay-period proration rule.** The Act states only an annual figure.
12. **Which reading of the 20% bonus test** the DLP applies.
13. **What happens when the 15th falls on a weekend or public holiday.**
14. **How long an administrator must keep records.** Only the employer's five years was found.
15. **An arithmetic tolerance for contribution checks.** None exists in the sources; any tolerance is a demo design choice.
16. **Standard formats for member numbers and employer numbers**, and the ISO code "KYD" in an official pensions source.
17. **The prescribed minimum pension** in s.41 and the prescribed maximum transfer fee in s.34(6).
18. **The 180-day payment rule in reg.22(9)** and how it relates to the 45-day rule in s.34(8).
19. **Conditions and documents for accessing mandatory contributions on terminal illness or permanent disability** (mentioned in the DLP FAQ, s.40 of the Act).
20. **Whether any administrator was fined** over the 45-day limit in 2020, and exact month-by-month application counts (several news pages refused fetches).
21. **The pre-2016 refund rule and the 2010-2012 refund window** were seen only in search summaries of news reports.
22. **CIMA rules on pension administrators.** Nothing relevant was found; the DLP is the regulator under the Act.
