import { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

// Pages where the widget should be hidden (chat already present or auth flow)
const HIDDEN_PATHS = ['/coach', '/login', '/register'];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_PROMPTS = [
  'What should I focus on this week?',
  'Review my recent progress',
  'Help me with nutrition',
  'Injury prevention tips',
];

/** Render inline **bold** segments within a string. */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('### ')) return <p key={i} className="font-semibold text-xs mt-2 mb-0.5">{renderInline(trimmed.slice(4))}</p>;
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) return <p key={i} className="font-bold text-xs mt-2 mb-0.5">{renderInline(trimmed.replace(/^#+\s/, ''))}</p>;
    // Bullet list (including indented sub-bullets)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const indent = line.length - trimmed.length;
      return (
        <div key={i} className="flex items-start gap-1.5 text-xs leading-relaxed" style={{ paddingLeft: indent > 0 ? '1rem' : 0 }}>
          <span className="mt-1.5 h-1 w-1 rounded-full bg-current shrink-0" />
          <span>{renderInline(trimmed.slice(2))}</span>
        </div>
      );
    }
    // Numbered list
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      return (
        <div key={i} className="flex items-start gap-1.5 text-xs leading-relaxed">
          <span className="shrink-0 font-medium tabular-nums">{numMatch[1]}.</span>
          <span>{renderInline(numMatch[2])}</span>
        </div>
      );
    }
    if (trimmed === '') return <div key={i} className="h-1.5" />;
    return <p key={i} className="text-xs leading-relaxed">{renderInline(line)}</p>;
  });
}

export function FloatingCoachChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { user, loading: authLoading } = useAuth();
  const [location] = useLocation();

  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';
  const isHidden = HIDDEN_PATHS.some(p => location.startsWith(p));

  useEffect(() => {
    if (!isHidden && open) {
      setTimeout(() => inputRef.current?.focus(), 150);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, isHidden]);

  useEffect(() => {
    if (!isHidden) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending, isHidden]);

  // Hide on pages where chat is already present or irrelevant
  if (isHidden) return null;

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-[360px] max-w-[calc(100vw-2.5rem)] rounded-2xl border bg-background shadow-2xl flex flex-col overflow-hidden"
            style={{ height: 'min(520px, calc(100vh - 100px))' }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-none">AI Coach</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Ask anything</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body: auth / upgrade / chat */}
            {authLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !user ? (
              /* Not logged in */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border bg-muted">
                  <MessageCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Sign in to chat</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a free account to access your AI coach.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href="/register">
                    <Button size="sm" className="rounded-xl text-xs" onClick={() => setOpen(false)}>
                      Get Started Free
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                  <Link href="/login">
                    <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={() => setOpen(false)}>
                      Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            ) : !isPro ? (
              /* Not pro */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border bg-primary/5">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-semibold">AI Coach is a Pro feature</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upgrade to unlock 24/7 coaching, personalized programs, and life event rescheduling.
                  </p>
                </div>
                <Link href="/pricing">
                  <Button size="sm" className="rounded-xl text-xs bg-gradient-to-r from-primary to-blue-600" onClick={() => setOpen(false)}>
                    Upgrade to Pro
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            ) : (
              /* Chat UI */
              <>
                {/* Quick prompts */}
                {messages.length === 0 && (
                  <div className="shrink-0 flex flex-wrap gap-1.5 px-3 py-2.5 border-b bg-muted/20">
                    {QUICK_PROMPTS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  {messages.length === 0 && !sending && (
                    <p className="text-center text-xs text-muted-foreground mt-4">
                      Your AI coach is ready. Ask anything.
                    </p>
                  )}

                  <AnimatePresence initial={false}>
                    {messages.map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[88%] rounded-2xl px-3 py-2.5 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/60 border'}`}>
                          {msg.role === 'assistant' ? (
                            <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                          ) : (
                            <p className="text-xs leading-relaxed">{msg.content}</p>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {sending && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="bg-muted/60 border rounded-2xl px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div className="shrink-0 border-t bg-background p-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                      placeholder="Ask your coach…"
                      rows={1}
                      disabled={sending}
                      className="flex-1 resize-none rounded-xl border bg-muted/30 px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 min-h-[40px] max-h-24"
                      onInput={e => {
                        const t = e.currentTarget;
                        t.style.height = 'auto';
                        t.style.height = Math.min(t.scrollHeight, 96) + 'px';
                      }}
                    />
                    <Button
                      onClick={() => sendMessage(input)}
                      disabled={sending || !input.trim()}
                      size="icon"
                      className="rounded-xl h-10 w-10 shrink-0"
                    >
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating toggle button */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg hover:shadow-xl transition-shadow"
        aria-label="Open AI Coach"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X className="h-5 w-5" />
            </motion.span>
          ) : (
            <motion.span key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <MessageCircle className="h-5 w-5" />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="text-sm font-semibold">Coach</span>
      </motion.button>
    </div>
  );
}
