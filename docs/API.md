# API contract

Base path: `/api/v1`. JSON request bodies use camelCase; database-shaped responses generally use snake_case. Money is a whole-number RWF amount. Rwanda phone format is `2507XXXXXXXX`.

Authenticated requests include `Authorization: Bearer <accessToken>`. Checkout, mobile-money initiation and cash recording also require `Idempotency-Key: <UUID v4>`. Use a new key for a new action and keep the same key/payload when retrying after a network timeout.

Errors return `{ "statusCode": 400, "message": "..." }`. Typical responses are 400 validation, 401 expired/missing session, 403 forbidden, 404 unavailable, 409 conflict and 503 unavailable integration. POST success is normally 201, other success normally 200. Request objects reject unknown fields.

## Authentication

| Method and path | Request / behaviour |
| --- | --- |
| POST `/auth/register` | `{email,password,name,phone}`; customer role only |
| POST `/auth/login` | `{email,password}` |
| POST `/auth/refresh` | `{refreshToken}`; rotates tokens |
| POST `/auth/forgot-password` | `{email}`; queues a reset email |
| POST `/auth/reset-password` | `{token,password}`; resets/revokes sessions |
| POST `/auth/email/send-verification` | Resend an email verification code |
| POST `/auth/email/verify` | `{token}`; one-time email ownership verification |
| PATCH `/auth/profile` | `{name,phone}`; update own contact details |
| GET `/auth/me` | Current profile |
| POST `/auth/logout` | Revoke current session |
| DELETE `/auth/account` | Customer account deletion; retained order records described in UI |

Login/register/refresh return `{accessToken,refreshToken,user}`. Store access in memory; the provided app uses platform secure storage for refresh tokens. On web, HTTPS and trusted-origin deployment are required. It is a client-side encrypted storage scheme, not an HttpOnly cookie.

## Catalogue and settings

| Method and path | Access / request |
| --- | --- |
| GET `/settings` | Public shop details, terms, tax/deposit/delivery settings |
| PUT `/settings` | Manager; complete settings object |
| GET `/categories` | Public category names from published products |
| GET `/products?q=&category=` | Public catalogue with variants |
| GET `/products/:id` | Public published piece with variants |
| GET `/admin/products` | Sales/management, including hidden products |
| POST `/products` | Management; product plus variants |
| PUT `/products/:id` | Management; product plus all existing variants |
| POST `/inventory/adjust` | Management; `{variantId,delta,reason}` |
| GET `/inventory/movements` | Management; recent ledger |
| GET `/wishlist` | Own saved pieces |
| POST / DELETE `/wishlist/:productId` | Add/remove own favourite |
| POST `/media/upload` | Customer/designer/management; multipart `file` image, ≤5 MB |

Product request:

```json
{
  "name": "Actual product name",
  "description": "Actual product details",
  "category": "Dresses",
  "price": 85000,
  "imageUrl": "https://YOUR_IMAGE_HOST/product.jpg",
  "active": true,
  "featured": true,
  "variants": [{"sku":"DRESS-M-OLIVE","size":"M","color":"Olive","stock":8}]
}
```

For existing variants, retain `id`. Product edits cannot overwrite existing stock; use inventory adjustment. SKU and size/colour combinations must be unique.

## Orders and payments

| Method and path | Request / behaviour |
| --- | --- |
| POST `/orders` | Checkout; stock reservation and amount calculation |
| GET `/orders` | Own/assigned orders or operational list by role |
| GET `/orders/:id` | Visible order, items, history, payments and delivery |
| POST `/orders/:id/status` | `{status,note,pickupCode?}`; validated transition |
| POST `/payments/orders/:id/mobile-money` | Flutterwave; `{phone,portion:"DUE"|"BALANCE"}`; returns `authorizationUrl`, `providerCurrency`, `sandbox` |
| POST `/payments/orders/:id/momo` | Compatibility alias for the new Flutterwave flow |
| POST `/payments/orders/:id/cash` | Sales; `{amount,receiptReference}` |
| POST `/payments/:id/check` | Verify the original provider and reconcile |
| POST `/payments/momo/callback/:reference` | Legacy MTN payments only; posted financial fields are ignored |
| POST `/payments/flutterwave/webhook` | Public v3 webhook; requires matching `verif-hash`; verified by reference before settlement |
| GET `/payments` | Finance/management payment list |

Checkout request:

```json
{
  "items": [{"variantId":"REPLACE_WITH_VARIANT_UUID","quantity":1}],
  "fulfilment": "DELIVERY",
  "zoneId": "kigali",
  "address": "Street, house and landmark",
  "customerName": "Customer Name",
  "customerPhone": "250780000001",
  "channel": "ONLINE"
}
```

Pickup omits delivery zone/address. Shop sales use `channel:"SHOP"`, with `fulfilment:"IN_SHOP"`, pickup or delivery, and optional `customerId`. Only sales/management can place shop orders. Direct order statuses: `CANCELLED`, `IN_PRODUCTION`, `READY`, `COMPLETED`; confirmation comes from payments, dispatch/completion for delivery comes from the assigned driver.

## Atelier and appointments

| Method and path | Request / behaviour |
| --- | --- |
| POST `/bespoke` | `{title,garment,description,occasion?,budget?,dueDate?,referenceUrl?}` |
| GET `/bespoke` | Own/assigned custom requests, or management list |
| GET `/bespoke/:id` | Private job details |
| POST `/bespoke/:id/assign` | Management; `{designerId,tailorId?}` |
| POST `/bespoke/:id/quote` | Assigned designer/management; `{amount,notes,dueDate}` |
| POST `/bespoke/:id/accept` | Owner; `{fulfilment,zoneId?,address?}`; one linked order |
| PATCH `/bespoke/:id/measurements` | Assigned team; `{unit:"cm",bust?,waist?,hip?,shoulder?,sleeve?,length?,inseam?,neck?,chest?,notes?}` |
| POST `/bespoke/:id/fitting` | Assigned team; request fitting after production starts |
| GET `/appointments` | Own/assigned or management appointments |
| POST `/appointments` | Customer; `{kind,startsAt,bespokeId?,notes?}` |
| POST `/appointments/:id/status` | `{status,staffId?}`; managers confirm staff/time |

Dates use `YYYY-MM-DD`; appointment `startsAt` is an ISO datetime including UTC/offset. Kinds: `CONSULTATION`, `MEASUREMENT`, `FITTING`, `COLLECTION`.

## Operations

| Method and path | Access / request |
| --- | --- |
| GET `/users` | Management profiles, no password hashes |
| POST `/users` | Super admin; `{name,email,phone,role,password}` |
| PATCH `/users/:id` | Super admin; `{role,active}`; revokes sessions |
| GET `/deliveries` | Sales/management or assigned driver |
| POST `/deliveries/:id/assign` | Management; `{driverId}` |
| POST `/deliveries/:id/status` | Assigned driver; `{status,proof,collectionCode?}` |
| POST `/returns` | Owner; `{orderId,reason}` |
| GET `/returns` | Own or finance list |
| POST `/returns/:id/status` | Finance; `{status,amount?,refundReference?}` |
| GET `/notifications` | Own updates |
| POST `/notifications/:id/read` | Mark own update read |
| GET `/reports` | Finance: receipts/refunds, order workload, low stock, daily receipts |
| GET `/audit` | Super admin audit history |
| GET `/health` | Public database availability check |

Delivery statuses: `PICKED_UP`, `DELIVERED`, `FAILED`. Return statuses: `APPROVED`, `REJECTED`, `RECEIVED`, `REFUNDED`; approval requires amount, refund recording requires a verified external reference. No refund transfer is made by that endpoint.
