-- Base inicial de Mercado para Supabase. Ejecutar una vez en SQL Editor.
-- No incluye claves de modelos, endpoints privados, pagos ni ejecución.
begin;

create schema mercado;
revoke all on schema mercado from public, anon;
grant usage on schema mercado to authenticated;

create table mercado.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  creado_en timestamptz not null default now()
);

create table mercado.equipos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references mercado.perfiles(id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 1 and 80),
  habilitado boolean not null default false,
  ultima_senal timestamptz,
  creado_en timestamptz not null default now(),
  unique (id, usuario_id)
);
create index equipos_usuario_idx on mercado.equipos(usuario_id);

create table mercado.modelos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null references mercado.perfiles(id) on delete cascade,
  equipo_id uuid not null,
  etiqueta text not null check (char_length(btrim(etiqueta)) between 1 and 100),
  origen text not null check (origen in ('local', 'codeclub')),
  proveedor text not null default '' check (char_length(proveedor) <= 200),
  modelo text not null check (char_length(btrim(modelo)) between 1 and 200),
  habilitado boolean not null default false,
  simultaneas integer not null default 1 check (simultaneas between 1 and 32),
  peticiones_por_minuto integer not null default 0 check (peticiones_por_minuto between 0 and 100000),
  cola_habilitada boolean not null default false,
  capacidad_cola integer not null default 10 check (capacidad_cola between 1 and 1000),
  creado_en timestamptz not null default now(),
  foreign key (equipo_id, proveedor_id) references mercado.equipos(id, usuario_id) on delete cascade,
  unique (id, proveedor_id)
);
create index modelos_proveedor_idx on mercado.modelos(proveedor_id);
create index modelos_equipo_proveedor_idx on mercado.modelos(equipo_id, proveedor_id);
create index modelos_catalogo_idx on mercado.modelos(creado_en desc) where habilitado;

create table mercado.solicitudes (
  id uuid primary key default gen_random_uuid(),
  consumidor_id uuid not null references mercado.perfiles(id) on delete cascade,
  modelo_id uuid not null,
  proveedor_id uuid not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'ejecutando', 'completada', 'fallida', 'cancelada')),
  entrada jsonb not null check (jsonb_typeof(entrada) = 'object' and octet_length(entrada::text) <= 1048576),
  creado_en timestamptz not null default now(),
  foreign key (modelo_id, proveedor_id) references mercado.modelos(id, proveedor_id) on delete restrict
);
create index solicitudes_consumidor_idx on mercado.solicitudes(consumidor_id, creado_en desc);
create index solicitudes_proveedor_estado_idx on mercado.solicitudes(proveedor_id, estado, creado_en);
create index solicitudes_modelo_proveedor_idx on mercado.solicitudes(modelo_id, proveedor_id);

alter table mercado.perfiles enable row level security;
alter table mercado.equipos enable row level security;
alter table mercado.modelos enable row level security;
alter table mercado.solicitudes enable row level security;

-- Revocar también posibles grants heredados de los defaults del proyecto.
revoke all on all tables in schema mercado from public, anon, authenticated;
-- Grants por columna: identidad y fechas se asignan por defaults, no por clientes.
grant select on mercado.perfiles, mercado.equipos, mercado.modelos, mercado.solicitudes to authenticated;
grant insert (id, nombre), update (nombre) on mercado.perfiles to authenticated;
grant insert (usuario_id, nombre), update (nombre, habilitado), delete on mercado.equipos to authenticated;
grant insert (proveedor_id, equipo_id, etiqueta, origen, proveedor, modelo, habilitado, simultaneas, peticiones_por_minuto, cola_habilitada, capacidad_cola),
  update (equipo_id, etiqueta, origen, proveedor, modelo, habilitado, simultaneas, peticiones_por_minuto, cola_habilitada, capacidad_cola), delete on mercado.modelos to authenticated;
grant insert (consumidor_id, modelo_id, proveedor_id, entrada) on mercado.solicitudes to authenticated;

create policy perfiles_lectura on mercado.perfiles for select to authenticated
  using (id = (select auth.uid()) or exists (select 1 from mercado.modelos m where m.proveedor_id = perfiles.id and m.habilitado));
create policy perfiles_creacion on mercado.perfiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy perfiles_edicion on mercado.perfiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy equipos_propios on mercado.equipos for all to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));

create policy modelos_lectura on mercado.modelos for select to authenticated
  using (habilitado or proveedor_id = (select auth.uid()));
create policy modelos_creacion on mercado.modelos for insert to authenticated
  with check (proveedor_id = (select auth.uid()));
create policy modelos_edicion on mercado.modelos for update to authenticated
  using (proveedor_id = (select auth.uid())) with check (proveedor_id = (select auth.uid()));
create policy modelos_eliminacion on mercado.modelos for delete to authenticated
  using (proveedor_id = (select auth.uid()));

create policy solicitudes_lectura on mercado.solicitudes for select to authenticated
  using (consumidor_id = (select auth.uid()) or proveedor_id = (select auth.uid()));
create policy solicitudes_creacion on mercado.solicitudes for insert to authenticated
  with check (consumidor_id = (select auth.uid()) and estado = 'pendiente'
    and exists (select 1 from mercado.modelos m where m.id = solicitudes.modelo_id
      and m.proveedor_id = solicitudes.proveedor_id and m.habilitado));

comment on column mercado.equipos.ultima_senal is 'Reservado para heartbeat validado con reloj del servidor; no escribible directamente por clientes.';
comment on column mercado.modelos.habilitado is 'Intención de publicar; no prueba que el equipo esté online.';
comment on table mercado.solicitudes is 'Base de coordinación. Sin UPDATE/DELETE de clientes hasta implementar transiciones y límites atómicos mediante RPC.';

commit;
