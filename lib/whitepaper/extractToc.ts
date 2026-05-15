import GithubSlugger from "github-slugger";

export type WhitepaperTocItem = {
  level: 2 | 3;
  title: string;
  id: string;
};

/**
 * Extract ## / ### headings for the sidebar. Slugs must stay in sync with
 * `rehype-slug`, which walks **all** headings in order (`#` … `######`).
 * We consume slugging for every heading line but only push ## / ### into the TOC.
 */
export function extractTocFromMarkdown(markdown: string): WhitepaperTocItem[] {
  const slugger = new GithubSlugger();
  const toc: WhitepaperTocItem[] = [];
  const lines = markdown.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (!match) continue;

    const hashes = match[1];
    const level = hashes.length;
    const title = match[2].trim().replace(/\s+#+\s*$/, "").trim();
    const id = slugger.slug(title);

    if (level === 2 || level === 3) {
      toc.push({ level: level as 2 | 3, title, id });
    }
  }

  return toc;
}
