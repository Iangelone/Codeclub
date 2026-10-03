type ProviderRoute = { id?: string; gatewayOnly?: boolean };
type ModelRoute = { id?: string; providerId?: string; gatewayId?: string; gatewayOnly?: boolean; gatewayAvailable?: boolean };

export const usesGateway = (provider: ProviderRoute, model?: ModelRoute | null) => provider.id === 'ai-gateway' || provider.gatewayOnly === true || model?.gatewayOnly === true;
export const modelMatchesProvider = (model: ModelRoute, provider: ProviderRoute) => provider.id === 'ai-gateway' ? model.gatewayAvailable === true : model.providerId === provider.id;
export const credentialKeyFor = (provider: ProviderRoute, model?: ModelRoute | null) => usesGateway(provider, model) ? 'ai_gateway_api_key' : `${provider.id}_api_key`;
export const modelIdFor = (provider: ProviderRoute, model: ModelRoute) => usesGateway(provider, model) ? model.gatewayId || `${model.providerId || provider.id}/${model.id}` : model.id || '';
export const credentialTargetFor = <T extends ProviderRoute>(provider: T, model?: ModelRoute | null) => usesGateway(provider, model) ? { ...provider, id: 'ai-gateway', label: 'Vercel AI Gateway', gatewayOnly: true, requiresApiKey: true } : provider;
