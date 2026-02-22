import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import {
  Send,
  Trash2,
  Dumbbell,
  ChevronRight,
  Loader2,
  Sparkles,
  Lock,
  RotateCcw,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionSummary {
  id: string;
  selectedLift: string;
  createdAt: string;
  primaryLimiter: string | null;
  confidence: number | null;
  archetype: string | null;
  efficiencyScore: number | null;
}

const STARTER_QUESTIONS = [
  'What should I focus on this week?',
  'Analyze my overall progress and weaknesses',
  'Build me a 4-week program based on my data',
  'What accessories should I prioritize?',
  'Am I recovering enough between sessions?',
  'What does my strength archetype mean?',
  'How should I adjust my nutrition for my goals?',
  'What injury risks should I watch out for?',
];

function formatLiftName(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Simple markdown renderer — bold, headers, bullet points
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('### ')) {
      return <p key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</p>;
    }
    if (line.startsWith('## ')) {
      return <p key={i} className="font-bold text-sm mt-4 mb-1">{line.slice(3)}</p>;
    }
    if (line.startsWith('# ')) {
      return <p key={i} className="font-bold text-base mt-4 mb-1">{line.slice(2)}</p>;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex items-start gap-2 text-sm leading-relaxed">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          <span>{applyInline(line.slice(2))}</span>
        </div>
      );
    }
    if (/^\d+\. /.test(line)) {
      const match = line.match(/^(\d+)\. (.*)/);
      if (match) {
        return (
          <div key={i} className="flex items-start gap-2 text-sm leading-relaxed">
            <span className="shrink-0 font-semibold">{match[1]}.</span>
            <span>{applyInline(match[2])}</span>
          </div>
        );
      }
    }
    if (line === '') return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm leading-relaxed">{applyInline(line)}</p>;
  });
}

function applyInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

export default function CoachPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isPro = user?.tier === 'pro' || user?.tier === 'enterprise';

  useEffect(() => {
    if (!isPro) { setLoading(false); return; }
    fetch(`${API_BASE}/coach/messages`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages || []);
        setSessions(data.sessionSummaries || []);
      })
      .catch(() => toast.error('Failed to load coach'))
      .finally(() => setLoading(false));
  }, [isPro]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMsg]);
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
      toast.error(err.message || 'Failed to get response');
      setMessages(prev => prev.slice(0, -1)); // remove optimistic user message
      setInput(trimmed);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function handleReset() {
    if (!confirm('Reset your conversation? This cannot be undone.')) return;
    setResetting(true);
    try {
      await fetch(`${API_BASE}/coach/thread`, { method: 'DELETE', credentials: 'include' });
      setMessages([]);
      toast.success('Conversation reset');
    } catch {
      toast.error('Failed to reset');
    } finally {
      setResetting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="container max-w-7xl mx-auto px-4 flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-2">
              <BrandLogo height={28} className="h-7 w-auto" />
              <span className="text-sm font-semibold hidden sm:block">LiftOff</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">AI Coach</span>
              <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wide">Pro</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/history">
              <Button variant="ghost" size="sm" className="rounded-xl text-xs">My Analyses</Button>
            </Link>
            <Link href="/onboarding">
              <Button variant="ghost" size="sm" className="rounded-xl text-xs">New Analysis</Button>
            </Link>
            {isPro && messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl text-xs text-muted-foreground"
                onClick={handleReset}
                disabled={resetting}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </header>

      {!isPro ? (
        /* Upgrade wall */
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full p-8 text-center space-y-5">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 mx-auto">
              <Lock className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">AI Coach is a Pro feature</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Upgrade to Pro to unlock your personal AI strength coach — fully aware of your analysis history, goals, and weaknesses.
              </p>
            </div>
            <div className="space-y-2 text-left text-sm text-muted-foreground">
              {[
                'Personalized program design from your data',
                'Nutrition & recovery guidance',
                'Injury prevention & prehab',
                'Evidence-based education',
                'Unlimited coaching conversations',
              ].map(f => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <Link href="/pricing">
              <Button className="w-full rounded-xl bg-gradient-to-r from-primary to-blue-600 font-semibold">
                Upgrade to Pro
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </Card>
        </div>
      ) : (
        /* Main coach layout */
        <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>

          {/* Left sidebar — analysis history */}
          <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r bg-muted/20 overflow-hidden">
            <div className="px-4 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Analyses</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sessions.length} session{sessions.length !== 1 ? 's' : ''} loaded as context</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sessions.length === 0 ? (
                <div className="text-center py-8">
                  <Dumbbell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No analyses yet</p>
                  <Link href="/onboarding">
                    <Button variant="outline" size="sm" className="mt-3 rounded-xl text-xs">
                      Start Analysis
                    </Button>
                  </Link>
                </div>
              ) : (
                sessions.map(s => (
                  <Link key={s.id} href={`/plan`}>
                    <Card className="p-3 cursor-pointer hover:bg-background/80 transition-colors rounded-xl border">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{formatLiftName(s.selectedLift)}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(s.createdAt)}</p>
                        </div>
                        {s.efficiencyScore !== null && (
                          <span className="shrink-0 text-[10px] font-bold text-primary">{s.efficiencyScore}/100</span>
                        )}
                      </div>
                      {s.primaryLimiter && (
                        <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
                          {s.primaryLimiter}
                          {s.confidence ? ` · ${Math.round(s.confidence * 100)}%` : ''}
                        </p>
                      )}
                      {s.archetype && (
                        <span className="inline-block mt-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                          {s.archetype}
                        </span>
                      )}
                    </Card>
                  </Link>
                ))
              )}
            </div>
          </aside>

          {/* Main chat area */}
          <div className="flex-1 flex flex-col min-w-0">

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
              {messages.length === 0 && !sending && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-2xl mx-auto"
                >
                  <div className="text-center mb-8">
                    <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-blue-500/20 mx-auto mb-4">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-bold">Your AI Strength Coach</h2>
                    <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
                      I have full context of your analysis history and strength profile. Ask me anything about training, nutrition, recovery, or programming.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {STARTER_QUESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className="text-left rounded-xl border bg-background p-3 text-sm hover:bg-muted/50 hover:border-primary/30 transition-colors"
                      >
                        <span className="text-primary mr-1.5">→</span>
                        {q}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/60 border'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="space-y-0.5">
                          {renderMarkdown(msg.content)}
                        </div>
                      ) : (
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {sending && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-muted/60 border rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div className="border-t bg-background p-4">
              <div className="max-w-3xl mx-auto flex items-end gap-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask your coach anything… (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  disabled={sending}
                  className="flex-1 resize-none rounded-xl border bg-muted/30 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 min-h-[48px] max-h-40"
                  style={{ height: 'auto' }}
                  onInput={e => {
                    const t = e.currentTarget;
                    t.style.height = 'auto';
                    t.style.height = Math.min(t.scrollHeight, 160) + 'px';
                  }}
                />
                <Button
                  onClick={() => sendMessage(input)}
                  disabled={sending || !input.trim()}
                  size="icon"
                  className="rounded-xl h-12 w-12 shrink-0"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-center text-[10px] text-muted-foreground mt-2">
                AI Coach has full context of your {sessions.length} analysis session{sessions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
