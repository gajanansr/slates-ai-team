import { agentRoute } from '@/lib/agent/route';
import { preflight } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';
export const GET = agentRoute(() => ({ tool: 'describe_kinds', args: {} }));
export const OPTIONS = preflight;
