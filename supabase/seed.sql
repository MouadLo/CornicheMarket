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
-- LOCAL DEV ONLY: a real, working password (bcrypt via pgcrypto) so this
-- account can actually sign in through the app, not just exist as a row.
-- Never seed a real environment with known credentials like this.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000aa',
  'authenticated', 'authenticated', 'owner@corniche.local', crypt('owner123', gen_salt('bf')),
  now(), now(), now(), '{}', '{}',
  '', '', '', ''
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

-- ============================================================
-- A second supplier and a cashier account, so the catalogue and the
-- sales below reflect more than one person touching the shop.
-- ============================================================

insert into suppliers (id, name, phone) values
  ('00000000-0000-0000-0000-00000000a002', 'Distributeur Atlas', '0655555555');

-- LOCAL DEV ONLY: see the owner account above for why this has a real
-- working password instead of an empty one.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000bb',
  'authenticated', 'authenticated', 'cashier@corniche.local', crypt('cashier123', gen_salt('bf')),
  now(), now(), now(), '{}', '{}',
  '', '', '', ''
)
  on conflict (id) do nothing;

-- The on_auth_user_created trigger defaults new profiles to 'cashier',
-- which is exactly the role this account needs.
update profiles set full_name = 'Amina Cashier'
where id = '00000000-0000-0000-0000-0000000000bb';

-- ============================================================
-- ~150 additional generated products (on top of the 50 above), from the
-- second supplier, to reach a realistic ~200-product catalogue. Combines
-- 40 base products -- each with both a French and an Arabic name -- with
-- 4 size/edition variants, alternating which language is used per
-- combination so both scripts show up across the catalogue rather than as
-- a token gesture.
--
-- One designated product (base idx 5 x variant 1 -> "مشروب طاقة") never
-- gets a purchase, so it keeps the default current_cost_cents = 0: a
-- product sold without ever having its buying price recorded, which is a
-- real data-entry gap this app has to show a sane margin for rather than a
-- misleading 100% (see docs/PRE-LAUNCH-GAPS.md#i2). It gets real, sellable
-- stock via a direct update afterwards, since skipping its purchase also
-- skips the trigger that would otherwise set stock_quantity.
-- ============================================================
with
  category_ids (idx, id) as (
    values
      (1, '00000000-0000-0000-0000-000000000001'::uuid),
      (2, '00000000-0000-0000-0000-000000000002'::uuid),
      (3, '00000000-0000-0000-0000-000000000003'::uuid),
      (4, '00000000-0000-0000-0000-000000000004'::uuid),
      (5, '00000000-0000-0000-0000-000000000005'::uuid),
      (6, '00000000-0000-0000-0000-000000000006'::uuid),
      (7, '00000000-0000-0000-0000-000000000007'::uuid),
      (8, '00000000-0000-0000-0000-000000000008'::uuid)
  ),
  base_names (idx, name_fr, name_ar, category_idx, base_price_cents, unit) as (
    values
      (1, 'Jus Pomme', 'عصير تفاح', 1, 1000, 'piece'),
      (2, 'Jus Ananas', 'عصير أناناس', 1, 1100, 'piece'),
      (3, 'Eau gazeuse', 'ماء غازي', 1, 600, 'piece'),
      (4, 'Limonade', 'ليموناضة', 1, 700, 'piece'),
      (5, 'Boisson energetique', 'مشروب طاقة', 1, 1700, 'piece'),
      (6, 'Biscuits fourres', 'بسكويت محشو', 2, 850, 'piece'),
      (7, 'Chips paprika', 'شيبس بابريكا', 2, 750, 'piece'),
      (8, 'Gateau Oum Ali', 'كيكة أم علي', 2, 1200, 'piece'),
      (9, 'Amandes grillees', 'لوز محمص', 2, 1800, 'piece'),
      (10, 'Barre chocolatee', 'شوكولاتة', 2, 450, 'piece'),
      (11, 'Lentilles', 'عدس', 3, 1100, 'kg'),
      (12, 'Pois chiches', 'حمص', 3, 1000, 'kg'),
      (13, 'Semoule fine', 'سميد ناعم', 3, 700, 'piece'),
      (14, 'Vinaigre', 'خل', 3, 500, 'piece'),
      (15, 'Olives vertes', 'زيتون أخضر', 3, 1400, 'kg'),
      (16, 'Yaourt nature', 'ياغورت طبيعي', 4, 300, 'piece'),
      (17, 'Fromage Jben', 'جبن محلي', 4, 1600, 'piece'),
      (18, 'Creme fraiche', 'قشدة طرية', 4, 900, 'piece'),
      (19, 'Lait demi-ecreme', 'حليب نصف دسم', 4, 1100, 'piece'),
      (20, 'Petit Suisse', 'بوتي سويس', 4, 400, 'piece'),
      (21, 'Gel douche', 'جل استحمام', 5, 3200, 'piece'),
      (22, 'Rasoirs jetables', 'شفرات حلاقة', 5, 1500, 'pack'),
      (23, 'Coton-tiges', 'أعواد قطنية', 5, 800, 'pack'),
      (24, 'Mouchoirs', 'مناديل ورقية', 5, 600, 'pack'),
      (25, 'Savon liquide mains', 'صابون سائل', 5, 1300, 'piece'),
      (26, 'Pain au lait', 'خبز الحليب', 6, 250, 'piece'),
      (27, 'Msemen', 'مسمن', 6, 300, 'piece'),
      (28, 'Harcha', 'حرشة', 6, 350, 'piece'),
      (29, 'Khobz dar', 'خبز الدار', 6, 400, 'piece'),
      (30, 'Pain complet tranche', 'خبز كامل مقطع', 6, 900, 'piece'),
      (31, 'Courgettes', 'كوسا', 7, 500, 'kg'),
      (32, 'Poivrons', 'فليفلة', 7, 700, 'kg'),
      (33, 'Concombres', 'خيار', 7, 450, 'kg'),
      (34, 'Citrons', 'ليمون', 7, 600, 'kg'),
      (35, 'Raisin', 'عنب', 7, 1200, 'kg'),
      (36, 'Briquet', 'قداحة', 8, 400, 'piece'),
      (37, 'Pile bouton', 'بطارية صغيرة', 8, 800, 'pack'),
      (38, 'Chargeur USB', 'شاحن USB', 8, 2500, 'piece'),
      (39, 'Enveloppes', 'أظرفة', 8, 1000, 'pack'),
      (40, 'Ballon gonflable', 'بالون', 8, 500, 'pack')
  ),
  variants (vidx, suffix, price_mult) as (
    values
      (1, '', 1.0),
      (2, ' Format Familial', 1.8),
      (3, ' Format Voyage', 0.6),
      (4, ' Edition Speciale', 1.3)
  ),
  generated_rows (gidx, name, barcode, category_id, unit, selling_price_cents, low_stock_threshold, buy_qty, buy_cost_cents) as (
    select
      (b.idx - 1) * 4 + v.vidx as gidx,
      case when (b.idx + v.vidx) % 2 = 0 then b.name_ar || v.suffix else b.name_fr || v.suffix end,
      -- Roughly one generated product in eight has no barcode, same as a
      -- handful of the curated 50 (loose produce).
      case when ((b.idx - 1) * 4 + v.vidx) % 8 = 0 then null
        else '6112' || lpad(((b.idx - 1) * 4 + v.vidx)::text, 9, '0')
      end,
      c.id,
      b.unit::product_unit,
      (round(b.base_price_cents * v.price_mult / 50) * 50)::bigint,
      (case when b.unit = 'kg' then 5 else (5 + (b.idx % 15)) end)::numeric,
      (case when b.unit = 'kg' then (10 + (b.idx % 20)) else (20 + (b.idx % 40)) end)::numeric,
      (round(b.base_price_cents * v.price_mult * 0.65 / 50) * 50)::bigint
    from base_names b
    cross join variants v
    join category_ids c on c.idx = b.category_idx
  ),
  limited_rows as (
    select * from generated_rows order by gidx limit 150
  ),
  inserted_generated as (
    insert into products (name, barcode, category_id, unit, selling_price_cents, current_cost_cents, stock_quantity, low_stock_threshold, active)
    select name, barcode, category_id, unit, selling_price_cents, 0, 0, low_stock_threshold, true
    from limited_rows
    returning id, name
  ),
  new_purchase_2 as (
    insert into purchases (id, supplier_id, created_by, notes)
    values (
      '00000000-0000-0000-0000-0000000000a2',
      '00000000-0000-0000-0000-00000000a002',
      '00000000-0000-0000-0000-0000000000aa',
      'Seed: second supplier initial stock load'
    )
    returning id
  )
insert into purchase_items (purchase_id, product_id, quantity, unit_cost_cents)
select (select id from new_purchase_2), ig.id, lr.buy_qty, lr.buy_cost_cents
from inserted_generated ig
join limited_rows lr on lr.name = ig.name
where lr.gidx <> 17;

-- The designated zero-cost product (gidx 17 above: base idx 5 "Boisson
-- energetique" x variant 1, which the naming parity rule above resolves to
-- its Arabic name "مشروب طاقة"). It never got a purchase, so it still has
-- stock_quantity = 0 from the insert above; give it real, sellable stock.
update products
set stock_quantity = 25
where name = 'مشروب طاقة'
  and current_cost_cents = 0;

-- ============================================================
-- Three customers with varied credit states -- one outstanding, one
-- partially paid, one fully settled -- so customer_balances shows a
-- believable range instead of every customer looking the same.
-- ============================================================

insert into customers (id, name, phone) values
  ('00000000-0000-0000-0000-0000000000c1', 'Fatima Zahra', '0611111111'),
  ('00000000-0000-0000-0000-0000000000c2', 'Youssef Amrani', '0622222222'),
  ('00000000-0000-0000-0000-0000000000c3', 'Khadija Bennani', '0633333333');

do $$
declare
  v_owner uuid;
  v_product_a uuid;
  v_product_b uuid;
  v_price_a bigint;
  v_price_b bigint;
  v_sale_id uuid;
  v_total bigint;
begin
  select id into v_owner from profiles where full_name = 'Seed System' limit 1;
  select id, selling_price_cents into v_product_a, v_price_a from products where active order by name limit 1;
  select id, selling_price_cents into v_product_b, v_price_b
    from products where active order by name offset 1 limit 1;

  -- Fatima Zahra: one unpaid credit sale -> outstanding balance.
  v_sale_id := gen_random_uuid();
  insert into sales (id, cashier_id, customer_id, payment_method, occurred_at, created_at)
  values (v_sale_id, v_owner, '00000000-0000-0000-0000-0000000000c1', 'credit',
          now() - interval '20 days', now() - interval '20 days');
  insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
  values (v_sale_id, v_product_a, 4, v_price_a, 0);
  update sales set total_cents = (select sum(line_total_cents) from sale_items where sale_id = v_sale_id)
  where id = v_sale_id;

  -- Youssef Amrani: one credit sale, half paid off.
  v_sale_id := gen_random_uuid();
  insert into sales (id, cashier_id, customer_id, payment_method, occurred_at, created_at)
  values (v_sale_id, v_owner, '00000000-0000-0000-0000-0000000000c2', 'credit',
          now() - interval '15 days', now() - interval '15 days');
  insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
  values (v_sale_id, v_product_b, 6, v_price_b, 0);
  update sales set total_cents = (select sum(line_total_cents) from sale_items where sale_id = v_sale_id)
  where id = v_sale_id;
  select total_cents into v_total from sales where id = v_sale_id;
  insert into customer_payments (customer_id, amount_cents, method, created_by)
  values ('00000000-0000-0000-0000-0000000000c2', greatest(1, v_total / 2), 'cash', v_owner);

  -- Khadija Bennani: one credit sale, fully settled.
  v_sale_id := gen_random_uuid();
  insert into sales (id, cashier_id, customer_id, payment_method, occurred_at, created_at)
  values (v_sale_id, v_owner, '00000000-0000-0000-0000-0000000000c3', 'credit',
          now() - interval '25 days', now() - interval '25 days');
  insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
  values (v_sale_id, v_product_a, 2, v_price_a, 0);
  update sales set total_cents = (select sum(line_total_cents) from sale_items where sale_id = v_sale_id)
  where id = v_sale_id;
  select total_cents into v_total from sales where id = v_sale_id;
  insert into customer_payments (customer_id, amount_cents, method, created_by)
  values ('00000000-0000-0000-0000-0000000000c3', v_total, 'cash', v_owner);
end $$;

-- ============================================================
-- ~300 historical sales spread over the last 60 days, split between the
-- owner and the cashier, for believable reports/history/receipts data.
--
-- Bypasses record_sale (which needs an authenticated session for
-- auth.uid()) and inserts into sales/sale_items directly. The existing
-- triggers -- stamp_sale_item_cost (cost snapshot + oversold flag) and
-- apply_sale_item_stock (stock decrement) -- still run exactly as they
-- would for a real till sale, which is what makes the resulting stock
-- levels, costs and oversold flags authentic rather than hand-faked.
-- discount_cents is set at the SALE level only here (sale_items keep
-- discount_cents = 0), which is enough variety for local testing without
-- needing per-line discount allocation in generated data.
-- ============================================================
with
  cashier_profile as (select id from profiles where full_name = 'Amina Cashier' limit 1),
  owner_profile as (select id from profiles where full_name = 'Seed System' limit 1),
  sellable_products as (
    select id, selling_price_cents, unit from products where active
  ),
  sale_seeds as (
    select
      n,
      gen_random_uuid() as id,
      now()
        - (random() * 60)::int * interval '1 day'
        - (random() * 86400)::int * interval '1 second' as occurred_at,
      (array['cash','cash','cash','cash','card','card','credit'])[1 + floor(random() * 7)::int]::payment_method
        as payment_method,
      case when random() < 0.15 then (20 + floor(random() * 400))::bigint else 0 end as discount_cents
    from generate_series(1, 300) as n
  ),
  inserted_sales as (
    insert into sales (id, cashier_id, payment_method, discount_cents, occurred_at, created_at)
    select
      s.id,
      case when random() < 0.7
        then (select id from cashier_profile)
        else (select id from owner_profile)
      end,
      s.payment_method,
      s.discount_cents,
      s.occurred_at,
      s.occurred_at
    from sale_seeds s
    returning id
  ),
  -- LATERAL alone does not force per-row re-evaluation: since this
  -- subquery has no actual reference to the outer row, the planner is
  -- free to treat it as independent of inserted_sales and evaluate it
  -- ONCE, then reuse that single draw for every sale -- which is exactly
  -- what happened on the first pass (three products ended up in literally
  -- every one of the 300 sales, one of them driven to stock_quantity
  -- -544). Ordering by a hash of isale.id makes the subquery genuinely
  -- correlated, which forces Postgres to run it as a true per-row nested
  -- loop; it also makes which products end up in which sale reproducible
  -- for a given seed run, rather than depending on planner whims.
  sale_lines as (
    select isale.id as sale_id, p.id as product_id, p.selling_price_cents as unit_price_cents, p.unit
    from inserted_sales isale
    cross join lateral (
      select id, selling_price_cents, unit
      from sellable_products
      order by md5(isale.id::text || id::text)
      limit (1 + floor(random() * 4))::int
    ) p
  )
insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
select
  sale_id,
  product_id,
  case when unit = 'kg' then round((0.3 + random() * 2.7)::numeric, 3) else (1 + floor(random() * 3))::numeric end,
  unit_price_cents,
  0
from sale_lines;

-- Totals couldn't be known until the lines above existed; fix them up now.
-- Scoped to exactly the sales just seeded (total_cents still at its
-- column default of 0, with at least one line) so this never touches the
-- credit-customer sales above, which already got their own totals.
update sales s
set total_cents = greatest(
  0,
  coalesce((select sum(si.line_total_cents) from sale_items si where si.sale_id = s.id), 0) - s.discount_cents
)
where s.total_cents = 0
  and exists (select 1 from sale_items si where si.sale_id = s.id);

-- ============================================================
-- Void ~3% of the seeded sales, restoring their stock the same way
-- void_sale does (bypassing the RPC itself, since there is no
-- authenticated session in a seed script to satisfy its owner check).
--
-- Excludes the three customers' credit sales above: those exist
-- specifically to demonstrate three different balance states
-- (outstanding / partially paid / settled), and a random void landing on
-- one of them would zero out that customer's balance and make the demo
-- data depend on luck rather than being reliably there after every reset.
-- ============================================================
with to_void as (
  select id from sales
  where voided_at is null
    -- "customer_id not in (...)" would silently exclude every NULL-
    -- customer (plain cash/card) sale too, since NULL NOT IN (...) is
    -- NULL, not true. Spelled out explicitly to avoid that trap.
    and (
      customer_id is null
      or customer_id not in (
        '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c2',
        '00000000-0000-0000-0000-0000000000c3'
      )
    )
  order by random()
  limit (select greatest(1, round(count(*) * 0.03)::int) from sales)
),
restock as (
  select si.product_id, sum(si.quantity) as qty
  from sale_items si
  where si.sale_id in (select id from to_void)
  group by si.product_id
),
stock_update as (
  update products p
  set stock_quantity = p.stock_quantity + r.qty
  from restock r
  where r.product_id = p.id
  returning p.id
)
update sales
set voided_at = now(),
    voided_by = (select id from profiles where full_name = 'Seed System' limit 1),
    void_reason = 'Remboursement client'
where id in (select id from to_void);

-- ============================================================
-- Guarantee at least two oversold products, deterministically, rather
-- than leaving it to chance: the two lowest (but still positive) stock
-- active products each get one sale asking for more than they have. The
-- existing triggers compute sale_items.oversold and
-- products.stock_went_negative_at exactly as they would for a real sale.
-- ============================================================
do $$
declare
  v_product record;
  v_sale_id uuid;
  v_cashier uuid;
begin
  select id into v_cashier from profiles where full_name = 'Amina Cashier' limit 1;

  for v_product in
    select id, stock_quantity, selling_price_cents
    from products
    where active and stock_quantity between 1 and 20
    order by stock_quantity asc
    limit 2
  loop
    v_sale_id := gen_random_uuid();

    insert into sales (id, cashier_id, payment_method, occurred_at, created_at)
    values (v_sale_id, v_cashier, 'cash', now() - interval '2 hours', now() - interval '2 hours');

    insert into sale_items (sale_id, product_id, quantity, unit_price_cents, discount_cents)
    values (v_sale_id, v_product.id, v_product.stock_quantity + 5, v_product.selling_price_cents, 0);

    update sales set total_cents = (select sum(line_total_cents) from sale_items where sale_id = v_sale_id)
    where id = v_sale_id;
  end loop;
end $$;

-- ============================================================
-- Print the local-only login credentials so `supabase db reset` always
-- ends by telling you how to actually sign in, instead of leaving you to
-- go dig through this file.
-- ============================================================
do $$
begin
  raise notice '';
  raise notice '=====================================================';
  raise notice 'Seeded accounts for LOCAL sign-in (never use in production):';
  raise notice '  Owner:   owner@corniche.local   / owner123';
  raise notice '  Cashier: cashier@corniche.local / cashier123';
  raise notice '=====================================================';
end $$;
