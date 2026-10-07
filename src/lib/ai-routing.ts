type ProviderRoute = { id?: string; gatewayOnly?: boolean; sourceProviderId?: string; marketProviderId?: string };
type ModelRoute = { id?: string; providerId?: string; gatewayId?: string; gatewayOnly?: boolean; gatewayAvailable?: boolean; sourceModelId?: string };

export const usesGateway = (provider: ProviderRoute, model?: ModelRoute | null) => provider.id === 'ai-gateway' || provider.gatewayOnly === true || model?.gatewayOnly === true;
export const modelMatchesProvider = (model: ModelRoute, provider: ProviderRoute) => provider.marketProviderId ? model.providerId === provider.id : provider.id === 'ai-gateway' ? model.gatewayAvailable === true : model.providerId === provider.id && model.gatewayOnly !== true;
export const credentialKeyFor = (provider: ProviderRoute, model?: ModelRoute | null) => usesGateway(provider, model) ? 'ai_gateway_api_key' : `${provider.sourceProviderId || provider.id}_api_key`;
export const modelIdFor = (provider: ProviderRoute, model: ModelRoute) => model.sourceModelId || (usesGateway(provider, model) ? model.gatewayId || `${model.providerId || provider.id}/${model.id}` : model.id || '');
export const credentialTargetFor = <T extends ProviderRoute>(provider: T, model?: ModelRoute | null) => usesGateway(provider, model) ? { ...provider, id: 'ai-gateway', label: 'Vercel AI Gateway', gatewayOnly: true, requiresApiKey: true } : provider;
