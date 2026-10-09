# Tool discovery and context reuse

Each dynamic tool catalog owns its discovered definitions. After searchTools returns, the next model step exposes those tools with their actual input schemas. executeTool remains available for the full catalog; names come from the catalog itself.

Schemas and validation adapters are resolved once per session. Actions and mutable observations are never cached. Existing browser context compaction reuses observations while preserving current selectors and values.

Only identical schemas in searchTools results are replaced with schemaInToolDefinition when the callable definition is present. Original audit results stay intact. Model call context metrics include schemasCompacted. Existing step and token budgets are unchanged.

This reduces redundant schemas and invalid tool-name guesses; it cannot guarantee correct model arguments or measure live token savings without a new provider run.
