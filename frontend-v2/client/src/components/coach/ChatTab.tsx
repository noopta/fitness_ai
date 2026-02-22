import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Send, Loader2, RotateCcw } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const TOPIC_PILLS = [
  { label: 'Nutrition', prompt: 'Give me nutrition advice tailored to my training data and goals.' },
  { label: 'Recovery', prompt: 'How should I be managing recovery given my training history?' },
  { label: 'Programming', prompt: 'Design a programming plan based on my analysis results.' },
  { label: 'Injury Prevention', prompt: 'What injury risks should I watch for given my weakness data?' },
  { label: 'Education', prompt: 'Explain the biomechanics behind my primary weakness.' },
  { label: 'Motivation', prompt: 'Help me stay consistent and accountable to my training goals.' },
];

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

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('### ')) return <p key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</p>;
    if (line.startsWith('## ')) return <p key={i} className="font-bold text-sm mt-4 mb-1">{line.slice(3)}</p>;
    if (line.startsWith('# ')) return <p key={i} className="font-bold text-base mt-4 mb-1">{line.slice(2)}</p>;
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
      if (match) return (
        <div key={i} className="flex items-start gap-2 text-sm leading-relaxed">
          <span className="shrink-0 font-semibold">{match[1]}.</span>
          <span>{applyInline(match[2])}</span>
        </div>
      );
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

interface Props {
  initialMessages?: Message[];
  sessionCount: number;
}

export function ChatTab({ initialMessages = [], sessionCount }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

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
      toast.error(err.message || 'Failed to get response');
      setMessages(prev => prev.slice(0, -1));
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

  return (
    <div className="flex flex-col h-full">
      {/* Topic pills */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b bg-muted/20">
        {TOPIC_PILLS.map(pill => (
          <button
            key={pill.label}
            onClick={() => sendMessage(pill.prompt)}
            className="rounded-full border bg-background px-3 py-1 text-xs font-medium hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
          >
            {pill.label}
          </button>
        ))}
        {messages.length > 0 && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="ml-auto rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && !sending && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto">
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
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/60 border'}`}>
                {msg.role === 'assistant' ? (
                  <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                ) : (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
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

      {/* Input */}
      <div className="border-t bg-background p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="Ask your coach anything… (Enter to send)"
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
          AI Coach has full context of your {sessionCount} analysis session{sessionCount !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}
