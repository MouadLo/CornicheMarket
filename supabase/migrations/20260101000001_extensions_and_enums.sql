-- Extensions
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";
-- crypt()/gen_salt(): used by seed.sql to give the local-only seeded auth
-- users (owner/cashier) a real, working bcrypt password hash.
create extension if not exists pgcrypto;

-- Enums
create type user_role as enum ('owner', 'cashier');
create type product_unit as enum ('piece', 'kg', 'pack');
create type payment_method as enum ('cash', 'card', 'credit');
create type adjustment_reason as enum ('damaged', 'expired', 'theft', 'count_correction');
