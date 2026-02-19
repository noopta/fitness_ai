import { useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResultsChatCore, ChatMessage } from "./ResultsChatCore";
import { liftCoachApi, WorkoutPlan } from "@/lib/api";
import { toast } from "sonner";

interface ResultsChatProps {
  plan: WorkoutPlan;
  resultsContent: React.ReactNode;
}

function buildContextSummary(plan: WorkoutPlan): string {
  const diag = plan.diagnosis?.[0];
  const lift = plan.bench_day_plan?.primary_lift?.exercise_name || "your lift";
  const limiter = diag?.limiterName || "analysis";
  return `your ${lift} plan, limiter: ${limiter}, accessories, progression rules`;
}

function buildSuggestedPrompts(plan: WorkoutPlan): string[] {
  const limiter = plan.diagnosis?.[0]?.limiterName || "my weak point";
  return [
    `Why was ${limiter} identified as my weak point?`,
    "Can you explain the accessory recommendations?",
    "What should I focus on most this week?",
    "How long until I see improvement?",
    "What does my balance score mean?",
  ];
}

export function ResultsChat({ plan, resultsContent }: ResultsChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("Thinking...");
  const isFirstMessage = useRef(true);
  const suggestedPrompts = buildSuggestedPrompts(plan);

  const contextSummary = buildContextSummary(plan);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 2000) {
        if (trimmed.length > 2000) toast.error("Message must be 2000 characters or less.");
        return;
      }
      const sessionId = localStorage.getItem("liftoff_session_id");
      if (!sessionId) {
        toast.error("No session found. Please start from the beginning.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: text },
      ]);
      setLoading(true);
      setLoadingMessage(
        isFirstMessage.current ? "Setting up your coach..." : "Thinking..."
      );

      try {
        const { reply } = await liftCoachApi.chat(sessionId, trimmed);
        isFirstMessage.current = false;
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: reply },
        ]);
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Something went wrong. Please try again.";
        toast.error(errorMsg);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: `Sorry, I couldn't process that. ${errorMsg} You can try again.`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const chatCore = (
    <ResultsChatCore
      messages={messages}
      onSend={handleSend}
      loading={loading}
      loadingMessage={loadingMessage}
      contextSummary={contextSummary}
      suggestedPrompts={messages.length === 0 ? suggestedPrompts : undefined}
    />
  );

  return (
    <Tabs defaultValue="results" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="results">Results</TabsTrigger>
        <TabsTrigger value="chat">Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="results" className="mt-4">
        {resultsContent}
      </TabsContent>
      <TabsContent value="chat" className="mt-4">
        <Card className="overflow-hidden">
          <div className="h-[500px]">{chatCore}</div>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
