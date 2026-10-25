-- Full history of cost changes per product, so historical profit calculations
-- never have to guess what the cost "must have been" at a given date.
create table cost_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  cost_cents bigint not null check (cost_cents >= 0),
  source text not null, -- 'purchase' | 'manual_adjustment'
  purchase_item_id uuid, -- set when source = 'purchase'; FK added after purchase_items exists
  effective_at timestamptz not null default now()
);

create index idx_cost_history_product on cost_history (product_id, effective_at desc);
