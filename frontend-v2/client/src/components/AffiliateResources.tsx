import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { affiliateFetch } from '@/lib/affiliateToken';
import { BookOpen, Download, Eye, FileText, Loader2, X } from 'lucide-react';
import { CoachMarkdown } from '@/components/CoachMarkdown';
import { fetchAffiliateResourceText } from '@/lib/affiliateResourceText';
import { toast } from 'sonner';

export interface AffiliateResource {
  slug: string;
  title: string;
  description: string;
  category: string;
  updatedAt: string;
  audience: string;
  fileName: string;
  sizeBytes: number;
  /** 'md' documents render inline; PDFs open via a signed link. Older APIs omit it (= pdf). */
  format?: 'pdf' | 'md';
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string) {
  // Date-only ISO strings parse as UTC midnight; format in UTC so the day
  // doesn't slip backwards in western time zones.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Enablement documents (outreach guide, playbook, payment structure). PDFs
 * open via a 10-minute signed link minted per click, so the affiliate token
 * never goes into a URL the browser opens. Markdown documents are fetched
 * through the same signed link and rendered inline with the hardened
 * markdown renderer.
 */
export function AffiliateResources({ token }: { token: string }) {
  const [resources, setResources] = useState<AffiliateResource[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<{ slug: string; text: string } | null>(null);

  async function load() {
    setError('');
    setResources(null);
    try {
      const res = await affiliateFetch('/affiliate/resources', token);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed to load resources');
      setResources(Array.isArray(d.resources) ? d.resources : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load resources');
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function open(slug: string, download: boolean) {
    const key = `${slug}:${download ? 'download' : 'view'}`;
    setBusy(key);
    try {
      const res = await affiliateFetch(`/affiliate/resources/${encodeURIComponent(slug)}/link`, token);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Failed to open document');
      window.open(download ? `${d.url}&download=1` : d.url, '_blank', 'noopener');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open document');
    } finally {
      setBusy(null);
    }
  }

  async function read(slug: string) {
    if (reading?.slug === slug) { setReading(null); return; }
    setBusy(`${slug}:read`);
    try {
      setReading({ slug, text: await fetchAffiliateResourceText(slug, token) });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to open document');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5" id="affiliate-resources">
      <h2 className="text-sm font-semibold mb-1">Resources</h2>
      <p className="text-xs text-muted-foreground mb-4">Guides to help you bring trainers onto Axiom and pitch the platform.</p>

      {error ? (
        <div className="flex items-center justify-between gap-3 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      ) : resources === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading resources…
        </div>
      ) : resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No resources yet. Check back soon.</p>
      ) : (
        <div className="space-y-3">
          {resources.map(r => (
            <div key={r.slug} data-testid={`resource-${r.slug}`} className="rounded-lg border border-border p-4 flex flex-col sm:flex-row sm:items-start gap-3">
              <FileText size={18} className="text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{r.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">{r.category}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Updated {formatDate(r.updatedAt)} · {r.format === 'md' ? 'Read online' : `PDF · ${formatSize(r.sizeBytes)}`}
                </p>
                {reading?.slug === r.slug && (
                  <div data-testid={`resource-doc-${r.slug}`} className="mt-3 rounded-md border border-border bg-muted/30 p-4 max-h-[32rem] overflow-y-auto">
                    <CoachMarkdown content={reading.text} />
                  </div>
                )}
              </div>
              {r.format === 'md' ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => read(r.slug)} disabled={busy !== null} aria-label={`${reading?.slug === r.slug ? 'Close' : 'Read'} ${r.title}`}>
                    {busy === `${r.slug}:read` ? <Loader2 size={13} className="animate-spin mr-1.5" /> : reading?.slug === r.slug ? <X size={13} className="mr-1.5" /> : <BookOpen size={13} className="mr-1.5" />}
                    {reading?.slug === r.slug ? 'Close' : 'Read'}
                  </Button>
                </div>
              ) : (
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => open(r.slug, false)} disabled={busy !== null} aria-label={`View ${r.title}`}>
                  {busy === `${r.slug}:view` ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Eye size={13} className="mr-1.5" />}
                  View
                </Button>
                <Button size="sm" variant="outline" onClick={() => open(r.slug, true)} disabled={busy !== null} aria-label={`Download ${r.title}`}>
                  {busy === `${r.slug}:download` ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Download size={13} className="mr-1.5" />}
                  Download
                </Button>
              </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
