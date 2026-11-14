# OrbitFS Public Access and Password Reset

## Canonical Store address
The customer-facing OrbitFS Store/Billing site is `https://billing.incendiarynetworks.cc`.

- `site.public_url` in Supabase is the canonical public Store origin.
- Server-generated customer links resolve through the canonical Store origin instead of trusting an arbitrary production request hostname.
- `NEXT_PUBLIC_ORBITFS_STORE_URL` (or the legacy `NEXT_PUBLIC_SITE_URL`) may override the default deployment value when intentionally configured.
- Local development keeps `localhost` / `127.0.0.1` request origins so reset, verification and checkout flows can be tested locally.
- Payment return/cancel URLs and payment webhook setup use the same canonical origin.

## Password reset
OrbitFS owns the recovery email and token flow. Supabase Auth remains the identity/password store only.

- Public request: `/reset-password` -> `/api/auth/password-reset/request`
- Completion: `/api/auth/password-reset/complete`
- Admin action: `/api/admin/customers/password-reset`
- Sender: `noreply@orbitfs.cc`
- Tokens: random 32-byte values; only SHA-256 hashes are stored
- Expiry: 30 minutes; single-use; prior unused links are invalidated
- Production reset links use the canonical OrbitFS Store URL
- Public reset requests are account-enumeration safe and throttled

## Email verification
OrbitFS also owns the customer email-verification link flow.

- Verification links use the same canonical OrbitFS Store URL.
- Tokens are single-use and stored as hashes.
- Production links point to `/verify-email` on the current Store host.

## Public access
- Store `/` and active products are public
- News `/news` and published posts are public
- Support `/support` is public
- Knowledge Base `/support/knowledge-base` is public for published/customer-visible articles

## Guest support
Anonymous visitors can create basic tickets only for **General Support** or **Sales** (`Sales Enquiries` internally where the existing department name is retained).

- Name and email are required and priority is fixed to normal.
- New guest tickets receive a private short access code, initially formatted `XX-XX-XX`.
- Only the code hash is stored.
- The customer can return to `/support`, enter the code, read customer-visible replies and reply without an account.
- Guest support confirmation mail includes the code and a direct link to the canonical Store support page.
- Guest tickets and their conversation are permanently deleted after 48 hours.
- Guest-code attempts are rate limited and failed attempts are tracked temporarily.

## Existing systems retained
The existing OrbitFS support tables, support routing/permissions, notification triggers, Mail automation/Resend delivery, customer records, and Supabase Auth identities remain in use. Public support and recovery use those systems rather than creating parallel account/support stores.
