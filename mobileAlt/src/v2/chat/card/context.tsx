// What a card can ask of the thread it lives in. The chat screen provides
// this; cards never call the API or navigate on their own, so the same card
// renders anywhere (thread, "While you were away", a test).
//
// The edit session is app-wide: one field editable at a time (spec §7.3.6).
// The row renders its TextInput from it and the Save bar above the keyboard
// (owned by the chat screen) saves from it.

import React, { createContext, useContext } from 'react';
import type { View } from 'react-native';
import type { Card, CardAction, CardRoute, CardRow } from '@axiom/agent-ui-core';
import type { CardActionExtra } from '../../api';

export interface EditSession {
  cardId: string;
  field: string;
  kind: NonNullable<CardRow['editable']>['kind'];
  /** The value as shown before the edit ("185 lb"). */
  initial: string;
  value: string;
}

export interface CardHandlers {
  act: (card: Card, action: CardAction, extra?: CardActionExtra) => Promise<void>;
  undo: (card: Card) => Promise<void>;
  /** Resolves false when the server refused (the row reverts, the note says so). */
  edit: (card: Card, field: string, value: string) => Promise<boolean>;
  toggle: (card: Card, field: string, on: boolean) => Promise<void>;
  answer: (card: Card, answer: { option?: number; text?: string }) => Promise<void>;
  open: (card: Card, route: CardRoute) => void;
  /** "Or type it" — focus the composer to answer this card (§7.5). */
  typeInstead: (card: Card) => void;
  /** Draft "Edit" — composer prefilled with the body (§7.6). */
  editDraft: (card: Card) => void;
  /** Plain message into the thread (tile swaps, follow-ups). */
  say: (text: string) => void;
  /** Scroll so `node`'s bottom sits 16 pt above the composer / Save bar (§7.1.3). */
  reveal: (node: View | null) => void;
  /** "Replaced by a newer suggestion ↓". */
  scrollToLatest: () => void;
  /** Typed-confirm field focused: the composer hides (§7.4). */
  setTypedFocus: (on: boolean) => void;
  editing: EditSession | null;
  beginEdit: (s: Omit<EditSession, 'value'> & { value?: string }) => void;
  setEditValue: (v: string) => void;
  endEdit: () => void;
}

const noop = async () => {};
const Ctx = createContext<CardHandlers>({
  act: noop, undo: noop, edit: async () => false, toggle: noop, answer: noop,
  open: () => {}, typeInstead: () => {}, editDraft: () => {}, say: () => {}, reveal: () => {}, scrollToLatest: () => {},
  setTypedFocus: () => {}, editing: null, beginEdit: () => {}, setEditValue: () => {}, endEdit: () => {},
});

export const CardHandlersProvider = ({ value, children }: { value: CardHandlers; children: React.ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useCardHandlers = () => useContext(Ctx);
