import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowRight, Calendar, Clock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { BlogMarkdown } from "@/components/BlogMarkdown";
import { useAuth } from "@/context/AuthContext";
import { getPublishedPost, formatPostDate, type BlogPostFull } from "@/lib/blogApi";
import NotFound from "@/pages/not-found";

/**
 * Founder blog / startup-update post, loaded from the API by slug. The static
 * SEO guides under /blog/* are routed ahead of this, so this page only ever
 * sees slugs that were written in the admin editor.
 */
export default function BlogDynamicPostPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<BlogPostFull | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setPost(undefined);
    getPublishedPost(slug)
      .then(p => { if (!cancelled) setPost(p); })
      .catch(() => { if (!cancelled) setPost(null); });
    return () => { cancelled = true; };
  }, [slug]);

  if (post === null) return <NotFound />;

  if (post === undefined) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-2xl mx-auto px-4 py-16 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title,
    "description": post.excerpt,
    "url": `https://axiomtraining.io/blog/${post.slug}`,
    "datePublished": post.publishedAt ?? post.createdAt,
    "dateModified": post.updatedAt,
    "author": { "@type": "Organization", "name": "Axiom" },
    "publisher": {
      "@type": "Organization",
      "name": "Axiom",
      "url": "https://axiomtraining.io",
      "logo": { "@type": "ImageObject", "url": "https://axiomtraining.io/axiom-logo.png" }
    }
  };

  return (
    <>
      <SEO
        title={post.title}
        description={post.excerpt || undefined}
        canonical={`/blog/${post.slug}`}
        jsonLd={jsonLd}
      />
      <div className="min-h-screen bg-background">
        <Navbar />
        <article className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
          <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
            <Link href="/" className="hover:text-foreground transition-colors">Axiom</Link>
            <span>/</span>
            <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <span>/</span>
            <span className="text-foreground font-medium truncate">{post.title}</span>
          </nav>

          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{post.category}</span>
            {user?.isAdmin && (
              <Link href={`/admin/blog?edit=${post.id}`} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Pencil size={12} /> Edit
              </Link>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">{post.title}</h1>
          {post.excerpt && <p className="text-lg text-muted-foreground mb-4">{post.excerpt}</p>}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-10">
            <span className="flex items-center gap-1"><Calendar size={12} /> {formatPostDate(post.publishedAt ?? post.createdAt)}</span>
            <span className="flex items-center gap-1"><Clock size={12} /> {post.readingMinutes} min read</span>
          </div>

          <BlogMarkdown content={post.content} />

          <div className="rounded-2xl bg-foreground text-background p-6 text-center mt-14">
            <p className="text-xs font-semibold text-background/60 mb-1 uppercase tracking-wide">Free tool</p>
            <h2 className="text-lg font-bold mb-2">Get a personalized program in 5 minutes</h2>
            <p className="text-sm text-background/70 mb-4 max-w-sm mx-auto">
              Axiom diagnoses the exact weak link in your lift and builds a targeted plan to fix it — for free.
            </p>
            <Button asChild className="bg-background text-foreground hover:bg-background/90 font-semibold">
              <Link href="/register">Start my free diagnostic <ArrowRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </article>
      </div>
    </>
  );
}
