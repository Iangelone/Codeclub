/** Structured artifact output and tool-only fallback formatting. */
import { jsonSchema, Output } from 'ai';
import type { AgentMode, AgentSpecialist } from './engine/tools';

export const getArtifactOutputConfig = (prompt: string) => {
  const text = prompt.toLowerCase();
  if (/todo|tareas?|pendientes?/.test(text)) {
    return Output.object({
      name: 'TodoArtifact',
      description: 'A validated TODO summary for the project agent state.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] } }, required: ['title', 'description', 'status'], additionalProperties: false } },
        },
        required: ['items'],
        additionalProperties: false,
      }),
    });
  }
  if (/plan|planific|roadmap/.test(text)) {
    return Output.object({
      name: 'PlanArtifact',
      description: 'A validated implementation plan summary for the project agent state.',
      schema: jsonSchema({
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled', 'blocked'] },
        },
        required: ['title', 'objective', 'steps', 'status'],
        additionalProperties: false,
      }),
    });
  }
  return null;
};

export const formatArtifactOutput = (output: any) => {
  if (output?.items) return `${output.items.length} TODO${output.items.length === 1 ? '' : 's'} estructurado${output.items.length === 1 ? '' : 's'} y validado${output.items.length === 1 ? '' : 's'} para Artifacts.`;
  if (output?.steps) return `Plan «${output.title}» estructurado y validado para Artifacts.`;
  return null;
};

export const formatToolExecutionFallback = (mode: AgentMode, specialist: AgentSpecialist, tools: any[]) => {
  const completed = tools.filter((event) => event.output?.status !== 'running' && !event.output?.error);
  if (!completed.length) return '';
  const details = completed.map((event) => {
    const raw = typeof event.output === 'string' ? event.output : JSON.stringify(event.output ?? {});
    return `- ${event.name}: ${raw.slice(0, 900)}`;
  }).join('\n');
  return `Ejecución completada con evidencia real.\n\nModo: ${mode}\nEspecialista: ${specialist}\nTools usadas: ${completed.map((event) => event.name).join(', ')}\n\nResultados:\n${details}`;
};
