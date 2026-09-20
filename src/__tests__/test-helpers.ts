import type { CallToolResult } from '../tools/types.js';

/** Extracts the text of the first content block, failing loudly if it isn't text. */
export function textOf(result: CallToolResult): string {
  const block = result.content?.[0];
  if (!block || block.type !== 'text') {
    throw new Error(`Expected a text content block, got: ${JSON.stringify(block)}`);
  }
  return block.text;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A root-request (GET /cloudprint) body resolving to tenant "T-1". */
export function rootResponseFor(tenantId: string): unknown {
  return {
    _links: {
      tenants: {
        href: `https://api.printix.net/cloudprint/tenants/${tenantId}`,
        templated: false,
      },
    },
  };
}
