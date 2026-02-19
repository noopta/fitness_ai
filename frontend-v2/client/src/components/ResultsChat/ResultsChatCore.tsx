import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, SendHorizonal, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

interface ResultsChatCoreProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  loading?: boolean;
  loadingMessage?: string;
  contextSummary?: string;
  suggestedPrompts?: string[];
  className?: string;
}

export function ResultsChatCore({
  messages,
  onSend,
  loading = false,
  loadingMessage = "Thinking...",
  contextSummary,
  suggestedPrompts,
  className = "",
}: ResultsChatCoreProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInputValue("");
  };

  const handlePromptClick = (prompt: string) => {
    onSend(prompt);
  };

  return (
    <div className={`flex flex-col h-full min-h-0 ${className}`}>
      {contextSummary && (
        <div className="px-4 py-2 text-[11px] text-muted-foreground border-b bg-muted/30">
          Context: {contextSummary}
        </div>
      )}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-auto px-4 py-4 min-h-[200px]"
      >
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl border px-4 py-3 text-sm shadow-xs backdrop-blur ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground border-primary/30"
                      : "bg-white/70 dark:bg-white/5 border-border/70"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {m.role === "assistant" && (
                      <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-xl border bg-white/50 dark:bg-white/5">
                        <Bot className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="flex-1 min-w-0 [&_p]:my-1 [&_ul]:my-2 [&_li]:my-0 [&_strong]:font-semibold text-sm leading-relaxed">
                      {m.role === "assistant" ? (
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap m-0">{m.content}</p>
                      )}
                    </div>
                    {m.role === "user" && (
                      <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-xl bg-primary/20">
                        <User className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[85%] rounded-2xl border bg-white/70 px-4 py-3 text-sm shadow-xs dark:bg-white/5">
                  <div className="flex items-start gap-2">
                    <Bot className="h-3.5 w-3.5 animate-pulse mt-0.5" />
                    <span className="text-muted-foreground">{loadingMessage}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {messages.length === 0 && !loading && suggestedPrompts && suggestedPrompts.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Suggested questions:</p>
              <div className="flex flex-wrap gap-2">
                {suggestedPrompts.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="sm"
                    className="text-xs h-auto py-1.5 px-3 font-normal whitespace-normal text-left"
                    onClick={() => handlePromptClick(prompt)}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Separator />
      <div className="flex items-center gap-2 p-3">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={loading ? loadingMessage : "Ask about your results..."}
          className="h-11 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={loading}
        />
        <Button
          size="icon"
          className="h-11 w-11 rounded-xl flex-shrink-0"
          onClick={handleSend}
          disabled={loading || !inputValue.trim()}
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
