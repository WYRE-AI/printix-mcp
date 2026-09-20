import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getUser, listUsers } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

// Read-only: user creation/deletion has real account-management consequences
// (per-user licensing, access removal) and is deliberately deferred - see
// README Scope. Only list/get are exposed here.
export const USER_TOOLS: Tool[] = [
  {
    name: 'printix_list_users',
    description: 'List Printix users for the tenant, optionally filtered by search query or role, paged.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional free-text search filter.' },
        role: { type: 'string', description: 'Optional role filter.' },
        page: { type: 'number', description: 'Zero-based page number.' },
        pageSize: { type: 'number', description: 'Results per page.' },
      },
    },
  },
  {
    name: 'printix_get_user',
    description: 'Find a single Printix user by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Printix user ID.' },
      },
      required: ['userId'],
    },
  },
];

export async function handleUserTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_list_users') {
      const result = await listUsers(creds!, {
        query: args.query as string | undefined,
        role: args.role as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return textResult(result);
    }

    if (name === 'printix_get_user') {
      const userId = args.userId as string;
      if (!userId) return errorResult('userId is required.');
      const result = await getUser(creds!, userId);
      return textResult(result);
    }

    return errorResult(`Unknown user tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
