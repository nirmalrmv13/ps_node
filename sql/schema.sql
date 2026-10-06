CREATE DATABASE IF NOT EXISTS serene_sanctuary
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE serene_sanctuary;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(100),
  role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_services_category (category)
);

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  brand VARCHAR(100),
  category VARCHAR(50) NOT NULL,
  description TEXT,
  size VARCHAR(30),
  price DECIMAL(10, 2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_products_category (category)
);

CREATE TABLE IF NOT EXISTS coupons (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  description VARCHAR(255),
  discount_type ENUM('percent', 'flat') NOT NULL,
  discount_value DECIMAL(10, 2) NOT NULL,
  max_discount DECIMAL(10, 2),
  min_subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  designation VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  joining_date DATE,
  commission_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Loyalty: one star per paid service; enough stars unlock a free service.
CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  stars SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  free_services_redeemed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(30) UNIQUE,
  subtotal DECIMAL(10, 2) NOT NULL,
  customer_id INT UNSIGNED,
  loyalty_discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  free_service_id INT UNSIGNED,
  stars_earned SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  coupon_code VARCHAR(30),
  discount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  taxable_value DECIMAL(10, 2) NOT NULL,
  gst_rate DECIMAL(5, 2) NOT NULL,
  cgst DECIMAL(10, 2) NOT NULL,
  sgst DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  item_type ENUM('service', 'product') NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  rate DECIMAL(10, 2) NOT NULL,
  line_total DECIMAL(10, 2) NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
);

-- Products consumed while performing services: deducted from stock, never charged.
CREATE TABLE IF NOT EXISTS invoice_product_usage (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  product_name VARCHAR(100) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_value DECIMAL(10, 2) NOT NULL,
  service_id INT UNSIGNED,
  service_name VARCHAR(100),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
  INDEX idx_usage_product (product_id)
);

-- Manual stock changes. Sales and service usage are read from the invoice tables.
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  reason ENUM('opening', 'received', 'returned', 'damaged', 'expired', 'count') NOT NULL,
  quantity_change INT NOT NULL,
  stock_after INT UNSIGNED NOT NULL,
  note VARCHAR(255),
  user_id INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products (id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_adjustments_product (product_id, created_at)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  client_name VARCHAR(100) NOT NULL,
  client_phone VARCHAR(20),
  status ENUM('pending', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show')
    NOT NULL DEFAULT 'confirmed',
  notes VARCHAR(1000),
  invoice_id INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees (id),
  FOREIGN KEY (service_id) REFERENCES services (id),
  FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE SET NULL,
  INDEX idx_appointments_day (appointment_date, employee_id)
);
