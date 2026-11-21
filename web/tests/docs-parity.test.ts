import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * BUG-06: llms.txt, OpenAPI and the in-app tool list must always describe the same tools and
 * board kinds (they're all generated from lib/agent/tools + lib/kinds), and every example
 * payload an agent sees must actually validate.
 */
describe('agent docs stay in sync (BUG-06)', () => {
  it('llms.txt lists every tool and every kind', async () => {
    const { TOOLS } = await import('@/lib/agent/tools');
    const { SLATE_KINDS } = await import('@/lib/kinds');
    const { GET } = await import('@/app/llms.txt/route');
    const text = await (await GET(new Request('https://www.slates.space/llms.txt'))).text();
    for (const t of TOOLS) expect(text, t.name).toContain(`- ${t.name}`);
    for (const k of SLATE_KINDS) expect(text, k).toContain(`### ${k}`);
  });

  it('OpenAPI has a path for every tool and nothing extra', async () => {
    const { TOOLS } = await import('@/lib/agent/tools');
    const { GET } = await import('@/app/api/v1/openapi.json/route');
    const spec = await (await GET()).json();
    const toolPaths = Object.keys(spec.paths).filter((p) => p.startsWith('/api/v1/tools/'));
    expect(toolPaths.sort()).toEqual(TOOLS.map((t) => `/api/v1/tools/${t.name}`).sort());
  });

  it('every example payload validates against its kind', async () => {
    const { EXAMPLES, SLATE_KINDS, validateData } = await import('@/lib/kinds');
    for (const k of SLATE_KINDS) expect(() => validateData(k, EXAMPLES[k]), k).not.toThrow();
  });

  it('tool descriptions name every kind (BUG-17)', async () => {
    const { TOOLS, SERVER_INSTRUCTIONS } = await import('@/lib/agent/tools');
    const { SLATE_KINDS, COLLECTION_KEY } = await import('@/lib/kinds');
    const describe = TOOLS.find((t) => t.name === 'describe_kinds')!.description;
    const patch = TOOLS.find((t) => t.name === 'patch_items')!.description;
    for (const k of SLATE_KINDS) {
      expect(describe, `describe_kinds: ${k}`).toContain(k);
      expect(SERVER_INSTRUCTIONS, `instructions: ${k}`).toContain(k);
      if (COLLECTION_KEY[k] && COLLECTION_KEY[k] !== 'series') expect(patch, `patch_items: ${k}`).toContain(k);
    }
  });
});
