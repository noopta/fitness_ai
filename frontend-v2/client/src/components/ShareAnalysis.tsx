import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Share2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.airthreads.ai:4009/api';

interface ShareAnalysisProps {
  sessionId: string;
}

export function ShareAnalysis({ sessionId }: ShareAnalysisProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    if (shareUrl) {
      copyUrl(shareUrl);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/share`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('Failed to share');
      const data = await res.json();
      setShareUrl(data.shareUrl);
      copyUrl(data.shareUrl);
    } catch {
      toast.error('Failed to create share link');
    } finally {
      setLoading(false);
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success('Share link copied!');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={share} disabled={loading}>
        {copied ? (
          <Check className="mr-2 h-4 w-4 text-green-500" />
        ) : (
          <Share2 className="mr-2 h-4 w-4" />
        )}
        {shareUrl ? (copied ? 'Copied!' : 'Copy Link') : 'Share'}
      </Button>

      {shareUrl && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('Check out my LiftOff strength analysis!')}`, '_blank')}
          >
            Post to X
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent('Check out my LiftOff analysis: ' + shareUrl)}`, '_blank')}
          >
            WhatsApp
          </Button>
        </>
      )}
    </div>
  );
}
