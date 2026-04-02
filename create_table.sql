CREATE TABLE IF NOT EXISTS paypal_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  package_index INTEGER,
  amount INTEGER,
  status TEXT DEFAULT 'pending',
  custom_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paypal_orders_user ON paypal_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_paypal_orders_status ON paypal_orders(status);
