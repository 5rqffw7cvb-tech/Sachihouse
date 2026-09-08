# Qualified invoices (適格請求書) — setup

Host level 4 can issue Japanese qualified invoices from any booking on a property
they run. This document covers the two things that are not in the UI: the Cloud Storage
bucket the copies are kept in, and what the host has to fill in before the first
invoice.

## 1. What the host fills in

Console: **Finance → Invoices → Settings**.
Phone app: **Account → Invoice settings (T number)**.

| Field | Required | Notes |
| --- | --- | --- |
| 登録番号 / Registration No. | yes | `T` + 13 digits. Without it the document is not a 適格請求書 and the guest cannot claim the tax back. Separators are stripped on save. |
| 発行者名 / Issuer name | yes | 法人名 or 屋号, printed verbatim. |
| 住所 / Address | yes | |
| 電話 / メール | no | |
| お振込先 / Bank details | no | Free text under the totals. |
| 番号の接頭辞 / Prefix | no | `INV` → `INV-2026-0001`. Per issuer, per year, no gaps. |
| 端数処理 / Rounding | no | 切捨て (default) / 四捨五入 / 切上げ. Applied **once per tax rate per invoice**, which is the NTA rule. Pick one and keep it. |

Each host has their own profile — the registration number belongs to a business,
not to a property, so two hosts on one deployment invoice under their own numbers.
The profile is **snapshotted onto every invoice at issue time**: editing it later
never changes a document that has already been handed to a guest.

## 2. The archive bucket (server)

Issued PDFs are always downloaded to the host's device. Keeping a copy in Cloud
Storage is an extra: if no bucket is configured, or the upload fails, the invoice
is still issued and the host still has the file. The Invoices page says which
state the server is in — *Archived to Cloud Storage* or *Download only*.

> Step-by-step in Vietnamese, written against this deployment's actual project
> and service account: [INVOICE_BUCKET_SETUP.md](./INVOICE_BUCKET_SETUP.md).

### What you need to provide

1. A **GCS bucket** in the Google Cloud Console, in a region you are happy to keep
   tax records in (`asia-northeast1` for Tokyo). Keep it **private** — uniform
   bucket-level access, no `allUsers`. The app never links to it directly; it mints
   a 10-minute signed URL per read, the same way receipt evidence works.
2. A **service account** with `roles/storage.objectAdmin` on that bucket, and its
   JSON key. The deployment probably already has one for receipts — reusing it is
   fine.

Two settings worth turning on in the console, given what is in the bucket:

- **Object Versioning**, so a reissue under the same number cannot silently
  replace the copy a guest already has.
- **Retention policy** of 7 years (法人税法上の保存期間), and *no* lifecycle rule
  that deletes objects. If you share a bucket with receipts, check that an existing
  receipt-expiry rule does not reach the `invoices/` prefix — this is the reason
  `GCS_INVOICE_BUCKET` exists.

### Environment variables

```bash
# The bucket. Falls back to GCS_RECEIPT_BUCKET, then GCS_BUCKET, when unset.
GCS_INVOICE_BUCKET=sachihouse-invoices

# Optional: a project and service account dedicated to invoices. Both fall back
# to the shared GCP_PROJECT_ID / GCP_SERVICE_ACCOUNT_JSON the rest of the app uses.
GCP_INVOICE_PROJECT_ID=my-project
GCP_INVOICE_SERVICE_ACCOUNT_JSON='{"type":"service_account", ...}'
# …or base64-encoded, which survives more deployment UIs intact.
GCP_INVOICE_SERVICE_ACCOUNT_JSON_B64=eyJ0eXBlIjoic2Vydm...
```

If the deployment already stores receipts, setting nothing at all works: invoices
land in the receipt bucket under an `invoices/` prefix, signed with the same
credentials.

Note that both chains fall back the same way — invoice, then receipt, then
shared — so the account signing the upload is always the one the bucket it
landed on was granted to. If you point `GCS_INVOICE_BUCKET` at a bucket the
receipt service account cannot write to, give it `GCP_INVOICE_SERVICE_ACCOUNT_JSON`
as well, or grant that account on the bucket.

The error to expect when they disagree names the account, which is the fastest
way to see which one is actually running:

```
<account>@<project>.iam.gserviceaccount.com does not have storage.objects.create
access to the Google Cloud Storage object.
```

### Where the files land

```
gs://<bucket>/invoices/<issuerUserId>/<fiscalYear>/<invoiceNo>_<customer>.pdf
```

Issuer and year are in the path because that is how an accountant asks for them —
"everything I issued in 2026" is then one prefix listing, with no database access.

The database stores the canonical `gcs://bucket/object` path, never a URL. A signed
URL expires; an archive copy has to still be addressable in seven years.

## 3. What ends up on the invoice

The six things the NTA requires, and where each comes from:

| Requirement | Source |
| --- | --- |
| 発行者の氏名・登録番号 | The host's issuer profile, snapshotted at issue time |
| 取引年月日 | The stay's check-in → check-out dates |
| 取引内容 | Line items, prefilled from the booking and editable |
| 税率ごとの対価の額・適用税率 | Computed per rate from the tax-inclusive line totals |
| 税率ごとの消費税額等 | 税込 × 率/(1+率), rounded once per rate |
| 交付を受ける者の氏名 | The check-in form's main guest where one exists, else the booking name |

Amounts are **tax-inclusive (税込)**: the invoice totals what the guest actually
paid. Lines default to 10%; 8%（軽減税率）and 対象外 (for e.g. 宿泊税) are per-line
choices, and a discount is a negative line inside its own tax category so it nets
off the base before the tax is worked out.

## 4. Which bookings can be invoiced

All of them, not only direct bookings:

- **Booking confirmations** — manual entries and the mirrors of online bookings.
- **Direct bookings** paid on this site that have no confirmation mirror.
- **iCal imports** from Airbnb, Booking.com and the rest. These feeds carry neither
  a guest name nor a price, so those fields open blank for the host to type; the
  feed's own reservation text is shown so they can look the stay up on the platform.

A stay that already has an invoice is badged with its number, and issuing a second
one takes a deliberate second press.

## 5. Voiding and deleting

**Void** is the normal remedy, open to any level-4 host. The row stays, marked
void with a reason, and its number stays in the sequence — a gap in an issued
sequence is the first thing an audit asks about, and you are required to keep a
copy of anything a guest actually received for seven years.

**Delete** is administrators only, and the server allows it for one invoice at a
time: the newest number the issuer has taken. It removes the row, hands the
number back so the next invoice reuses it, and deletes the archived PDF. It
exists for a row created in error and never given to a guest — a test run on a
live deployment, most often.

Anything with newer invoices after it cannot be deleted, whoever asks: that
would leave a hole in the numbering. Void it.

Deleting removes **every version** of the archived PDF, not just the live one —
with Object Versioning enabled a plain delete would leave the data behind as a
noncurrent version. If the bucket refuses (a **retention policy** is the usual
reason: it permits writes but blocks deletes until the period expires), the
invoice is still deleted and the screen says the file has to be removed by hand.
That is the trade-off of turning retention on: it is what stops a real invoice
being erased, and it stops a test one being tidied away too.
