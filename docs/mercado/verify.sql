-- Run in Supabase SQL Editor / MCP. All fixtures are rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  consumer_id uuid := gen_random_uuid();
  device_id uuid;
  model_id uuid;
  request_id uuid;
  changed integer;
begin
  insert into auth.users(id, aud, role, email) values
    (owner_id, 'authenticated', 'authenticated', owner_id::text || '@example.invalid'),
    (consumer_id, 'authenticated', 'authenticated', consumer_id::text || '@example.invalid');
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  execute 'set local role authenticated';
  insert into mercado.perfiles(id,nombre) values(owner_id,'Verificacion temporal');
  insert into mercado.equipos(usuario_id,nombre) values(owner_id,'PC temporal') returning id into device_id;
  insert into mercado.modelos(proveedor_id,equipo_id,etiqueta,origen,modelo,habilitado)
    values(owner_id,device_id,'Verificacion temporal','local','verificacion-temporal',false) returning id into model_id;
  update mercado.modelos set etiqueta='Edicion temporal' where id=model_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Owner cannot edit own model'; end if;
  perform set_config('request.jwt.claim.sub', consumer_id::text, true);
  insert into mercado.perfiles(id,nombre) values(consumer_id,'Consumidor temporal');
  if exists(select 1 from mercado.modelos where id=model_id) then raise exception 'Paused model leaked'; end if;
  if exists(select 1 from mercado.equipos where id=device_id) then raise exception 'Private device leaked'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  update mercado.modelos set habilitado=true where id=model_id;
  perform set_config('request.jwt.claim.sub', consumer_id::text, true);
  if not exists(select 1 from mercado.modelos m join mercado.perfiles p on p.id=m.proveedor_id where m.id=model_id) then raise exception 'Public catalog/profile join failed'; end if;
  update mercado.modelos set etiqueta='Unauthorized' where id=model_id;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Non-owner edited model'; end if;
  insert into mercado.solicitudes(consumidor_id,modelo_id,proveedor_id,entrada)
    values(consumer_id,model_id,owner_id,'{}'::jsonb) returning id into request_id;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if not exists(select 1 from mercado.solicitudes where id=request_id) then raise exception 'Provider cannot see request'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if exists(select 1 from mercado.solicitudes where id=request_id) then raise exception 'Request leaked'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  begin
    delete from mercado.modelos where id=model_id;
    raise exception 'Model with request should not be removable';
  exception when foreign_key_violation then null;
  end;
  -- Returning to admin only to remove this temporary request, not to bypass app authorization.
  execute 'reset role';
  delete from mercado.solicitudes where id=request_id;
  execute 'set local role authenticated';
  delete from mercado.modelos where id=model_id;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Owner cannot remove model without requests'; end if;
end $$;
rollback;
