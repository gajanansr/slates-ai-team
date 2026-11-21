import { json, preflight } from '@/lib/agent/http';
import { TOOLS, toolJsonSchema } from '@/lib/agent/tools';

// Public: the tool catalogue contains no user data.
export function GET() {
  return json({
    data: TOOLS.map((t) => ({ name: t.name, description: t.description, read_only: t.readOnly, input_schema: toolJsonSchema(t) })),
  });
}
export const OPTIONS = preflight;
