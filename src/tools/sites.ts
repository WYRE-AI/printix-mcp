import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getSite, listSites } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const SITE_TOOLS: Tool[] = [
  {
    name: 'printix_list_sites',
    description: 'List Printix sites (physical locations) for the tenant, paged.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Zero-based page number.' },
        pageSize: { type: 'number', description: 'Results per page.' },
      },
    },
  },
  {
    name: 'printix_get_site',
    description: 'Get a single Printix site (physical location) by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', description: 'Printix site ID.' },
      },
      required: ['siteId'],
    },
  },
];

export async function handleSiteTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_list_sites') {
      const result = await listSites(creds!, {
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return textResult(result);
    }

    if (name === 'printix_get_site') {
      const siteId = args.siteId as string;
      if (!siteId) return errorResult('siteId is required.');
      const result = await getSite(creds!, siteId);
      return textResult(result);
    }

    return errorResult(`Unknown site tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
