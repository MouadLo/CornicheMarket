-- Extensions
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

-- Enums
create type user_role as enum ('owner', 'cashier');
create type product_unit as enum ('piece', 'kg', 'pack');
create type payment_method as enum ('cash', 'card', 'credit');
create type adjustment_reason as enum ('damaged', 'expired', 'theft', 'count_correction');
