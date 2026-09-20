import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { GROUP_TOOLS, handleGroupTool } from './groups.js';
import { PRINTER_TOOLS, handlePrinterTool } from './printers.js';
import { SITE_TOOLS, handleSiteTool } from './sites.js';
import { TENANT_TOOLS, handleTenantTool } from './tenant.js';
import { USER_TOOLS, handleUserTool } from './users.js';
import { WORKSTATION_TOOLS, handleWorkstationTool } from './workstations.js';
import type { CallToolResult } from './types.js';

export const ALL_TOOLS: Tool[] = [
  ...TENANT_TOOLS,
  ...PRINTER_TOOLS,
  ...SITE_TOOLS,
  ...WORKSTATION_TOOLS,
  ...USER_TOOLS,
  ...GROUP_TOOLS,
];

const TENANT_NAMES = new Set(TENANT_TOOLS.map((t) => t.name));
const PRINTER_NAMES = new Set(PRINTER_TOOLS.map((t) => t.name));
const SITE_NAMES = new Set(SITE_TOOLS.map((t) => t.name));
const WORKSTATION_NAMES = new Set(WORKSTATION_TOOLS.map((t) => t.name));
const USER_NAMES = new Set(USER_TOOLS.map((t) => t.name));
const GROUP_NAMES = new Set(GROUP_TOOLS.map((t) => t.name));

export async function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (TENANT_NAMES.has(name)) return handleTenantTool(name, args);
  if (PRINTER_NAMES.has(name)) return handlePrinterTool(name, args);
  if (SITE_NAMES.has(name)) return handleSiteTool(name, args);
  if (WORKSTATION_NAMES.has(name)) return handleWorkstationTool(name, args);
  if (USER_NAMES.has(name)) return handleUserTool(name, args);
  if (GROUP_NAMES.has(name)) return handleGroupTool(name, args);
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}
