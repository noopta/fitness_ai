// Shell state shared by the track, the header, the tab bar and the pages.
//
// `mode` is the home page's brief/chat state — it drives the dark ground, the
// tab bar's drop-out and the header mark's behaviour. `busy` is "Anakin is
// working" for the mark pulse. `goHome` is what tapping the header logo does
// from anywhere: closes pushed pages and the session, returns to index 0 in
// brief, keeps chat history.

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

export type HomeMode = 'brief' | 'chat';

interface Shell {
  mode: HomeMode;
  setMode: (m: HomeMode) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  index: number;
  /** Set by the track when it settles on a page. */
  setIndex: (i: number) => void;
  /** Ask the track to animate to a page. */
  goTo: (i: number) => void;
  registerGoTo: (fn: (i: number) => void) => void;
  goHome: () => void;
  /** Send a message into the home chat from elsewhere (session → "Something hurts"). */
  ask: (message: string) => void;
  registerAsk: (fn: (m: string) => void) => void;
  /** Queue a message to send once the home chat mounts. */
  pendingAsk: React.MutableRefObject<string | null>;
}

const Ctx = createContext<Shell | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<HomeMode>('brief');
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const goToRef = useRef<(i: number) => void>(() => {});
  const askRef = useRef<((m: string) => void) | null>(null);
  const pendingAsk = useRef<string | null>(null);

  const goTo = useCallback((i: number) => goToRef.current(i), []);
  const registerGoTo = useCallback((fn: (i: number) => void) => { goToRef.current = fn; }, []);
  const registerAsk = useCallback((fn: (m: string) => void) => { askRef.current = fn; }, []);
  const ask = useCallback((m: string) => {
    if (askRef.current) askRef.current(m);
    else pendingAsk.current = m;
    setMode('chat');
    goToRef.current(0);
  }, []);
  const goHome = useCallback(() => {
    try { if (router.canDismiss()) router.dismissAll(); } catch { /* not in a stack */ }
    setMode('brief');
    goToRef.current(0);
  }, [router]);

  const value = useMemo<Shell>(() => ({ mode, setMode, busy, setBusy, index, setIndex, goTo, registerGoTo, goHome, ask, registerAsk, pendingAsk }), [mode, busy, index, goTo, registerGoTo, goHome, ask, registerAsk]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): Shell {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}

/** Safe variant for components that may render outside the shell (pushed pages). */
export function useShellOptional(): Shell | null {
  return useContext(Ctx);
}
