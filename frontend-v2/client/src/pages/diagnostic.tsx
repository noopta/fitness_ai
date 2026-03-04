import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Bot, CheckCircle2, ChevronRight, SendHorizonal, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { liftCoachApi } from "@/lib/api";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";

type ChatRole = "assistant" | "user";

type Msg = {
  id: string;
  role: ChatRole;
  content: string;
};

function formatMessage(content: string) {
  // Split by numbered questions (e.g., **1.**, **2.**, **3.**)
  const questionPattern = /\*\*(\d+)\.\*\*/g;
  const parts = content.split(questionPattern);
  
  if (parts.length <= 1) {
    // No questions detected, return as plain text with basic formatting
    return content.split('\n').map((line, i) => (
      <p key={i} className={i > 0 ? "mt-2" : ""}>
        {line.split(/(\*\*.*?\*\*)/g).map((segment, j) => {
          if (segment.startsWith('**') && segment.endsWith('**')) {
            return <strong key={j}>{segment.slice(2, -2)}</strong>;
          }
          return segment;
        })}
      </p>
    ));
  }

  // Format with numbered questions
  const elements: JSX.Element[] = [];
  
  // Add intro text (before first question)
  if (parts[0].trim()) {
    elements.push(
      <p key="intro" className="mb-4 leading-relaxed">
        {parts[0].trim()}
      </p>
    );
  }

  // Add questions
  for (let i = 1; i < parts.length; i += 2) {
    const questionNumber = parts[i];
    const questionText = parts[i + 1]?.trim() || '';
    
    if (questionText) {
      elements.push(
        <div key={`q-${questionNumber}`} className="mb-3 last:mb-0">
          <div className="flex items-start gap-2">
            <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
              {questionNumber}
            </span>
            <p className="flex-1 leading-relaxed">
              {questionText.split(/(\*\*.*?\*\*)/g).map((segment, j) => {
                if (segment.startsWith('**') && segment.endsWith('**')) {
                  return <strong key={j}>{segment.slice(2, -2)}</strong>;
                }
                return segment;
              })}
            </p>
          </div>
        </div>
      );
    }
  }

  return <div className="space-y-2">{elements}</div>;
}

function LoadingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex justify-start"
    >
      <div className="max-w-[85%] rounded-2xl border bg-white/70 px-4 py-3 text-sm text-foreground shadow-xs backdrop-blur dark:bg-white/5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-xl border bg-white/50 text-foreground shadow-xs dark:bg-white/5">
            <Bot className="h-3.5 w-3.5 animate-pulse" />
          </span>
          <div className="min-w-0 flex-1 flex items-center gap-1">
            <span className="text-muted-foreground">AI is analyzing</span>
            <span className="flex gap-1">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={
        isUser
          ? "flex justify-end"
          : "flex justify-start"
      }
      data-testid={`msg-${msg.role}-${msg.id}`}
    >
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm"
            : "max-w-[85%] rounded-2xl border bg-white/70 px-4 py-3 text-sm text-foreground shadow-xs backdrop-blur dark:bg-white/5"
        }
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-xl border bg-white/50 text-foreground shadow-xs dark:bg-white/5">
            {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            {formatMessage(msg.content)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function Diagnostic() {
  const [, setLocation] = useLocation();
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "m0",
      role: "assistant",
      content:
        "I'll ask a few quick questions to isolate your sticking point. Short answers are perfect.",
    },
  ]);
  const [value, setValue] = useState("");
  const [sessionId, setSessionId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Load session ID and existing messages
  useEffect(() => {
    const storedSessionId = localStorage.getItem("liftoff_session_id");
    if (!storedSessionId) {
      toast.error("No session found. Please start from the beginning.");
      setLocation("/onboarding");
      return;
    }
    setSessionId(storedSessionId);

    // Load existing messages from backend
    loadMessages(storedSessionId);
  }, [setLocation]);

  async function loadMessages(sessionId: string) {
    setInitialLoading(true);
    try {
      const response = await liftCoachApi.getSession(sessionId);
      const existingMessages = (response as any).session?.messages || response.messages || [];
      
      if (existingMessages.length > 0) {
        const loadedMessages = existingMessages.map((msg, idx) => ({
          id: `loaded-${idx}`,
          role: msg.role,
          content: msg.content
        }));
        setMessages([messages[0], ...loadedMessages]);
        setQuestionCount(existingMessages.filter(m => m.role === 'user').length);
      } else {
        await getFirstQuestion(sessionId);
      }
    } catch (error) {
      console.error("Error loading messages:", error);
      await getFirstQuestion(sessionId);
    } finally {
      setInitialLoading(false);
    }
  }

  async function getFirstQuestion(sessionId: string) {
    try {
      const response = await liftCoachApi.sendMessage(sessionId, "start");
      if (!response.complete) {
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: response.message }
        ]);
      }
    } catch (error) {
      console.error("Error getting first question:", error);
      toast.error("Failed to load initial question. Please try again.");
    }
  }

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim() || loading || !sessionId) return;

    // Add user message
    const userMessage: Msg = { 
      id: `u-${Date.now()}`, 
      role: "user", 
      content: text.trim() 
    };
    setMessages(prev => [...prev, userMessage]);
    setValue("");
    setLoading(true);

    try {
      // Send to backend and get AI response
      const response = await liftCoachApi.sendMessage(sessionId, text.trim());
      
      if (response.complete) {
        setDone(true);
        setMessages(prev => [
          ...prev,
          { 
            id: `a-${Date.now()}`, 
            role: "assistant", 
            content: response.message || "That's enough signal. I have what I need to create your personalized plan." 
          }
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: response.message }
        ]);
      }
      
      setQuestionCount(prev => prev + 1);
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid-fade">
      <Navbar variant="step" title="Diagnostic interview" subtitle={questionCount > 0 ? `${questionCount} questions answered` : '4–8 questions, only when needed'} stepLabel="Step 3 of 4" />

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="glass relative overflow-hidden p-0">
            <div className="pointer-events-none absolute inset-0 noise" />
            <div className="relative flex h-[70vh] min-h-[520px] flex-col">
              <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                    <Shield className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold" data-testid="text-chat-title">
                      Diagnostic chat
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="text-chat-subtitle">
                      Constrained, safety-first
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className="inline-flex items-center gap-2 rounded-full border bg-white/60 px-3 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur dark:bg-white/5"
                    data-testid="badge-question-count"
                  >
                    {done ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
                        Complete
                      </>
                    ) : (
                      <>
                        <Bot className="h-3.5 w-3.5 text-primary animate-pulse" strokeWidth={1.8} />
                        In progress
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div
                ref={scrollerRef}
                className="flex-1 overflow-auto px-6 py-5"
                data-testid="scroll-chat"
              >
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {messages.map((m) => (
                      <Bubble key={m.id} msg={m} />
                    ))}
                    {(loading || initialLoading) && <LoadingBubble />}
                  </AnimatePresence>
                </div>
              </div>

              <Separator />

              <div className="flex items-center gap-2 px-4 py-3">
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={loading ? "AI is thinking..." : "Type your answer…"}
                  className="h-11"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loading) send(value);
                  }}
                  disabled={loading || done}
                  data-testid="input-chat"
                />
                <Button
                  size="icon"
                  className="h-11 w-11 rounded-xl shadow-sm"
                  onClick={() => send(value)}
                  disabled={loading || done || !value.trim()}
                  data-testid="button-send"
                >
                  <SendHorizonal className={`h-4 w-4 ${loading ? 'animate-pulse' : ''}`} />
                </Button>
              </div>

              <div className="px-6 pb-5">
                <AnimatePresence>
                  {done ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 flex flex-wrap items-center justify-between gap-3"
                      data-testid="panel-done"
                    >
                      <div className="text-sm text-muted-foreground" data-testid="text-done">
                        That’s enough signal. Ready to generate your plan.
                      </div>
                      <Button
                        size="lg"
                        className="shadow-sm"
                        onClick={() => setLocation("/plan")}
                        data-testid="button-generate-plan"
                      >
                        Generate plan
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 text-xs text-muted-foreground"
                      data-testid="text-hint"
                    >
                      Short answers are fine—e.g. “lockout”, “drifts to face”, “triceps give out”.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </Card>

          <Card className="glass p-6">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border bg-white/70 shadow-xs dark:bg-white/5">
                <ArrowUpRight className="h-4 w-4 text-primary" strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground" data-testid="text-what-next-eyebrow">
                  Output
                </div>
                <div className="mt-1 font-serif text-2xl" data-testid="text-what-next-title">
                  What you’ll get
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm text-muted-foreground">
              {["A diagnosis with confidence and evidence", "A lift-day prescription: primary + accessories", "Progression rules and what to track next session"].map(
                (x, idx) => (
                  <div className="flex items-start gap-3" key={x} data-testid={`row-output-${idx}`}>
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" strokeWidth={1.8} />
                    <p>{x}</p>
                  </div>
                ),
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
