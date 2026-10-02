# Business rules and scope

## Shopping and shop sales

The customer selects a published product variant (size and colour), adds it to the bag, and chooses delivery or pickup. Sales staff can use the same collection and checkout screen to record a walk-in shop purchase. An optional existing customer ID is supported by the shop-order API; a walk-in order can also be recorded without a registered customer.

Prices, tax and delivery fees are calculated and snapshotted by the API. The bag shows an estimate; the created order shows the confirmed total before payment. Tax defaults to zero until the business accountant supplies the applicable setting. Delivery uses configurable named areas with a fixed fee per area. This implementation does not calculate route distance or support international shipping tariffs.

Checkout locks variant/product rows, reserves available stock and writes an inventory movement in the same transaction. Insufficient stock rolls back the whole order. A request UUID makes checkout retries return the original order. Changing the payload under the same UUID returns a conflict.

Unpaid, non-pending-payment orders can be cancelled; this releases stock once. The background worker expires such reservations after 24 hours. Paid orders and orders with a pending provider payment cannot be cancelled directly.

## Bespoke atelier

1. A customer shares the garment, occasion, budget, preferred date, description and optional image link.
2. The manager assigns a designer and optional tailor. Only the assigned designer/tailor and managers can access that job's private measurements.
3. The designer prepares a garment quotation, conditions and promised date. It can be revised before acceptance.
4. The customer accepts it and chooses pickup/delivery. The API creates one linked order, adds configured tax and delivery, and computes the deposit.
5. Deposit = ceiling((garment price + tax) × deposit percentage / 100) + delivery fee. The default is 50% of garment/tax plus the full delivery fee.
6. Production requires the deposit to be received. Measurements use centimetres. The assigned team records fitting notes and can request a fitting.
7. The garment is marked ready, then the customer pays the balance. Pickup and delivery require full payment and a recipient collection code.

Custom orders do not deduct ready-to-wear stock. Fabric/material procurement, workshop costing, supplier purchase orders and raw-material bills of materials are not implemented in this release.

## Payments

Ready-to-wear checkout requires full payment. Bespoke orders support deposit and balance. MoMo payment requests use amounts stored on the order, never an amount submitted by the customer. There is at most one pending payment per order. Successful payments increment paid amounts once under database locks; repeated callbacks/checks cannot increment again.

MoMo callbacks are wake-up signals. The server independently fetches MTN status and compares the payment ID, amount, currency and payer before settlement. Unknown/time-out outcomes remain pending. The worker checks pending transactions. If a submission was interrupted and the provider confirms no transaction exists, the same provider UUID can be resubmitted; a new payment is not created.

Sandbox requests use MTN's test EUR currency with the same numeric test amount. This is **not a currency conversion**, does not collect RWF, and must not be used for live selling. The client labels a sandbox request. Production uses the approved Rwanda environment and RWF.

Only authorised sales users record physically received cash. The cash endpoint is idempotent and rejects an amount exceeding the unpaid balance.

The collection integration does not perform outbound refunds. Finance approves a refund amount and records a verified external payment reference after sending/verifying the refund through the business's approved channel. The app explicitly describes this as a record, not an automatic money transfer. Refunded unfulfilled orders are cancelled. Returned physical stock is inspected and adjusted separately with a reason.

## Delivery and collection

A manager assigns/reassigns an active driver to a ready order. A reassignment immediately removes the previous driver's access and returns the order to ready/assigned. A driver sees only their assigned deliveries and does not receive the customer's collection code from the API. They obtain it from the recipient at handover. A driver can record pickup, delivery failure or receipt. Dispatch is blocked while payment is incomplete or a return review is open.

Pickup sales staff also require the customer code. In-shop purchases can be completed without a pickup code after payment and readiness. Failed deliveries return to ready for a manager to arrange another attempt.

Delivery proof is a text record and recipient code; photo signatures, live GPS tracking and navigation integrations are not included.

## Appointments

Customers request a future time. A manager confirms it against an active designer/tailor. Requested appointments are not a promise of availability. The API prevents overlapping appointments for the same customer and prevents overlapping confirmed appointments for a staff member. Store opening hours, holidays and staff leave are handled during approval; recurring availability calendars are not implemented.

## Access and recovery

The API stores hashed opaque access/refresh tokens. Access lasts 15 minutes; refresh sessions expire after 30 days. Refresh rotates both tokens. Logout, password reset, role changes and deactivation revoke sessions. Role lookup happens on every authenticated request, so the server remains authoritative.

Customer signup always creates a customer role and sends an email verification code. Production checkout and quotation acceptance require verified email ownership; development review can proceed without SMTP verification. A super admin creates staff and changes staff access. Passwords require 12–72 characters and use bcrypt. Login attempts use a database-backed 15-minute limit. Production ingress must also use the supplied authentication/API rate limits or equivalent controls.

Password recovery sends an expiring single-use code through SMTP. Responses do not reveal whether an email exists. In-app notifications and email messages are written to the database alongside core operations; the email worker retries failures. SMTP delivery is at least once, so an email can be duplicated after a crash between SMTP acceptance and marking it sent.

Account deletion removes the login identity and sessions, removes wishlist/notifications, cancels unlinked atelier requests/future appointments and clears completed measurements. Order snapshots and active custom production records remain with the business. The UI tells customers to contact the shop for active orders. Confirm and publish the business's actual data-retention/privacy policy before release.

## Current limits

This release is a single-shop system, one active role per user and RWF business amounts. Catalogue lists return up to 200 published pieces; operational lists return up to 300/500 recent records depending on the endpoint. A large multi-branch catalogue will need paginated reporting, warehouse/location stock and finer permissions. Coupons, loyalty, exchanges, social login, chat, SMS/WhatsApp, push notifications, EBM fiscal invoicing, automatic refund/disbursement, international taxes and multilingual content are not included.

These boundaries are intentional and visible; they are not represented as working integrations. The core shop/atelier workflows are implemented and tested, but production readiness also requires the launch validation in `LAUNCH.md`.
