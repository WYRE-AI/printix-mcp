import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getPrinter, listPrinters } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const PRINTER_TOOLS: Tool[] = [
  {
    name: 'printix_list_printers',
    description: 'List Printix print queues/printers for the tenant, optionally filtered by search query and paged.',
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
    name: 'printix_get_printer',
    description: 'Get a single Printix printer/queue and its properties/capabilities by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        printerId: { type: 'string', description: 'Printix printer/queue ID.' },
      },
      required: ['printerId'],
    },
  },
];

export async function handlePrinterTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'printix_list_printers') {
      const result = await listPrinters(creds!, {
        query: args.query as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      });
      return textResult(result);
    }

    if (name === 'printix_get_printer') {
      const printerId = args.printerId as string;
      if (!printerId) return errorResult('printerId is required.');
      const result = await getPrinter(creds!, printerId);
      return textResult(result);
    }

    return errorResult(`Unknown printer tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
