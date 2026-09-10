import { useAuth } from '@/context/AuthContext';
import NotFound from '@/pages/not-found';

interface AdminRouteProps {
  component: React.ComponentType;
}

/**
 * Admin-only route. Anyone who is not on the server's ADMIN_EMAILS allowlist —
 * signed out, a member, an affiliate — gets the site's normal 404, so the page
 * doesn't even acknowledge that it exists. The API enforces requireAdmin on
 * its own; this just keeps the shell from rendering for the wrong person.
 */
export default function AdminRoute({ component: Component }: AdminRouteProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user?.isAdmin) return <NotFound />;

  return <Component />;
}
