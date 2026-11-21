import 'server-only';
import { SITE_URL } from '@/lib/env';
import { TOOLS, TOOL_BY_NAME, toolJsonSchema, SERVER_INSTRUCTIONS } from '@/lib/agent/tools';
import { runTool } from '@/lib/agent/http';
import { toSlatesError, type Caller } from '@/lib/slates';

/**
 * Minimal, stateless MCP server over Streamable HTTP (JSON responses).
 * Supports initialize, ping, tools/list, tools/call and ignores notifications.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = {
  name: 'slates',
  title: 'Slates',
  version: '2.0.0',
  websiteUrl: SITE_URL,
  // Shown by clients that support MCP server icons (spec 2025-11-25).
  icons: [
    { src: `${SITE_URL}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
    { src: `${SITE_URL}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
  ],
};

type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

export async function handleRpc(caller: Caller, msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: msg.id!, result });

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: toolJsonSchema(t),
          annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!TOOL_BY_NAME.has(name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await runTool(caller, name, msg.params?.arguments ?? {});
        const structured = result !== null && typeof result === 'object' && !Array.isArray(result) ? result : { result };
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: structured, isError: false });
      } catch (e) {
        const err = toSlatesError(e);
        // Tool errors are returned as results so the model can read and correct them.
        return ok({ content: [{ type: 'text', text: `Error (${err.code}): ${err.message}` }], isError: true });
      }
    }
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
