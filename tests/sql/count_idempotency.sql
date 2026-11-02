-- Run against disposable local Supabase: psql -v ON_ERROR_STOP=1 -f this-file.
begin;
insert into products(id,name,selling_price_cents,stock_quantity) values
 ('f0000000-0000-4000-8000-000000000001','C04 fixture A',100,10),
 ('f0000000-0000-4000-8000-000000000002','C04 fixture B',100,10);
select set_config('request.jwt.claim.sub',(select id::text from profiles where role='owner' limit 1),true);
set local role authenticated;
select record_stock_adjustment('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000001',-2,'count_correction','Shelf count');
-- Lost response: replay the exact operation, then submit the second batch.
select record_stock_adjustment('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000001',-2,'count_correction','Shelf count');
select record_stock_adjustment('f0000000-0000-4000-8000-000000000012','f0000000-0000-4000-8000-000000000002',-1,'count_correction','Shelf count');
do $$ begin
 if (select stock_quantity from products where id='f0000000-0000-4000-8000-000000000001') <> 8 then raise exception 'A replayed'; end if;
 if (select stock_quantity from products where id='f0000000-0000-4000-8000-000000000002') <> 9 then raise exception 'B incorrect'; end if;
 if (select count(*) from stock_adjustments where id in ('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000012')) <> 2 then raise exception 'Duplicate event'; end if;
 begin
  perform record_stock_adjustment('f0000000-0000-4000-8000-000000000011','f0000000-0000-4000-8000-000000000001',-3,'count_correction','Shelf count');
  raise exception 'Changed payload accepted';
 exception when invalid_parameter_value then null;
 end;
end $$;
select name,stock_quantity from products where id in ('f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002') order by name;
rollback;
