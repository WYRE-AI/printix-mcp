import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getTenant } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const TENANT_TOOLS: Tool[] = [
  {
    name: 'printix_get_tenant',
    description: 'Get the Printix tenant this credential pair is scoped to (tenant ID and its API root link).',
    inputSchema: { type: 'object', properties: {} },
  },
];

export async function handleTenantTool(name: string, _args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_get_tenant') {
      const result = await getTenant(creds!);
      return textResult(result);
    }

    return errorResult(`Unknown tenant tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
