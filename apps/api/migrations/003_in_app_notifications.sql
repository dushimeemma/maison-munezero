ALTER TABLE notifications ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
