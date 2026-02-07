import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, Send, Loader2, CheckCircle } from 'lucide-react';
import { apiRequest } from '@/lib/utils';
import type { DiagnosticMessage } from '@/types';

export default function DiagnosticChat() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [messages, setMessages] = useState<DiagnosticMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessionId) {
      loadSession();
    }
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadSession = async () => {
    try {
      const data = await apiRequest<{
        session: { messages: DiagnosticMessage[] };
      }>(`/sessions/${sessionId}`);

      if (data.session.messages && data.session.messages.length > 0) {
        setMessages(data.session.messages);
        setInitializing(false);
      } else {
        // Start the diagnostic interview
        await startDiagnostic();
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      setInitializing(false);
    }
  };

  const startDiagnostic = async () => {
    setLoading(true);
    try {
      // Send empty message to trigger first question
      const response = await apiRequest<{ complete: boolean; message: string }>(
        `/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ message: 'Ready to begin' })
        }
      );

      setMessages([
        { role: 'user', message: 'Ready to begin' },
        { role: 'assistant', message: response.message }
      ]);

      if (response.complete) {
        setComplete(true);
      }
    } catch (error) {
      console.error('Failed to start diagnostic:', error);
    } finally {
      setLoading(false);
      setInitializing(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message optimistically
    setMessages((prev) => [...prev, { role: 'user', message: userMessage }]);

    try {
      const response = await apiRequest<{ complete: boolean; message: string }>(
        `/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ message: userMessage })
        }
      );

      if (response.complete) {
        setComplete(true);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            message: 'Great! I have enough information to create your personalized plan.'
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', message: response.message }
        ]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          message: 'Sorry, there was an error. Please try again.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const generatePlan = async () => {
    setLoading(true);
    try {
      await apiRequest(`/sessions/${sessionId}/generate`, {
        method: 'POST'
      });
      navigate(`/plan/${sessionId}`);
    } catch (error) {
      console.error('Failed to generate plan:', error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6"
        >
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-4"
            disabled={loading}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <h1 className="text-3xl font-bold mb-2">Diagnostic Interview</h1>
          <p className="text-muted-foreground">
            {complete
              ? 'Diagnosis complete! Generate your personalized plan.'
              : 'Answer a few questions to identify your limiting factors.'}
          </p>
        </motion.div>

        {/* Chat Container */}
        <Card className="mb-6">
          <CardContent className="p-0">
            <div className="h-[500px] overflow-y-auto p-6 space-y-4">
              {initializing ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <AnimatePresence>
                  {messages.map((msg, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`flex ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-4 ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              <div ref={messagesEndRef} />
            </div>
          </CardContent>
        </Card>

        {/* Input Area or Complete Action */}
        {complete ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 mb-4 text-green-600">
              <CheckCircle className="w-6 h-6" />
              <span className="font-semibold">Diagnostic Complete</span>
            </div>
            <Button
              size="lg"
              onClick={generatePlan}
              disabled={loading}
              className="min-w-[250px]"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating Plan...
                </>
              ) : (
                'Generate My Training Plan'
              )}
            </Button>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type your response..."
              className="min-h-[100px]"
              disabled={loading}
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              size="icon"
              className="h-[100px] w-[60px]"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </motion.div>
        )}

        {/* Progress Indicator */}
        {!complete && !initializing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center text-sm text-muted-foreground"
          >
            Question {Math.floor(messages.filter((m) => m.role === 'assistant').length)} of ~6
          </motion.div>
        )}
      </div>
    </div>
  );
}
