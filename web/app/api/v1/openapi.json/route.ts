import { json, preflight } from '@/lib/agent/http';
import { TOOLS, toolJsonSchema, SERVER_INSTRUCTIONS } from '@/lib/agent/tools';
import { SITE_URL } from '@/lib/env';

/** Public OpenAPI 3.1 document for bots without MCP (custom GPTs, Grok, scripts). */
export function GET() {
  const paths: Record<string, unknown> = {};
  for (const t of TOOLS) {
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: toolJsonSchema(t) } } },
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: {} } } } } },
          '401': { $ref: '#/components/responses/Error' },
          '403': { $ref: '#/components/responses/Error' },
          '404': { $ref: '#/components/responses/Error' },
          '409': { $ref: '#/components/responses/Error' },
          '422': { $ref: '#/components/responses/Error' },
        },
      },
    };
  }
  return json({
    openapi: '3.1.0',
    info: {
      title: 'Slates Agent API',
      version: '2.0.0',
      description:
        SERVER_INSTRUCTIONS +
        '\n\nResource-style aliases also exist: GET/POST /api/v1/slates, GET/PATCH/DELETE /api/v1/slates/{slug}, POST /api/v1/slates/{slug}/items, PUT /api/v1/brief, GET/POST /api/v1/activity, GET /api/v1/kinds. MCP: POST /mcp.',
    },
    servers: [{ url: SITE_URL }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Agent token from Slates → Agents (slt_…).' } },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
              },
            },
          },
        },
      },
    },
  });
}
export const OPTIONS = preflight;
