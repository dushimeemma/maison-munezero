ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK(provider IN ('MOMO','FLUTTERWAVE','CASH'));
ALTER TABLE payments ADD COLUMN payer_email text;
ALTER TABLE payments ADD COLUMN payer_name text;
ALTER TABLE payments ADD COLUMN authorization_url text;
ALTER TABLE payments ADD COLUMN sandbox boolean NOT NULL DEFAULT false;
UPDATE payments SET sandbox=true WHERE provider='MOMO' AND provider_currency='EUR';
CREATE UNIQUE INDEX unique_provider_settlement ON payments(provider,provider_transaction_id)
 WHERE provider<>'CASH' AND provider_transaction_id IS NOT NULL;
