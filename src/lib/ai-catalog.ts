// Live data from https://models.dev/api.json
// Source docs: https://models.dev/models/ and https://models.dev/providers/

let fetchedProviders: any[] = [];
let fetchedModels: any[] = [];

try {
  const providersRes = await fetch("https://models.dev/api.json");
  const apiData = await providersRes.json();
  
  fetchedProviders = Object.values(apiData).map((p: any) => ({
    id: p.id,
    label: p.name,
    api: p.api, // Guardamos la API custom si la tiene
    shortLabel: p.name ? p.name.charAt(0) : "",
    doc: p.doc || ""
  }));
  
  // En api.json, cada provider tiene un objeto `models` con los modelos que soporta
  fetchedModels = Object.values(apiData).flatMap((p: any) => {
    if (!p.models) return [];
    return Object.values(p.models).map((m: any) => ({
      id: m.id,
      label: m.name,
      providerId: p.id
    }));
  });

  // Agregar el proveedor "Custom" hardcodeado
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
