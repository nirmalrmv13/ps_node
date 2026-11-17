CREATE TABLE IF NOT EXISTS landing_images (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  section ENUM('hero', 'service', 'gallery', 'experience', 'visit') NOT NULL,
  title VARCHAR(100) NULL,
  alt_text VARCHAR(255) NULL,
  image_url VARCHAR(1000) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_landing_images_section (section, sort_order, is_active)
);
