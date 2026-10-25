-- Phase 1 seed data: categories, a supplier, and 50 realistic convenience-
-- store products. Each product gets an initial purchase so stock and
-- current_cost_cents are populated through the normal trigger path
-- (never written to directly).
--
-- NOTE: insert an owner profile row yourself after creating your first
-- Supabase Auth user, e.g.:
--   update profiles set role = 'owner' where id = '<your-auth-user-uuid>';

insert into categories (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Boissons'),
  ('00000000-0000-0000-0000-000000000002', 'Snacks'),
  ('00000000-0000-0000-0000-000000000003', 'Épicerie'),
  ('00000000-0000-0000-0000-000000000004', 'Produits laitiers'),
  ('00000000-0000-0000-0000-000000000005', 'Hygiène'),
  ('00000000-0000-0000-0000-000000000006', 'Boulangerie'),
  ('00000000-0000-0000-0000-000000000007', 'Fruits et légumes'),
  ('00000000-0000-0000-0000-000000000008', 'Autres');

insert into suppliers (id, name, phone) values
  ('00000000-0000-0000-0000-00000000a001', 'Gros Marché Corniche', '0600000000');

-- A system-owned bootstrap profile used only as created_by/cashier_id for
-- seed purchases and nothing else (real users sign up through Supabase Auth).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000aa',
  'authenticated', 'authenticated', 'seed-system@corniche.local', '',
  now(), now(), now(), '{}', '{}'
)
  on conflict (id) do nothing;

-- The on_auth_user_created trigger already created a 'cashier' profile row;
-- promote it so seed purchases can be attributed to an owner.
update profiles set role = 'owner', full_name = 'Seed System'
where id = '00000000-0000-0000-0000-0000000000aa';

-- Products: (name, barcode, category, unit, selling_price_cents, low_stock_threshold)
with product_rows (name, barcode, category_id, unit, selling_price_cents, low_stock_threshold, buy_qty, buy_cost_cents) as (
  values
    ('Coca-Cola 33cl', '6111000000011', '00000000-0000-0000-0000-000000000001'::uuid, 'piece'::product_unit, 700, 24, 48, 480),
    ('Coca-Cola 1.5L', '6111000000012', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 1500, 12, 24, 1050),
    ('Sidi Ali 1.5L', '6111000000013', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 500, 24, 48, 350),
    ('Oulmes 50cl', '6111000000014', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 600, 24, 48, 400),
    ('Jus Marrakech Orange 1L', '6111000000015', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 1200, 12, 24, 850),
    ('Hawai Citron 33cl', '6111000000016', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 500, 24, 48, 320),
    ('Red Bull 25cl', '6111000000017', '00000000-0000-0000-0000-000000000001', 'piece'::product_unit, 1800, 12, 24, 1300),
    ('Café Maxwell House 200g', '6111000000018', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 2500, 8, 16, 1900),
    ('Thé Sultan 25 sachets', '6111000000019', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 1800, 10, 20, 1350),
    ('Lait Centrale Danone 1L', '6111000000020', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 1200, 12, 24, 950),
    ('Yaourt Danone Pack x4', '6111000000021', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 1500, 8, 16, 1150),
    ('Fromage La Vache qui rit 8 parts', '6111000000022', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 1400, 8, 16, 1050),
    ('Beurre President 100g', '6111000000023', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 1100, 8, 16, 850),
    ('Oeufs (boite de 12)', '6111000000024', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 2200, 6, 12, 1800),
    ('Pain complet', '6111000000025', '00000000-0000-0000-0000-000000000006', 'piece'::product_unit, 600, 10, 30, 350),
    ('Croissant', '6111000000026', '00000000-0000-0000-0000-000000000006', 'piece'::product_unit, 300, 15, 30, 180),
    ('Baguette', '6111000000027', '00000000-0000-0000-0000-000000000006', 'piece'::product_unit, 150, 20, 40, 80),
    ('Biscuits Bimo Petit Dej', '6111000000028', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 900, 12, 24, 650),
    ('Chips Chipsy Nature', '6111000000029', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 700, 15, 30, 480),
    ('Chocolat Nestle Dessert', '6111000000030', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 1600, 8, 16, 1200),
    ('Chewing-gum Trident', '6111000000031', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 400, 20, 40, 250),
    ('Cacahuetes grillées 200g', '6111000000032', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 1000, 10, 20, 700),
    ('Barre Twix', '6111000000033', '00000000-0000-0000-0000-000000000002', 'piece'::product_unit, 500, 20, 40, 330),
    ('Riz Dari 1kg', '6111000000034', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 1500, 10, 20, 1150),
    ('Huile Lesieur 1L', '6111000000035', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 2800, 10, 20, 2300),
    ('Sucre Cristal 1kg', '6111000000036', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 1200, 10, 20, 950),
    ('Farine Mille Cinq 1kg', '6111000000037', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 900, 10, 20, 700),
    ('Sel fin 1kg', '6111000000038', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 400, 10, 20, 250),
    ('Pâtes Spig 500g', '6111000000039', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 800, 12, 24, 600),
    ('Concentré de tomate Aicha', '6111000000040', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 700, 12, 24, 520),
    ('Harissa Aicha', '6111000000041', '00000000-0000-0000-0000-000000000003', 'piece'::product_unit, 600, 10, 20, 430),
    ('Savon Rexona', '6111000000042', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 900, 12, 24, 650),
    ('Shampoo Head & Shoulders 200ml', '6111000000043', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 3500, 6, 12, 2800),
    ('Dentifrice Signal', '6111000000044', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 1800, 8, 16, 1350),
    ('Papier toilette pack x6', '6111000000045', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 2500, 8, 16, 1900),
    ('Couches bébé taille 3 pack', '6111000000046', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 7500, 4, 8, 6200),
    ('Lessive Tide 1kg', '6111000000047', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 4500, 6, 12, 3600),
    ('Déodorant Nivea', '6111000000048', '00000000-0000-0000-0000-000000000005', 'piece'::product_unit, 2800, 8, 16, 2100),
    ('Tomates', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 600, 5, 20, 400),
    ('Pommes de terre', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 500, 10, 30, 320),
    ('Oignons', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 450, 10, 30, 280),
    ('Bananes', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 900, 5, 15, 600),
    ('Oranges', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 700, 5, 15, 450),
    ('Carottes', null, '00000000-0000-0000-0000-000000000007', 'kg'::product_unit, 500, 5, 15, 320),
    ('Carte recharge téléphonique 20DH', '6111000000049', '00000000-0000-0000-0000-000000000008', 'piece'::product_unit, 2000, 20, 40, 1900),
    ('Allumettes', '6111000000050', '00000000-0000-0000-0000-000000000008', 'piece'::product_unit, 150, 30, 60, 70),
    ('Bougies pack x4', '6111000000051', '00000000-0000-0000-0000-000000000008', 'piece'::product_unit, 1000, 10, 20, 700),
    ('Piles AA pack x4', '6111000000052', '00000000-0000-0000-0000-000000000008', 'piece'::product_unit, 2500, 8, 16, 1900),
    ('Sacs plastique rouleau', '6111000000053', '00000000-0000-0000-0000-000000000008', 'pack'::product_unit, 1000, 10, 20, 700),
    ('Fromage frais Jibal 400g', '6111000000054', '00000000-0000-0000-0000-000000000004', 'piece'::product_unit, 1900, 8, 16, 1450)
),
inserted_products as (
  insert into products (name, barcode, category_id, unit, selling_price_cents, current_cost_cents, stock_quantity, low_stock_threshold, active)
  select name, barcode, category_id, unit, selling_price_cents, 0, 0, low_stock_threshold, true
  from product_rows
  returning id, name
),
new_purchase as (
  insert into purchases (id, supplier_id, created_by, notes)
  values (
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000000aa',
    'Seed: initial stock load'
  )
  returning id
)
insert into purchase_items (purchase_id, product_id, quantity, unit_cost_cents)
select (select id from new_purchase), ip.id, pr.buy_qty, pr.buy_cost_cents
from inserted_products ip
join product_rows pr on pr.name = ip.name;
