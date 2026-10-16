import type { AnchorHTMLAttributes } from 'react';
import { markdownUrlTransform } from '@/lib/safeUrl';

/**
 * Hardening shared by every react-markdown renderer that shows model- or
 * user-authored text. Raw HTML is already inert without rehype-raw; these
 * also drop images (tracking pixels / exfil via URL) and embeds, and refuse
 * any link scheme other than http(s)/mailto (and in-app paths).
 */
export const MARKDOWN_DISALLOWED_ELEMENTS = ['img', 'html', 'script', 'iframe'];

export const markdownUrlTransformFn = (url: string) => markdownUrlTransform(url);

/** Links always open in a new tab without an opener / referrer. */
export function SafeMarkdownLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export const SAFE_MARKDOWN_PROPS = {
  disallowedElements: MARKDOWN_DISALLOWED_ELEMENTS,
  unwrapDisallowed: false,
  skipHtml: true,
  urlTransform: markdownUrlTransformFn,
} as const;
