USE serene_sanctuary;

CREATE TABLE IF NOT EXISTS store_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  business_name VARCHAR(120) NOT NULL,
  short_name VARCHAR(80) NOT NULL,
  tagline VARCHAR(160) NOT NULL DEFAULT '',
  address VARCHAR(500) NOT NULL DEFAULT '',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  logo_url VARCHAR(1000) NOT NULL DEFAULT '',
  weekday_opens_at TIME NOT NULL DEFAULT '10:00:00',
  weekday_closes_at TIME NOT NULL DEFAULT '18:00:00',
  weekend_opens_at TIME NOT NULL DEFAULT '09:00:00',
  weekend_closes_at TIME NOT NULL DEFAULT '18:00:00',
  gstin VARCHAR(30) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO store_settings (
  id, business_name, short_name, tagline, address, phone, email, logo_url,
  weekday_opens_at, weekday_closes_at, weekend_opens_at, weekend_closes_at, gstin
) VALUES (
  1,
  'Pro Signature Unisex Salon',
  'Pro Signature',
  'Your Look, Our Signature',
  '',
  '',
  '',
  '',
  '10:00:00',
  '18:00:00',
  '09:00:00',
  '18:00:00',
  ''
)
ON DUPLICATE KEY UPDATE
  weekday_opens_at = VALUES(weekday_opens_at),
  weekday_closes_at = VALUES(weekday_closes_at),
  weekend_opens_at = VALUES(weekend_opens_at),
  weekend_closes_at = VALUES(weekend_closes_at);
