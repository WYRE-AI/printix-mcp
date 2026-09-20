import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getGroup, listGroups } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

// Read-only: group creation/deletion is deferred alongside user
// creation/deletion - see README Scope. Only list/get are exposed here.
export const GROUP_TOOLS: Tool[] = [
  {
    name: 'printix_list_groups',
    description: 'List/search Printix groups for the tenant, paged.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional free-text search filter.' },
        page: { type: 'number', description: 'Zero-based page number.' },
        pageSize: { type: 'number', description: 'Results per page.' },
      },
    },
  },
  {
    name: 'printix_get_group',
    description: 'Fetch a single Printix group and its details by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Printix group ID.' },
      },
      required: ['groupId'],
    },
  },
];

export async function handleGroupTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_list_groups') {
      const result = await listGroups(creds!, {
        query: args.query as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return textResult(result);
    }

    if (name === 'printix_get_group') {
      const groupId = args.groupId as string;
      if (!groupId) return errorResult('groupId is required.');
      const result = await getGroup(creds!, groupId);
      return textResult(result);
    }

    return errorResult(`Unknown group tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
