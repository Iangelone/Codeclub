import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSetting, setSetting } from './persistence';
import type { MarketProvider } from './market-providers';

// Public application configuration. Never put a secret/service_role key here.
export const MARKET_SUPABASE_URL = 'https://dtlifqfupxododxermsu.supabase.co';
const publishableKey = 'sb_publishable_YcUzBzejArSqt3pRX89H-Q_Qx0pkw5r';
type MarketClient = SupabaseClient<any, 'mercado'>;
let client: MarketClient | undefined;
export function marketClient(): MarketClient {
  if (!client) client = createClient<any, 'mercado'>(MARKET_SUPABASE_URL, publishableKey, {
    db: { schema: 'mercado' },
    auth: {
      storageKey: 'codeclub-market-auth', detectSessionInUrl: false,
      persistSession: true, autoRefreshToken: true,
      storage: {
        getItem: async (key) => {
          const bridge = (window as any).codeclub;
          if (bridge) { if (!bridge.marketAuthGet) throw new Error('MARKET_RESTART_REQUIRED'); return bridge.marketAuthGet(key); }
          return window.sessionStorage.getItem(key);
        },
        setItem: async (key, value) => {
          const bridge = (window as any).codeclub;
          if (bridge) { if (!bridge.marketAuthSet) throw new Error('MARKET_RESTART_REQUIRED'); await bridge.marketAuthSet(key, value); }
          else window.sessionStorage.setItem(key, value);
        },
        removeItem: async (key) => {
          const bridge = (window as any).codeclub;
          if (bridge) { if (!bridge.marketAuthSet) throw new Error('MARKET_RESTART_REQUIRED'); await bridge.marketAuthSet(key, null); }
          else window.sessionStorage.removeItem(key);
        },
      },
    },
  });
  return client;
}
export async function marketUser() {
  const { data, error } = await marketClient().auth.getUser();
  if (error || !data.user) throw new Error('MARKET_LOGIN_REQUIRED');
  return data.user;
}
async function ensureProfile(userId: string, name: string) {
  const db = marketClient();
  const { data, error } = await db.from('perfiles').select('id').eq('id', userId).maybeSingle();
  if (error) throw error;
  const result = data ? await db.from('perfiles').update({ nombre: name }).eq('id', userId) : await db.from('perfiles').insert({ id: userId, nombre: name });
  if (result.error) throw result.error;
}
async function ensureDevice(userId: string): Promise<string> {
  const key = `codeclub_market_device_${userId}`;
  const savedId = await getSetting<string | null>(key, null);
  if (savedId) {
    const { data, error } = await marketClient().from('equipos').select('id').eq('id', savedId).eq('usuario_id', userId).maybeSingle();
    if (error) throw error;
    if (data) return data.id;
  }
  const { data, error } = await marketClient().from('equipos').insert({ usuario_id: userId, nombre: 'Codeclub PC' }).select('id').single();
  if (error) throw error;
  await setSetting(key, data.id);
  return data.id;
}
export async function publishMarketProvider(offer: MarketProvider): Promise<{ remoteId: string; ownerId: string }> {
  const user = await marketUser();
  if (offer.ownerId && offer.ownerId !== user.id) throw new Error('MARKET_WRONG_OWNER');
  await ensureProfile(user.id, offer.name);
  const deviceId = await ensureDevice(user.id);
  const fields = {
    equipo_id: deviceId, etiqueta: offer.modelLabel || offer.model, origen: offer.origin,
    proveedor: offer.provider, modelo: offer.model, habilitado: offer.enabled !== false,
    simultaneas: offer.concurrency, peticiones_por_minuto: offer.requestsPerMinute,
    cola_habilitada: offer.queueEnabled, capacidad_cola: offer.queueCapacity,
  };
  const result = offer.remoteId
    ? await marketClient().from('modelos').update(fields).eq('id', offer.remoteId).eq('proveedor_id', user.id).select('id').single()
    : await marketClient().from('modelos').insert({ ...fields, proveedor_id: user.id }).select('id').single();
  if (result.error) throw result.error;
  return { remoteId: result.data.id, ownerId: user.id };
}
export async function deletePublishedProvider(offer: MarketProvider): Promise<void> {
  if (!offer.remoteId) return;
  const user = await marketUser();
  if (offer.ownerId !== user.id) throw new Error('MARKET_WRONG_OWNER');
  const { error } = await marketClient().from('modelos').delete().eq('id', offer.remoteId).eq('proveedor_id', user.id).select('id').single();
  if (error) throw error;
}
export async function readPublishedProviders(): Promise<MarketProvider[]> {
  const { data, error } = await marketClient().from('modelos')
    .select('id,proveedor_id,etiqueta,origen,proveedor,modelo,habilitado,simultaneas,peticiones_por_minuto,cola_habilitada,capacidad_cola,creado_en,perfiles!modelos_proveedor_id_fkey(nombre)')
    .eq('habilitado', true).order('creado_en', { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id, remoteId: row.id, ownerId: row.proveedor_id, remote: true,
    name: row.perfiles?.nombre || '', modelLabel: row.etiqueta, model: row.modelo,
    origin: row.origen, provider: row.proveedor, endpoint: '', enabled: row.habilitado,
    concurrency: row.simultaneas, requestsPerMinute: row.peticiones_por_minuto,
    queueEnabled: row.cola_habilitada, queueCapacity: row.capacidad_cola, registeredAt: row.creado_en,
  }));
}

/** Validate only signup links from our Auth origin; never navigate to redirect_to. */
export async function confirmMarketEmail(link: string): Promise<void> {
  const url = new URL(link.trim());
  const token = url.searchParams.get('token_hash') || url.searchParams.get('token');
  if (url.origin !== MARKET_SUPABASE_URL || url.pathname !== '/auth/v1/verify'
    || url.searchParams.get('type') !== 'signup' || !token || !/^[a-zA-Z0-9_-]{40,512}$/.test(token)) {
    throw new Error('MARKET_INVALID_CONFIRMATION_LINK');
  }
  const { error } = await marketClient().auth.verifyOtp({ token_hash: token, type: 'email' });
  if (error) throw error;
}
