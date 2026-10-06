USE serene_sanctuary;

INSERT INTO services (name, category, description, duration_minutes, price) VALUES
  ('Signature Haircut & Style', 'Hair', 'Consultation, precision cut, wash and blow-dry styled to suit you.', 45, 800.00),
  ('Nourishing Hair Spa', 'Hair', 'Deep-conditioning treatment with scalp massage to restore shine and softness.', 60, 1500.00),
  ('Global Hair Colour', 'Hair', 'Full-head ammonia-free colour with a gloss finish.', 120, 3500.00),
  ('Keratin Smoothing Treatment', 'Hair', 'Frizz-control treatment for smooth, manageable hair for up to 3 months.', 150, 6000.00),
  ('Hydrating Facial', 'Skin', 'Cleanse, exfoliate and hydrate with a hyaluronic mask for a dewy glow.', 60, 2000.00),
  ('Gold Radiance Facial', 'Skin', 'Brightening facial with 24K gold serum and lymphatic massage.', 75, 3000.00),
  ('Anti-Ageing Facial', 'Skin', 'Firming treatment with peptides and LED therapy to reduce fine lines.', 75, 3500.00),
  ('Swedish Relaxation Massage', 'Massage', 'Gentle full-body massage with long flowing strokes to melt away stress.', 60, 2500.00),
  ('Deep Tissue Massage', 'Massage', 'Firm pressure massage targeting muscle tension and knots.', 60, 3000.00),
  ('Aromatherapy Massage', 'Massage', 'Full-body massage with your choice of calming essential oil blend.', 90, 3500.00),
  ('Hot Stone Therapy', 'Massage', 'Heated basalt stones release deep tension and improve circulation.', 90, 4000.00),
  ('Classic Manicure', 'Nails', 'Nail shaping, cuticle care, hand massage and polish.', 30, 600.00),
  ('Spa Pedicure', 'Nails', 'Foot soak, scrub, callus care, massage and polish.', 45, 900.00),
  ('Gel Polish', 'Nails', 'Long-lasting, chip-resistant gel colour for hands or feet.', 45, 1200.00),
  ('Body Polish & Wrap', 'Spa Rituals', 'Full-body exfoliation followed by a nourishing herbal wrap.', 90, 4500.00),
  ('Couples Retreat Package', 'Spa Rituals', 'Side-by-side aromatherapy massage, facial and herbal tea for two.', 120, 8000.00)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO products (name, brand, category, description, size, price, stock) VALUES
  ('Argan Oil Repair Shampoo', 'Serene Botanicals', 'Hair Care', 'Sulphate-free shampoo with argan oil to repair dry, damaged hair.', '250 ml', 650.00, 40),
  ('Keratin Smooth Conditioner', 'Serene Botanicals', 'Hair Care', 'Lightweight conditioner that tames frizz and adds shine.', '250 ml', 700.00, 35),
  ('Rosemary Hair Growth Oil', 'Aroma Veda', 'Hair Care', 'Rosemary and bhringraj oil blend to strengthen roots.', '100 ml', 550.00, 50),
  ('Vitamin C Brightening Serum', 'Lotus Glow', 'Skin Care', '15% vitamin C serum for an even, radiant complexion.', '30 ml', 1200.00, 25),
  ('Hyaluronic Hydrating Moisturiser', 'Lotus Glow', 'Skin Care', 'Oil-free gel cream that locks in moisture all day.', '50 g', 950.00, 30),
  ('Rose Water Toner', 'Aroma Veda', 'Skin Care', 'Pure steam-distilled rose water to refresh and balance skin.', '200 ml', 400.00, 60),
  ('Charcoal Detox Face Mask', 'Lotus Glow', 'Skin Care', 'Clay and activated charcoal mask that draws out impurities.', '100 g', 600.00, 28),
  ('Lavender Body Butter', 'Serene Botanicals', 'Body Care', 'Rich shea butter cream with calming lavender.', '200 g', 750.00, 22),
  ('Coffee Body Scrub', 'Serene Botanicals', 'Body Care', 'Invigorating coffee and coconut scrub for smooth skin.', '200 g', 550.00, 30),
  ('Lavender Essential Oil', 'Aroma Veda', 'Aromatherapy', '100% pure lavender oil for relaxation and better sleep.', '15 ml', 450.00, 45),
  ('Eucalyptus Mint Massage Oil', 'Aroma Veda', 'Aromatherapy', 'Cooling massage oil to ease sore muscles.', '200 ml', 800.00, 20),
  ('Sandalwood Soy Candle', 'Serene Botanicals', 'Aromatherapy', 'Hand-poured soy candle with warm sandalwood notes. 40-hour burn.', '180 g', 900.00, 18),
  ('Nourishing Cuticle Oil', 'Lotus Glow', 'Nail Care', 'Vitamin E and almond oil to soften cuticles and strengthen nails.', '10 ml', 350.00, 40)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO coupons (code, description, discount_type, discount_value, max_discount, min_subtotal) VALUES
  ('RELAX20', '20% privilege discount on holistic wellness services.', 'percent', 20.00, NULL, 0.00),
  ('SERENE10', '10% off your folio, up to ₹1,000.', 'percent', 10.00, 1000.00, 0.00),
  ('WELCOME500', '₹500 off on folios of ₹3,000 or more.', 'flat', 500.00, NULL, 3000.00)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO employees (employee_code, name, designation, phone, email, joining_date, commission_percent) VALUES
  ('EMP001', 'Priya Sharma', 'Senior Stylist', '9876500001', 'priya@prosignature.in', '2023-04-10', 10.00),
  ('EMP002', 'Rahul Verma', 'Hair Stylist', '9876500002', NULL, '2024-01-15', 8.00),
  ('EMP003', 'Anjali Nair', 'Beautician', '9876500003', 'anjali@prosignature.in', '2024-06-01', 8.00),
  ('EMP004', 'Meera Das', 'Spa Therapist', '9876500004', NULL, '2025-02-20', 7.50)
ON DUPLICATE KEY UPDATE id = id;
