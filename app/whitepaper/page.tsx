import type { Metadata } from "next";
import path from "path";
import { readFile } from "fs/promises";
import { PageShell } from "@/components/docs/PageShell";
import { WhitepaperBody } from "@/components/whitepaper/WhitepaperBody";
import { extractTocFromMarkdown } from "@/lib/whitepaper/extractToc";

export const metadata: Metadata = {
  title: "Whitepaper — A.R.C.",
  description:
    "Technical whitepaper: Autonomous Rescue Cluster for post-disaster search, triage, and communication.",
};

export default async function WhitepaperPage() {
  const filePath = path.join(process.cwd(), "whitepaper.md");
  const markdown = await readFile(filePath, "utf-8");
  const toc = extractTocFromMarkdown(markdown);

  return (
    <PageShell>
      <WhitepaperBody markdown={markdown} toc={toc} />
    </PageShell>
  );
}
