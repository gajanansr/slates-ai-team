import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

type P = { slug: string };
export const dynamic = 'force-dynamic';
export const GET = agentRoute<P>(({ params }) => ({ tool: 'get_slate', args: { slug: params.slug } }));
export const PATCH = agentRoute<P>(({ params, body }) => ({ tool: 'update_slate', args: { ...body, slug: params.slug } }));
export const DELETE = agentRoute<P>(({ params }) => ({ tool: 'archive_slate', args: { slug: params.slug } }));
export const OPTIONS = preflight;
