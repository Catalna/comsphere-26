# DanaTerang — UI Design Guidelines

## 1. Design Direction

DanaTerang should use a **clean, modern, trustworthy dashboard style** inspired by the provided reference image:

- dark left sidebar,
- light neutral application canvas,
- large rounded cards,
- strong typography hierarchy,
- simple iconography,
- generous spacing,
- dashboard-first information architecture,
- compact visualizations,
- minimal visual noise.

The reference is visually strong, but its lime + purple combination feels closer to a **health / lifestyle / consumer startup** product. For DanaTerang, the UI should communicate:

- **trust**
- **transparency**
- **accountability**
- **verification**
- **security**
- **clarity**

Therefore, keep the **same layout language** but adjust the color system.

---

# 2. Recommended Color Direction

## Recommended Palette: Navy + Teal + Soft Lime Accent

This is the recommended direction for DanaTerang.

### Primary

```css
--navy-950: #101A2B;
--navy-900: #152238;
--navy-800: #1D2F4D;
```

Use for:

- sidebar,
- primary text,
- dark cards,
- navigation,
- blockchain / audit areas.

### Trust / Verification Color

```css
--teal-700: #0F766E;
--teal-600: #0D9488;
--teal-500: #14B8A6;
--teal-100: #CCFBF1;
```

Use for:

- evidence verified by a 2-of-3 peer quorum,
- progress,
- trust indicators,
- positive verification actions,
- active navigation accents.

### Accent

A soft lime accent may remain from the reference image, but it should be used sparingly.

```css
--lime-400: #C9F35B;
--lime-300: #DDF78A;
--lime-100: #F4FCD7;
```

Use for:

- highlighted metrics,
- active progress,
- selected filters,
- small CTA accents.

Do **not** use lime as a large page background.

### Neutral

```css
--background: #F4F6F8;
--surface: #FFFFFF;
--surface-muted: #EEF1F4;
--border: #E3E7EC;

--text-primary: #111827;
--text-secondary: #667085;
--text-muted: #98A2B3;
```

### Semantic Status Colors

```css
--success: #16A34A;
--warning: #F59E0B;
--danger: #DC2626;
--info: #2563EB;
```

Suggested meaning:

| Status | Color |
|---|---|
| Approved by Verifier | Teal / Green |
| No Screening Flags | Green |
| Pending | Blue |
| Needs Review | Amber |
| Flagged | Orange |
| Rejected | Red |
| Payment Reported by Funder | Teal |
| Ready for Payment | Blue |
| Payment Confirmed by Independent Source | Teal |
| Proof Anchored on Sepolia | Navy / Teal |
| Draft | Gray |

---

# 3. Why This Palette Fits DanaTerang

The original reference palette is attractive, but using the exact same visual identity may make DanaTerang feel too playful.

DanaTerang handles:

- funding accountability,
- verification,
- evidence,
- audit trails,
- CSR programs,
- optional external-payment reports,
- blockchain proof.

A **navy + teal system** communicates more institutional trust while still looking modern.

Recommended balance:

```text
70% Neutral / White / Gray
20% Navy
8% Teal
2% Lime Accent
```

The lime should work as an energetic highlight, not the dominant brand color.

---

# 4. Overall Layout

Desktop application layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ Sidebar │                     Main Content                  │
│         │                                                   │
│ Logo    │ Header / Search / Notifications / User           │
│         │                                                   │
│ Nav     │ Page Title                                        │
│         │ KPI Cards                                         │
│         │                                                   │
│         │ Main Dashboard Grid                               │
│         │                                                   │
│         │ Audit / Activity / Progress                       │
│         │                                                   │
└─────────────────────────────────────────────────────────────┘
```

Recommended desktop width behavior:

```css
Sidebar:
width: 240px;

Main:
min-width: 0;
padding: 28px 32px;

Dashboard:
max-width: 1600px;
```

---

# 5. Sidebar

The sidebar should closely follow the reference image.

## Appearance

```css
background: #101A2B;
border-radius: 24px 0 0 24px;
```

Navigation items should be simple and icon-driven.

Example:

```text
DanaTerang

▦  Dashboard
○  Programs
◇  Milestones
▣  Evidence
✓  Verification
↗  Payment Reports
◎  Audit Trail
●  Organizations

────────────

⚙  Settings
?  Help
```

Navigation should change slightly based on role.

### Organizer

```text
Dashboard
Programs
Milestones
Evidence
Review Status
Payment Reports
Audit Trail
```

### Funder / CSR

```text
Dashboard
Programs
Milestones
Payment Reports
Reports
Audit Trail
```

### Verifier

```text
Dashboard
Review Queue
Evidence
Verification History
Audit Trail
```

### Admin

```text
Dashboard
Users
Organizations
Programs
Audit Logs
System Settings
```

---

# 6. Sidebar Active State

Inspired by the reference image:

```css
background: #FFFFFF;
color: #101A2B;
border-radius: 999px;
```

Example:

```text
┌──────────────────────┐
│ ▦  Dashboard      3  │
└──────────────────────┘
```

Small counters may use:

```css
background: #C9F35B;
color: #101A2B;
```

Counters can represent:

- pending reviews,
- flagged evidence,
- milestones needing attention.

---

# 7. Top Navigation

Recommended header:

```text
[User avatar]
PT ABC Foundation
CSR Manager

                                      [Search...] [🔔 3]
```

Under it:

```text
Program Overview                    [This Month ▼]
Track funding accountability
and verification progress.
```

Use contextual copy depending on role.

---

# 8. Dashboard Overview

The dashboard should use a modular grid similar to the reference image.

Example:

```text
┌──────────────────────────────┬──────────────────┬──────────────────┐
│ Total Program Budget         │ Approved         │ Needs Review     │
│ Rp 1.25B                     │ 27 Milestones    │ 4 Evidence       │
│ +12%                         │ +5 this month    │ Attention        │
├──────────────────────────────┴──────────────────┴──────────────────┤
│                                                                     │
│             Program / Funding Overview                              │
│                                                                     │
├───────────────────────────────────────┬─────────────────────────────┤
│ Milestone Progress                    │ Verification Health         │
│                                       │                             │
├───────────────────────────────────────┴─────────────────────────────┤
│                 Audit & Activity Timeline                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

# 9. Main Dashboard Cards

## 9.1 Total Program Budget

Large card.

Example:

```text
Total Program Budget

Rp 1.250.000.000

Allocated                    Rp 820M
Reported paid by funder      Rp 580M
Unallocated                  Rp 430M
```

Reported payment amounts are funder-provided and are not independently verified by DanaTerang.

Visual may use three overlapping circles similar to the reference, but adapted to:

- Total budget
- Allocated budget
- Reported payment

Suggested colors:

```text
Allocated → Teal
Reported paid → Navy
Not reported → Lime
```

---

# 10. KPI Cards

Recommended KPI cards:

### Active Programs

```text
Active Programs

12
+2 this month
```

### Approved Milestones

```text
Verified by peer quorum

27
82% completion
```

### Needs Review

```text
Needs Review

4
Evidence items
```

### Payment Reports

```text
Reported by Funders

3
External reports, not independently verified
```

---

# 11. Milestone Progress Card

Use horizontal progress bars.

Example:

```text
Program Progress

School Renovation

Planning           100%
Material Purchase  100%
Construction        65%
Finishing            0%
```

Color rules:

```text
Completed → Teal
In Progress → Lime
Pending → Gray
Flagged → Amber
Rejected → Red
```

---

# 12. Verification Health Card

Inspired by the dotted graph in the reference.

Example:

```text
Verification Health

88%

● ● ● ● ● ●
● ● ● ● ● ○
● ● ● ● ○ ○
```

Can represent:

- evidence verified by a 2-of-3 peer quorum,
- pending evidence,
- flagged evidence.

Keep this visualization simple.

---

# 13. Audit Trail Card

The large dark card from the reference should be repurposed as the **Audit Trail / Transparency Activity** card.

This can become one of DanaTerang's strongest visual components.

```text
Recent Audit Activity

Evidence Approved by Verifier 09:20
Milestone #2

Payment Reported by Funder    11:45
Rp 30,000,000

Blockchain Proof Anchored     12:02
Tx 0x82F...A91

Evidence Flagged              13:18
Possible duplicate invoice
```

Dark background:

```css
background: #101A2B;
color: #FFFFFF;
```

Use teal/lime indicators.

---

# 14. Program Card

Example:

```text
┌───────────────────────────────────────────┐
│ Renovasi SD Harapan                       │
│ CSR Education Program                     │
│                                           │
│ PT ABC Foundation → NGO Peduli Negeri     │
│                                           │
│ Rp100,000,000                             │
│                                           │
│ Progress                                  │
│ ███████████████░░░░  70%                  │
│                                           │
│ 3 / 5 Milestones                          │
│                                           │
│ ● Active                                  │
│                                View →     │
└───────────────────────────────────────────┘
```

---

# 15. Campaign / Program Detail

Recommended page structure:

```text
Renovasi SD Harapan

[Overview] [Milestones] [Evidence] [Payments] [Audit Trail]

Program Budget
Rp100,000,000

Organizer
NGO Peduli Negeri

Funder
PT ABC Foundation

Progress
60%

──────────────────────────────────────

Milestones

✓ Material Purchase
  Rp30,000,000
  Verified by peer quorum
  Payment reported by funder

● Structural Renovation
  Rp40,000,000
  Needs Review
  No payment report

○ Finishing
  Rp30,000,000
  Not Started
```

---

# 16. Evidence Upload Page

Upload area:

```text
Upload Evidence

┌─────────────────────────────────────────┐
│                                         │
│      Drop files here                    │
│                                         │
│ Receipt, Invoice, Photo, Report         │
│ PDF / JPG / PNG                         │
│                                         │
│             Browse Files                │
│                                         │
└─────────────────────────────────────────┘
```

After upload:

```text
receipt-material.pdf

SHA-256
4ab219c...

OCR Status
Processing...
```

Do not expose technical hashes prominently to normal users.

Place:

```text
View Technical Details
```

below the main information.

---

# 17. Evidence Detail Page

Recommended layout:

```text
Evidence #EV-1938

┌──────────────────────┬─────────────────────────┐
│ Document Preview     │ Extracted Information   │
│                      │                         │
│ [Receipt Image]      │ Vendor                  │
│                      │ PT Bangunan Jaya        │
│                      │ Confidence: 94%         │
│                      │                         │
│                      │ Date                    │
│                      │ 01 Oct 2026             │
│                      │ Confidence: 89%         │
│                      │                         │
│                      │ Amount                  │
│                      │ Rp30,000,000            │
│                      │ Confidence: 98%         │
└──────────────────────┴─────────────────────────┘

Screening Result

✓ Vendor detected
✓ Date consistent
✓ Amount within milestone budget

Screening:
No configured flags detected
```

If problematic:

```text
⚠ Needs Review

Amount Mismatch
Declared: Rp30,000,000
Detected: Rp35,000,000
```

Confidence thresholds are field-specific, with a stricter threshold for amount than vendor. A required field below its threshold shows a `LOW_CONFIDENCE_FIELD` flag and requires human review; it must not appear as `CLEAR`.

---

# 18. Verifier Review Screen

This screen must prioritize clarity.

```text
Evidence Review

Program
School Renovation

Milestone
Material Purchase

───────────────────────────────

Evidence Preview        OCR Result

                         Vendor
                         PT ABC

                         Total
                         Rp30M

───────────────────────────────

AI Screening

✓ Date valid
✓ Vendor present
⚠ Possible duplicate invoice

───────────────────────────────

Verifier Note
[................................]

[Reject] [Request Revision] [Verify]
```

AI must be visually presented as:

```text
AI Screening
```

not:

```text
AI Decision
```

The 2-of-3 peer quorum is the final decision maker. Admin cannot vote or override.

---

# 19. Optional External Payment Report

Payment stays outside DanaTerang. If this optional demo screen is included, identify the report and its source:

```text
External Payment Report
```

Example:

```text
Milestone #2

Reported Amount
Rp40,000,000

Reported by
PT ABC Foundation

Report Status
Reported by funder — not independently verified

Reported At
04 Oct 2026
```

Payment references and supporting files are private by default. Do not show a “Confirm Payment” action in the Phase 1 demo.

---

# 20. Public Audit Page

This page must be simpler than internal dashboards.

Public users should immediately understand:

```text
Renovasi SD Harapan

Program Budget
Rp100,000,000

Program Progress
70%

3 / 5 Milestones Completed
```

Milestone:

```text
Material Purchase

Evidence
✓ Submitted

Screening
No configured flags detected

Verification
VERIFIED by 2-of-3 peer quorum

Payment
PAYMENT_REPORTED by funder (if provided)

Blockchain Proof
ANCHORED on Ethereum Sepolia
```

CTA:

```text
View Evidence Summary
View Technical Proof
```

---

# 21. Blockchain Proof UI

Avoid displaying crypto terminology aggressively.

Preferred:

```text
Blockchain Proof

✓ Proof Anchored

Recorded
4 Oct 2026, 14:03 WIB

Network
Ethereum Sepolia Testnet

[View on Sepolia Etherscan]
```

Expanded:

```text
Canonical Package Hash (SHA-256)
0x82f0...

Transaction Hash
0x9183...

Block
#9283912

Contract
0x3928...
```

Normal users should not need to understand these fields.

The backend service wallet relays transactions and pays gas in Sepolia ETH. Assigned Verifiers connect organization-controlled wallets to sign peer votes; Organizers and Funders do not need one. Show the original raw-file hash only to authorized Verifiers; a public redacted derivative may display its separate hash when approved.

---

# 22. Typography

Recommended font:

```text
Inter
```

Alternative:

```text
Manrope
Plus Jakarta Sans
```

Recommended hierarchy:

```css
Display:
48px / 56px / 700

Page Title:
36px / 44px / 700

Section:
24px / 32px / 600

Card Title:
16px / 24px / 600

Body:
14px / 22px / 400

Small:
12px / 18px / 400
```

For an Indonesian-focused product, **Plus Jakarta Sans** is especially suitable and still feels modern.

Recommended:

```text
Primary Font:
Plus Jakarta Sans
```

---

# 23. Border Radius

The reference relies heavily on rounded geometry.

Recommended:

```css
--radius-sm: 10px;
--radius-md: 14px;
--radius-lg: 20px;
--radius-xl: 24px;
--radius-pill: 999px;
```

Main cards:

```text
20px
```

Buttons:

```text
12–14px
```

Navigation active item:

```text
999px
```

---

# 24. Shadows

Use subtle shadows.

```css
box-shadow:
0 8px 24px rgba(15, 23, 42, 0.06);
```

Avoid strong floating shadows.

Most separation should come from:

- background contrast,
- whitespace,
- borders.

---

# 25. Button System

## Primary

```css
background: #101A2B;
color: #FFFFFF;
```

Example:

```text
[ Create Program ]
```

## Verification Primary

```css
background: #0D9488;
color: #FFFFFF;
```

Example:

```text
[ Verify Evidence ]
```

## Secondary

```css
background: #FFFFFF;
border: 1px solid #E3E7EC;
color: #101A2B;
```

## Warning

```css
background: #FEF3C7;
color: #92400E;
```

---

# 26. Status Chips

Examples:

```text
[ SCREENING: CLEAR ]
[ REVIEW: VERIFIED ]
[ REVIEW: NEEDS_REVISION ]
[ SCREENING: FLAGGED ]
[ PAYMENT: READY_FOR_PAYMENT ]
[ PAYMENT: PAYMENT_REPORTED ]
[ PAYMENT: CONFIRMED ] (pilot / independent source only)
[ PROOF: ANCHORED ]
[ PROOF: PENDING ]
```

In the demo, label a human review outcome as **Verified by 2-of-3 peer quorum** in full context; do not imply that `CLEAR` or approval establishes real-world truth.

Style:

```css
font-size: 12px;
font-weight: 600;
padding: 6px 10px;
border-radius: 999px;
```

---

# 27. Icon Style

Use consistent outline icons.

Recommended:

- Lucide
- Heroicons
- Phosphor Icons

Avoid mixing icon libraries.

Suggested icons:

```text
Dashboard       LayoutDashboard
Programs        FolderKanban
Milestones      ListChecks
Evidence        FileCheck
Verification    BadgeCheck
Payment Report  Banknote
Audit           ScrollText
Blockchain      Blocks
Organization    Building2
```

---

# 28. Responsive Design

## Desktop

Sidebar visible.

```text
≥ 1024px
```

## Tablet

Sidebar may collapse to icons.

```text
768–1023px
```

## Mobile

Replace sidebar with:

- hamburger drawer,
- compact header,
- stacked cards.

Dashboard grid becomes:

```text
1 column
```

Technical tables should become cards.

---

# 29. Recommended Desktop Dashboard Wireframe

```text
┌────────────────────────────────────────────────────────────────────┐
│         │ Account                                      Search 🔔  │
│         │                                                         │
│ DANA    │ Program Overview                                        │
│ TERANG  │ Track transparent funding and verification             │
│         │                                                         │
│ ● Dash  │ ┌────────────────┐ ┌────────────┐ ┌────────────────┐   │
│ Programs│ │ Total Budget   │ │ Approved   │ │ Needs Review   │   │
│ Miles.  │ │ Rp1.25B        │ │ 27         │ │ 4              │   │
│ Evidence│ └────────────────┘ └────────────┘ └────────────────┘   │
│ Verify  │                                                         │
│ Disburs.│ ┌──────────────────────────┐ ┌───────────────────────┐  │
│ Audit   │ │ Funding Overview         │ │ Verification Health   │  │
│         │ │                          │ │                       │  │
│         │ │     data visualization   │ │     88%               │  │
│         │ │                          │ │                       │  │
│         │ └──────────────────────────┘ └───────────────────────┘  │
│         │                                                         │
│         │ ┌────────────────────────────────────────────────────┐  │
│         │ │ Recent Audit Activity                              │  │
│         │ │ Evidence approved        09:20                    │  │
│         │ │ Payment recorded         11:45                    │  │
│         │ │ Blockchain proof         12:02                    │  │
│         │ └────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

# 30. Recommended Visual Identity

## Overall Feel

DanaTerang should feel:

```text
Modern
Trustworthy
Transparent
Professional
Human
Accessible
```

It should **not** feel:

```text
Crypto exchange
Banking back-office software
Government legacy system
Playful consumer fintech
Overly futuristic Web3
```

Blockchain is infrastructure, not the visual identity.

---

# 31. Final Design Recommendation

Keep the **layout style from the provided reference image**:

- dark sidebar,
- light content area,
- modular dashboard,
- rounded cards,
- large metric typography,
- compact charts,
- prominent dark secondary panel.

Change the visual language from:

```text
Black + Lime + Lavender
```

to:

```text
Deep Navy + White/Soft Gray + Teal
                         +
                 Soft Lime Accent
```

Recommended brand combination:

```text
Primary:
#101A2B

Secondary:
#0D9488

Accent:
#C9F35B

Background:
#F4F6F8

Surface:
#FFFFFF

Text:
#111827
```

This keeps the reference's modern personality while making DanaTerang feel substantially more appropriate for **CSR accountability, evidence verification, transparent disbursement, and blockchain-backed auditability**.
