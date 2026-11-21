import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';

/**
 * GitHub-flavoured Markdown (tables, ~~strike~~, - [ ] tasks) without remark-gfm's autolink
 * literal, whose regex lookbehind is a SyntaxError on Safari before 16.4 and crashes the page.
 */
export function remarkGfmSafe(this: any) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(gfmTable(), gfmStrikethrough(), gfmTaskListItem());
  (data.fromMarkdownExtensions ??= []).push(gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTaskListItemFromMarkdown());
}
