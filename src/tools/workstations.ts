import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getWorkstation, listWorkstations } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const WORKSTATION_TOOLS: Tool[] = [
  {
    name: 'printix_list_workstations',
    description: 'List Printix workstations (client-device monitoring data) for the tenant, paged.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Zero-based page number.' },
        pageSize: { type: 'number', description: 'Results per page.' },
      },
    },
  },
  {
    name: 'printix_get_workstation',
    description: 'Get a single Printix workstation by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        workstationId: { type: 'string', description: 'Printix workstation ID.' },
      },
      required: ['workstationId'],
    },
  },
];

export async function handleWorkstationTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_list_workstations') {
      const result = await listWorkstations(creds!, {
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return textResult(result);
    }

    if (name === 'printix_get_workstation') {
      const workstationId = args.workstationId as string;
      if (!workstationId) return errorResult('workstationId is required.');
      const result = await getWorkstation(creds!, workstationId);
      return textResult(result);
    }

    return errorResult(`Unknown workstation tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
