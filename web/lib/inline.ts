/** Markdown link, as agents often write them in short text: [label](/s/slug) or [label](https://...). */
export const INLINE_LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/g;

/** Plain-text version (links, bold and code marks removed), for aria-labels and headlines. */
export const plainText = (s: string) => s.replace(INLINE_LINK, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
