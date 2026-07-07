import { invoke } from '@tauri-apps/api/core';
import { jsonSchema, tool } from 'ai';
import type { ToolContext } from './types';
import { runStream } from './run';

function createSubagentTools(ctx: { projectPath: string; recordToolEvent: (name: string, input: any, output: any) => void; setAgentState: (state: string) => void }) {
  const { projectPath, recordToolEvent, setAgentState } = ctx;
  return {
    listFiles: tool({
      description: 'List project files in the active workspace. Skips heavy folders.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          maxFiles: { type: 'number', description: 'Maximum files to return. Default 400.' },
        },
        additionalProperties: false,
      }),
      execute: async ({ maxFiles }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_list_files', {
          projectPath,
          maxFiles: Math.min(Number(maxFiles) || 400, 1200),
        });
        recordToolEvent('listFiles', { maxFiles }, output);
        return output;
      },
    }),
    readFile: tool({
      description: 'Read a UTF-8 text file from the active workspace using a relative path.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
        },
        required: ['path'],
        additionalProperties: false,
      }),
      execute: async ({ path }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_read_file', { projectPath, path });
        recordToolEvent('readFile', { path }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchText: tool({
      description: 'Search exact text in workspace files and return path, line, and preview.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text to search for.' },
          maxMatches: { type: 'number', description: 'Maximum matches. Default 80.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async ({ query, maxMatches }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_search_text', {
          projectPath,
          query,
          maxMatches: Math.min(Number(maxMatches) || 80, 200),
        });
        recordToolEvent('searchText', { query, maxMatches }, output);
        return output;
      },
    }),
  };
}

export function createTools(ctx: ToolContext) {
  const { projectPath, recordToolEvent, setAgentState, requestToolApproval, provider, modelId } = ctx;

  return {
    listFiles: tool({
      description: 'List project files in the active Codeclub workspace. Skips heavy folders.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          maxFiles: { type: 'number', description: 'Maximum files to return. Default 400.' },
        },
        additionalProperties: false,
      }),
      execute: async ({ maxFiles }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_list_files', {
          projectPath,
          maxFiles: Math.min(Number(maxFiles) || 400, 1200),
        });
        recordToolEvent('listFiles', { maxFiles }, output);
        return output;
      },
    }),
    readFile: tool({
      description: 'Read a UTF-8 text file from the active workspace using a relative path.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
        },
        required: ['path'],
        additionalProperties: false,
      }),
      execute: async ({ path }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_read_file', { projectPath, path });
        recordToolEvent('readFile', { path }, String(output).slice(0, 1200));
        return output;
      },
    }),
    searchText: tool({
      description: 'Search exact text in workspace files and return path, line, and preview.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact text to search for.' },
          maxMatches: { type: 'number', description: 'Maximum matches. Default 80.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async ({ query, maxMatches }) => {
        setAgentState('tool_call');
        const output = await invoke('codeclub_search_text', {
          projectPath,
          query,
          maxMatches: Math.min(Number(maxMatches) || 80, 200),
        });
        recordToolEvent('searchText', { query, maxMatches }, output);
        return output;
      },
    }),
    writeFile: tool({
      description: 'Write full UTF-8 content to a relative workspace file. Requires user approval.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path inside the workspace.' },
          content: { type: 'string', description: 'Complete file content to write.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      }),
      execute: async ({ path, content }) => {
        const approved = await requestToolApproval({
          toolName: 'writeFile',
          input: { path, contentPreview: String(content).slice(0, 800) },
          summary: `Escribir ${path}`,
        });
        if (!approved) {
          recordToolEvent('writeFile', { path }, { denied: true });
          return { ok: false, denied: true };
        }
        setAgentState('running');
        await invoke('codeclub_write_file', { projectPath, path, content });
        const output = { ok: true, path };
        recordToolEvent('writeFile', { path }, output);
        return output;
      },
    }),
    runCommand: tool({
      description: 'Run an allowlisted command in the active workspace. Requires user approval.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Allowed command: bun, npm, pnpm, node, git, cargo, python, rg.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments.' },
        },
        required: ['command', 'args'],
        additionalProperties: false,
      }),
      execute: async ({ command, args }) => {
        const approved = await requestToolApproval({
          toolName: 'runCommand',
          input: { command, args },
          summary: `${command} ${(args || []).join(' ')}`.trim(),
        });
        if (!approved) {
          recordToolEvent('runCommand', { command, args }, { denied: true });
          return { ok: false, denied: true };
        }
        setAgentState('running');
        const output = await invoke('codeclub_run_command', {
          projectPath,
          request: { command, args: Array.isArray(args) ? args : [] },
        });
        recordToolEvent('runCommand', { command, args }, output);
        return output;
      },
    }),
    subagent: tool({
      description: 'Spawn a research subagent to explore the codebase. Give it a clear task. Returns a summary.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The research task for the subagent.' },
        },
        required: ['task'],
        additionalProperties: false,
      }),
      execute: async ({ task }) => {
        if (!provider || !modelId) {
          return { error: 'No provider/model configured for subagent.' };
        }
        setAgentState('tool_call');
        recordToolEvent('subagent', { task }, { status: 'running' });

        const subTools = createSubagentTools({ projectPath, recordToolEvent, setAgentState });

        const result = await runStream({
          model: provider(modelId),
          system: 'Sos un agente de investigación de Codeclub. Explorá el código y respondé en español. IMPORTANTE: cuando termines, escribí un resumen claro de tus hallazgos. Ese resumen será devuelto al agente principal.',
          messages: [{ role: 'user', content: task }],
          tools: subTools,
          callbacks: {
            onTextDelta: () => {},
          },
        });

        recordToolEvent('subagent', { task }, { result });
        return result;
      },
    }),
  };
}
