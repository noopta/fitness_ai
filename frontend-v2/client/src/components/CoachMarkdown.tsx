import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface CoachMarkdownProps {
  content: string;
  /** Use smaller text for compact contexts (e.g. FloatingCoachChat) */
  compact?: boolean;
}

export function CoachMarkdown({ content, compact = false }: CoachMarkdownProps) {
  const baseClass = compact ? "text-xs" : "text-sm";
  return (
    <div
      className={`${baseClass} leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0 [&_strong]:font-semibold [&_h1]:font-bold [&_h1]:text-base [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:font-bold [&_h2]:text-sm [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-semibold [&_h3]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_hr]:my-4 [&_hr]:border-border`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[280px] border-collapse text-left">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/50 px-3 py-2 text-muted-foreground last:border-b-0">
              {children}
            </td>
          ),
          tr: ({ children }) => <tr className="border-b border-border/50 last:border-b-0">{children}</tr>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
