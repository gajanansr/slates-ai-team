import 'server-only';
import { agentCaller, errorResponse, json, readJson, runTool } from '@/lib/agent/http';

type Ctx<P> = { params: Promise<P> };

/** Wrap a REST handler: authenticate the agent, run a tool, map errors to JSON. */
export function agentRoute<P = Record<string, string>>(
  build: (args: { req: Request; params: P; body: any }) => { tool: string; args: unknown } | Promise<{ tool: string; args: unknown }>,
  { status = 200 }: { status?: number } = {},
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const caller = await agentCaller(req);
      const params = (await ctx?.params) ?? ({} as P);
      const body = ['GET', 'DELETE'].includes(req.method) ? {} : await readJson(req);
      const { tool, args } = await build({ req, params, body });
      const result = await runTool(caller, tool, args);
      return json({ data: result }, status);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
