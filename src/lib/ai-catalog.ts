// Live catalog fetched from https://models.dev/api.json
// See https://models.dev/models/ and https://models.dev/providers/ for docs.
// Each provider has a `models` object. Fallback: hardcoded "Custom" provider.

let fetchedProviders: any[] = [];
let fetchedModels: any[] = [];

try {
  const providersRes = await fetch("https://models.dev/api.json");
  // api.json shape: { [providerId]: { id, name, api, doc, models: { [modelId]: { id, name } } } }
  const apiData = await providersRes.json();

  // Map each provider entry — id, label, api base URL, doc URL, short label for UI.
  fetchedProviders = Object.values(apiData).map((p: any) => ({
    id: p.id,
    label: p.name,
    api: p.api,
    shortLabel: p.name ? p.name.charAt(0) : "",
    doc: p.doc || ""
  }));

  // Flatten each provider's models into a flat list with providerId ref.
  fetchedModels = Object.values(apiData).flatMap((p: any) => {
    if (!p.models) return [];
    return Object.values(p.models).map((m: any) => ({
      id: m.id,
      label: m.name,
      providerId: p.id,
      cost: m.cost || null,
    }));
  });

  // Hardcoded "Custom" provider for user-defined OpenAI-compatible endpoints.
  fetchedProviders.push({
    id: "custom",
    label: "Custom",
    shortLabel: "C",
    doc: "",
    api: ""
  });
} catch (e) {
  console.error("Error fetching models.dev catalog:", e);
}

export const providers = fetchedProviders;
export const models = fetchedModels;
