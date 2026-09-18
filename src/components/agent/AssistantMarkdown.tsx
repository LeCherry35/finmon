"use client";

import type { ComponentProps, ElementType } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

/** An element renderer with fixed classes; drops react-markdown's `node` prop. */
function styled<T extends ElementType>(Tag: T, className: string) {
  return function Styled(props: ComponentProps<T> & ExtraProps) {
    const rest: Record<string, unknown> = { ...props };
    delete rest.node;
    const Any = Tag as ElementType;
    return <Any className={className} {...rest} />;
  };
}

const BLOCK = "my-1.5 first:mt-0 last:mb-0";
const HEADING = "mt-2 mb-1 font-semibold first:mt-0";

const Link = styled("a", "underline underline-offset-2");
const Table = styled("table", "w-full border-collapse text-xs");

const COMPONENTS: Components = {
  p: styled("p", BLOCK),
  ul: styled("ul", `${BLOCK} list-disc space-y-0.5 pl-5`),
  ol: styled("ol", `${BLOCK} list-decimal space-y-0.5 pl-5`),
  h1: styled("p", HEADING),
  h2: styled("p", HEADING),
  h3: styled("p", HEADING),
  strong: styled("strong", "font-semibold"),
  code: styled("code", "rounded bg-zinc-200 px-1 text-[0.85em]"),
  a: (props) => <Link target="_blank" rel="noopener noreferrer" {...props} />,
  table: (props) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <Table {...props} />
    </div>
  ),
  th: styled("th", "border-b border-zinc-300 px-2 py-1 text-left font-semibold whitespace-nowrap"),
  td: styled("td", "border-b border-zinc-200 px-2 py-1 align-top"),
};

/**
 * Renders an assistant reply as GitHub-flavored Markdown (tables, lists,
 * bold…). Raw HTML in the text is not rendered, so model output stays inert.
 * Wide tables scroll horizontally inside the bubble instead of stretching it.
 */
export default function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}
