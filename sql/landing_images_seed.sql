-- Default landing / carousel images served by the Express backend.
-- Only insert when the table is empty so admin edits are never overwritten.
INSERT INTO landing_images (section, title, alt_text, image_url, sort_order, is_active)
SELECT * FROM (
  SELECT 'hero' AS section, 'Hero 1' AS title, 'Spa suite with soft light' AS alt_text, '/api/public/landing-media/spa-room.png' AS image_url, 10 AS sort_order, 1 AS is_active
  UNION ALL SELECT 'hero', 'Hero 2', 'Salon atmosphere', '/api/public/landing-media/hero.png', 20, 1
  UNION ALL SELECT 'hero', 'Hero 3', 'Hair studio floor', '/api/public/landing-media/salon-hair.jpg', 30, 1
  UNION ALL SELECT 'service', 'Hair studio', 'Cuts, colour, and styling for every guest — precise, modern, unisex.', '/api/public/landing-media/salon-hair.jpg', 10, 1
  UNION ALL SELECT 'service', 'Spa rituals', 'Massage, facials, and restorative treatments in a calm private suite.', '/api/public/landing-media/salon-spa.jpg', 20, 1
  UNION ALL SELECT 'service', 'Grooming & finish', 'Beard work, nails, and detailing so every visit ends with polish.', '/api/public/landing-media/salon-grooming.jpg', 30, 1
  UNION ALL SELECT 'gallery', 'Spa suite', 'Spa suite with massage table and soft light', '/api/public/landing-media/spa-room.png', 10, 1
  UNION ALL SELECT 'gallery', 'Hair studio', 'Hair studio floor', '/api/public/landing-media/salon-hair.jpg', 20, 1
  UNION ALL SELECT 'gallery', 'Spa room', 'Spa room prepared for treatment', '/api/public/landing-media/salon-spa.jpg', 30, 1
  UNION ALL SELECT 'gallery', 'Grooming', 'Grooming tools at the station', '/api/public/landing-media/salon-grooming.jpg', 40, 1
  UNION ALL SELECT 'gallery', 'Atmosphere', 'Salon atmosphere', '/api/public/landing-media/hero.png', 50, 1
  UNION ALL SELECT 'experience', 'Experience 1', 'Salon atmosphere', '/api/public/landing-media/hero.png', 10, 1
  UNION ALL SELECT 'experience', 'Experience 2', 'Spa treatment room', '/api/public/landing-media/salon-spa.jpg', 20, 1
  UNION ALL SELECT 'visit', 'Visit banner', 'Plan your visit', '/api/public/landing-media/salon-grooming.jpg', 10, 1
) AS seed
WHERE (SELECT COUNT(*) FROM landing_images) = 0;
