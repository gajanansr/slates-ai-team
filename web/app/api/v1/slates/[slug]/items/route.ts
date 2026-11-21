import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const POST = agentRoute<{ slug: string }>(({ params, body }) => ({
  tool: 'patch_items',
  args: { ...body, slug: params.slug },
}));
export const OPTIONS = preflight;
