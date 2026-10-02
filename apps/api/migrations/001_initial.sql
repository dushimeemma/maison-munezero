CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 name text NOT NULL, phone text, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'CUSTOMER' CHECK(role IN ('SUPER_ADMIN','MANAGER','SALES','DESIGNER','TAILOR','DRIVER','ACCOUNTANT','CUSTOMER')),
 active boolean NOT NULL DEFAULT true, email_verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 access_hash text UNIQUE NOT NULL, refresh_hash text UNIQUE NOT NULL,
 access_expires timestamptz NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE auth_attempts(email text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE password_resets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE email_verifications(user_id uuid PRIMARY KEY REFERENCES users(id),token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE settings(id integer PRIMARY KEY CHECK(id=1), data jsonb NOT NULL);
INSERT INTO settings VALUES(1, '{"brandName":"Maison Munezero","currency":"RWF","deliveryZones":[{"id":"kigali","name":"Kigali","fee":2500}],"depositPercent":50,"taxBasisPoints":0,"shopAddress":"Confirm shop address before launch","shopPhone":"","shopEmail":"","instagram":"https://www.instagram.com/maisonmunezero/","returnsDays":7,"appointmentMinutes":60,"sampleCatalogue":true,"terms":"Confirm Maison Munezero terms before launch. Custom orders require an approved quotation. Delivery fees are shown before payment."}');
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text NOT NULL,
 category text NOT NULL, price integer NOT NULL CHECK(price>=0 AND price<=100000000),
 image_url text, active boolean NOT NULL DEFAULT true, featured boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE variants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id),
 sku text NOT NULL UNIQUE, size text NOT NULL, color text NOT NULL, stock integer NOT NULL DEFAULT 0 CHECK(stock>=0),
 UNIQUE(product_id,size,color)
);
CREATE TABLE stock_moves(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid NOT NULL REFERENCES variants(id), delta integer NOT NULL, reason text NOT NULL, actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE wishlist(user_id uuid REFERENCES users(id), product_id uuid REFERENCES products(id), PRIMARY KEY(user_id,product_id));
CREATE TABLE orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 customer_id uuid REFERENCES users(id), placed_by uuid NOT NULL REFERENCES users(id),
 customer_name text NOT NULL, customer_phone text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('ONLINE','SHOP','BESPOKE')),
 fulfilment text NOT NULL CHECK(fulfilment IN ('DELIVERY','PICKUP','IN_SHOP')),
 status text NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK(status IN ('AWAITING_PAYMENT','CONFIRMED','IN_PRODUCTION','READY','OUT_FOR_DELIVERY','COMPLETED','CANCELLED')),
 subtotal integer NOT NULL CHECK(subtotal>=0), tax integer NOT NULL CHECK(tax>=0), delivery_fee integer NOT NULL CHECK(delivery_fee>=0),
 total integer NOT NULL CHECK(total>0 AND total<=100000000), paid integer NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total),
 deposit_due integer NOT NULL CHECK(deposit_due>0 AND deposit_due<=total), zone_id text, address text, notes text,
 pickup_code text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders(customer_id,created_at DESC);
CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), variant_id uuid REFERENCES variants(id), product_name text NOT NULL, sku text, size text, color text, quantity integer NOT NULL CHECK(quantity>0), unit_price integer NOT NULL CHECK(unit_price>=0));
CREATE TABLE order_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), status text NOT NULL, note text NOT NULL, actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE request_keys(user_id uuid REFERENCES users(id), key uuid NOT NULL, scope text NOT NULL, hash text NOT NULL, result_id uuid, PRIMARY KEY(user_id,key,scope));
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id),
 provider text NOT NULL CHECK(provider IN ('MOMO','CASH')), reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 amount integer NOT NULL CHECK(amount>0), provider_currency text NOT NULL, phone text,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCESSFUL','FAILED')),
 submission text NOT NULL DEFAULT 'NEW' CHECK(submission IN ('NEW','SENT','UNCERTAIN')),
 provider_transaction_id text, failure text, actor_id uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz
);
CREATE UNIQUE INDEX one_pending_payment_per_order ON payments(order_id) WHERE status='PENDING';
CREATE TABLE deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
 driver_id uuid REFERENCES users(id), status text NOT NULL DEFAULT 'UNASSIGNED' CHECK(status IN ('UNASSIGNED','ASSIGNED','PICKED_UP','DELIVERED','FAILED')),
 proof text, assigned_at timestamptz, delivered_at timestamptz
);
CREATE TABLE bespoke (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, garment text NOT NULL, occasion text, budget integer, due_date date, description text NOT NULL, reference_url text,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','QUOTED','ACCEPTED','IN_PRODUCTION','FITTING','READY','COMPLETED','CANCELLED')),
 designer_id uuid REFERENCES users(id), tailor_id uuid REFERENCES users(id), quote integer CHECK(quote>0), quote_notes text,
 order_id uuid UNIQUE REFERENCES orders(id), measurements jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES users(id), bespoke_id uuid REFERENCES bespoke(id),
 staff_id uuid REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('CONSULTATION','MEASUREMENT','FITTING','COLLECTION')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, notes text,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','CONFIRMED','COMPLETED','CANCELLED'))
);
CREATE TABLE returns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), customer_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL, status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REJECTED','RECEIVED','REFUNDED')),
 amount integer CHECK(amount>0), refund_reference text, reviewed_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_return ON returns(order_id) WHERE status<>'REJECTED';
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL, body text NOT NULL,
 read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), subject text NOT NULL, body text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), action text NOT NULL, entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
