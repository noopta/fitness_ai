import { useState } from 'react';
import { Link } from 'wouter';
import { Dumbbell, TrendingUp, Bot, Users, MessageCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { NavbarV1 } from '@/components/NavbarV1';
import { NavbarV2 } from '@/components/NavbarV2';
import NavbarV3 from '@/components/NavbarV3';
import { NavbarV4 } from '@/components/NavbarV4';
import { NavbarV5 } from '@/components/NavbarV5';

// ─── Variant metadata ─────────────────────────────────────────────────────────
const VARIANTS = [
  {
    id: 1,
    label: '1 Dropdown',
    name: 'Grouped Dropdown',
    style: 'Notion / Linear',
    description:
      'A flat top bar with primary navigation items exposed inline and secondary (social) links collapsed into a single dropdown. Keeps the bar uncluttered without hiding anything important.',
    pros: ['Reduces visual noise for social links', 'Familiar dropdown pattern', 'Good for 6–10 total routes'],
  },
  {
    id: 2,
    label: '2 Icons',
    name: 'Icon-only + Tooltips',
    style: 'Slack / Figma',
    description:
      'Ultra-compact bar showing only icons. Labels appear on hover via tooltips. Ideal for power users who already know the app, or when screen real estate is tight.',
    pros: ['Smallest horizontal footprint', 'Works great at any screen width', 'Familiar to experienced app users'],
  },
  {
    id: 3,
    label: '3 Sidebar',
    name: 'Sidebar Navigation',
    style: 'Linear / Notion',
    description:
      'A persistent left sidebar with icons + labels and a main content area to the right. Best for productivity and data-heavy apps where you want the nav always visible.',
    pros: ['All routes always visible', 'Great for keyboard nav', 'Scales to many routes easily'],
  },
  {
    id: 4,
    label: '4 Avatar',
    name: 'Avatar Dropdown',
    style: 'GitHub / Vercel',
    description:
      'Minimal top bar: only the 3 most-used routes inline, then everything else in a grouped avatar dropdown. Clean aesthetic with full access on demand.',
    pros: ['Extremely minimal bar', 'Grouped sections feel intentional', 'User context always visible'],
  },
  {
    id: 5,
    label: '5 Overflow',
    name: 'Primary + Overflow',
    style: 'Airbnb / Spotify',
    description:
      'Primary routes flat with a "More ▾" overflow dropdown for secondary links. Balances discoverability with cleanliness — core paths one click, rest two clicks.',
    pros: ['Best of flat + collapsed', 'Primary routes maximally fast', 'Familiar "More" pattern'],
  },
] as const;

type VariantId = 1 | 2 | 3 | 4 | 5;

// ─── Mock content cards ───────────────────────────────────────────────────────
function MockContentCards() {
  const cards = [
    { icon: <Dumbbell className="h-5 w-5 text-primary" />, title: 'Push Day', sub: '5 exercises · 62 min', badge: 'Today' },
    { icon: <TrendingUp className="h-5 w-5 text-emerald-500" />, title: 'Bench Press', sub: '1RM estimate: 195 lbs', badge: '+3 lbs' },
    { icon: <Bot className="h-5 w-5 text-violet-500" />, title: 'Coach Insight', sub: 'Your squat volume is up 12% this week.', badge: 'New' },
    { icon: <Users className="h-5 w-5 text-blue-500" />, title: 'Jake logged a PR', sub: 'Deadlift · 315 lbs', badge: 'Friend' },
    { icon: <MessageCircle className="h-5 w-5 text-orange-500" />, title: 'New message', sub: 'From: Alex — "Good session today!"', badge: '1' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c, i) => (
        <Card key={i} className="p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted">
            {c.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{c.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.sub}</p>
          </div>
          <Badge variant="secondary" className="text-[10px] shrink-0">{c.badge}</Badge>
        </Card>
      ))}
    </div>
  );
}

// ─── Main content area shown inside each variant demo ─────────────────────────
function DemoContent({ variantId }: { variantId: VariantId }) {
  const v = VARIANTS.find(x => x.id === variantId)!;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6 pb-28">
      {/* Heading */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wider">
              Style {variantId}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">{v.style}</Badge>
          </div>
          <h1 className="text-2xl font-bold">Nav Style {variantId}: {v.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">{v.description}</p>
        </div>
      </div>

      {/* Pros list */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Why this pattern works</p>
        <ul className="space-y-1.5">
          {v.pros.map((pro, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="text-primary mt-0.5">✓</span>
              {pro}
            </li>
          ))}
        </ul>
      </Card>

      {/* Mock app cards */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Sample app content</p>
        <MockContentCards />
      </div>

      {/* Quick nav links for context */}
      <Card className="p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">App routes (click to navigate)</p>
        <div className="flex flex-wrap gap-2">
          {[
            ['/workouts', 'Workouts'],
            ['/strength-profile', 'Strength Profile'],
            ['/coach', 'AI Coach'],
            ['/friends', 'Friends'],
            ['/messages', 'Messages'],
            ['/social', 'Social Feed'],
            ['/history', 'History'],
            ['/settings', 'Settings'],
          ].map(([href, label]) => (
            <Link key={href} href={href}>
              <Badge variant="outline" className="cursor-pointer hover:bg-accent transition-colors text-xs px-3 py-1">
                {label}
              </Badge>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}

// ─── Floating pill switcher ───────────────────────────────────────────────────
function VariantPill({
  active,
  onChange,
}: {
  active: VariantId;
  onChange: (id: VariantId) => void;
}) {
  return (
    <div className="fixed bottom-6 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border bg-background shadow-lg px-1.5 py-1.5">
        {VARIANTS.map(v => (
          <button
            key={v.id}
            onClick={() => onChange(v.id as VariantId)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              active === v.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NavDemoPage() {
  const { user, loading } = useAuth();
  const [active, setActive] = useState<VariantId>(1);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <h1 className="text-xl font-bold">Navbar Demo</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Log in to see the navbar variants in context with real auth state.
        </p>
        <Link
          href="/login"
          className="rounded-xl bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Log in
        </Link>
      </div>
    );
  }

  // V3 is a layout component — wrap content in it
  if (active === 3) {
    return (
      <>
        <NavbarV3>
          <DemoContent variantId={3} />
        </NavbarV3>
        <VariantPill active={active} onChange={setActive} />
      </>
    );
  }

  const navMap: Record<number, React.ComponentType> = {
    1: NavbarV1,
    2: NavbarV2,
    4: NavbarV4,
    5: NavbarV5,
  };
  const NavComponent = navMap[active] ?? NavbarV1;

  return (
    <div className="min-h-screen bg-background">
      <NavComponent />
      <DemoContent variantId={active} />
      <VariantPill active={active} onChange={setActive} />
    </div>
  );
}
