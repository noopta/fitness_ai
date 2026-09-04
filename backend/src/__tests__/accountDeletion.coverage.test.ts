// Guard against the class of bug that broke account deletion in Sep 2026.
//
// DELETE /auth/account removes a user's rows by hand, model by model. Every
// time a model with a RESTRICT relation to User is added and that list isn't
// updated, deletion starts failing — with a P2003 that SQLite reports as
// `constraint: null`, so the logs don't even name the culprit. That is how
// AdaptationProposal (shipped Aug 2026) silently blocked deletion for every
// user who had ever been offered a progression change, and how
// GroupChat.createdById sat unnoticed behind it.
//
// This test reads schema.prisma and fails when a model can block user.delete
// but the route doesn't handle it. It is deliberately a source-text check
// rather than a DB test: the failure mode is a human forgetting a line, and
// this catches it at the point the model is added rather than the first time
// a real user tries to erase their account.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/auth.ts'), 'utf8');

/**
 * Models whose rows deliberately outlive the user, with the reason. Anything
 * here must NOT have a blocking FK — if it does, deletion breaks and the
 * exemption is wrong.
 */
const INTENTIONALLY_RETAINED: Record<string, string> = {
  ContentFlag: 'abuse history a user could otherwise erase by re-registering (userId is not an FK)',
};

interface BlockingRelation { model: string; field: string; onDelete: string }

function findBlockingRelations(): BlockingRelation[] {
  const out: BlockingRelation[] = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema))) {
    const [, model, body] = m;
    if (model === 'User') continue;
    for (const line of body.split('\n')) {
      // A relation field pointing at User, e.g.
      //   user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
      //   createdBy User @relation("GroupCreator", fields: [createdById], references: [id])
      const rel = line.match(/^\s*(\w+)\s+User(\?)?\s+@relation\(([^)]*)\)/);
      if (!rel) continue;
      const [, field, optionalMarker, args] = rel;
      const explicit = args.match(/onDelete:\s*(\w+)/);
      // Prisma's defaults when onDelete is omitted: SetNull for an optional
      // relation, Restrict for a required one.
      const onDelete = explicit ? explicit[1] : (optionalMarker ? 'SetNull' : 'Restrict');
      // Cascade and SetNull both resolve themselves; only the others block.
      if (onDelete === 'Cascade' || onDelete === 'SetNull') continue;
      out.push({ model, field, onDelete });
    }
  }
  return out;
}

/** The route calls these as `t.<camelCasedModel>.deleteMany({...})`. */
function routeHandles(model: string): boolean {
  const camel = model.charAt(0).toLowerCase() + model.slice(1);
  return new RegExp(`t\\.${camel}\\.deleteMany`).test(routeSrc);
}

describe('DELETE /auth/account covers every blocking relation', () => {
  const blocking = findBlockingRelations();

  it('finds blocking relations to check (guards against the parser silently matching nothing)', () => {
    expect(blocking.length).toBeGreaterThan(5);
  });

  it.each(blocking)('$model via $field ($onDelete) is deleted before user.delete', ({ model }) => {
    if (INTENTIONALLY_RETAINED[model]) {
      throw new Error(
        `${model} is marked intentionally retained (${INTENTIONALLY_RETAINED[model]}) but has a ` +
        `blocking FK to User, so it will fail user.delete. Either drop the FK or delete the rows.`,
      );
    }
    expect(
      routeHandles(model),
      `${model} has a blocking relation to User but DELETE /auth/account never deletes it. ` +
      `Add a tryDelete for it, or the next user who owns one of these rows cannot delete their account.`,
    ).toBe(true);
  });
});
