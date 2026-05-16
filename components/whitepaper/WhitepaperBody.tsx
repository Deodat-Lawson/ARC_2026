"use client";

import { clsx } from "clsx";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import type { WhitepaperTocItem } from "@/lib/whitepaper/extractToc";

type Props = {
  markdown: string;
  toc: WhitepaperTocItem[];
};

const mdComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="scroll-mt-28 text-3xl font-medium tracking-tight text-arc-fg md:text-4xl" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="scroll-mt-28 mt-12 border-t border-white/10 pt-10 text-2xl font-medium tracking-tight text-arc-fg first:mt-0 first:border-0 first:pt-0 md:text-3xl" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="scroll-mt-28 mt-8 text-lg font-medium tracking-tight text-arc-fg md:text-xl" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="mt-4 text-base leading-relaxed text-arc-fg/90 first:mt-0" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-arc-fg/90" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed text-arc-fg/90" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="marker:text-arc-muted" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-medium text-arc-fg" {...props}>
      {children}
    </strong>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="my-6 border-l-2 border-arc-accent/45 bg-arc-accent/5 py-3 pl-4 text-sm leading-relaxed text-arc-muted" {...props}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-white/10" />,
  a: ({ href, children, ...props }) => (
    <a href={href} className="text-arc-accent underline decoration-arc-accent/40 underline-offset-4 hover:decoration-arc-accent" {...props}>
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="my-6 overflow-x-auto rounded-md border border-white/10">
      <table className="w-full min-w-[36rem] border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => <thead className="bg-white/5 font-mono text-[10px] uppercase tracking-[0.15em] text-arc-muted" {...props}>{children}</thead>,
  th: ({ children, ...props }) => (
    <th className="border-b border-white/10 px-3 py-2.5 text-left font-medium" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border-b border-white/5 px-3 py-2.5 align-top text-arc-fg/85" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }) => <tr {...props}>{children}</tr>,
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === "string" && /language-/.test(className);
    if (isBlock) {
      return (
        <code className={clsx(className, "font-mono text-[13px] leading-relaxed text-arc-fg/90")} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-arc-accent" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre className="my-6 overflow-x-auto rounded-md border border-white/10 bg-[#0e1014] p-4 font-mono text-[13px] leading-relaxed text-arc-fg/90" {...props}>
      {children}
    </pre>
  ),
};

export function WhitepaperBody({ markdown, toc }: Props) {
  return (
    <div className="border-t border-white/5 px-6 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 font-mono text-[10px] uppercase tracking-[0.28em] text-arc-accent">
          <span className="inline-block size-1.5 rounded-full bg-arc-accent shadow-[0_0_6px_2px_rgba(93,255,180,0.5)]" aria-hidden />{" "}
          A.R.C. · Technical whitepaper
        </div>

        <div className="grid gap-12 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-16 xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <nav aria-label="Table of contents" className="lg:sticky lg:top-28 lg:self-start">
            <details className="group rounded-md border border-white/10 bg-[#0e1014] lg:border-0 lg:bg-transparent">
              <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-arc-muted lg:hidden [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-2">
                  Contents
                  <span className="text-arc-accent transition-transform group-open:rotate-180">▼</span>
                </span>
              </summary>
              <div className="border-t border-white/10 px-2 pb-3 pt-2 lg:border-0 lg:p-0">
                <div className="mb-3 hidden font-mono text-[10px] uppercase tracking-[0.22em] text-arc-muted lg:block">
                  Contents
                </div>
                <ul className="max-h-[60vh] space-y-1 overflow-y-auto lg:max-h-[calc(100vh-9rem)]">
                  {toc.map((item, idx) => (
                    <li key={`${idx}-${item.id}`}>
                      <a
                        href={`#${item.id}`}
                        className={clsx(
                          "block rounded-sm py-1 text-sm leading-snug text-arc-muted transition-colors hover:bg-white/5 hover:text-arc-fg",
                          item.level === 3 ? "pl-4 text-[13px]" : "pl-1 font-medium text-arc-fg/80",
                        )}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </nav>

          <article className="min-w-0 max-w-3xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={mdComponents}>
              {markdown}
            </ReactMarkdown>
          </article>
        </div>
      </div>
    </div>
  );
}
