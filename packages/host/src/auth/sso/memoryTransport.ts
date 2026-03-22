/**
 * In-memory SSO transport for testing.
 *
 * Provides a paired (host, wallet) transport where statements submitted
 * on one side are delivered to subscribers on the other side (and same-side
 * subscribers, matching the real statement-store behavior where both sides
 * see all statements on a topic).
 */

import type { SignedStatement, Statement, SsoSubscription, SsoTransport } from './transport.js';

type Subscriber = {
  topics: Uint8Array[];
  callback: (statements: Statement[]) => void;
};

function topicsMatch(statementTopics: Uint8Array[], filterTopics: Uint8Array[]): boolean {
  return filterTopics.some(filter =>
    statementTopics.some(topic => topic.length === filter.length && topic.every((b, i) => b === filter[i])),
  );
}

function toStatement(signed: SignedStatement): Statement {
  return {
    proofPublicKey: signed.proof.publicKey,
    topics: signed.topics,
    data: signed.data,
  };
}

/**
 * Create a shared in-memory message bus.
 *
 * All transports created from this bus see each other's statements.
 * Use `createMemoryTransport()` to get individual transports.
 */
export function createMemoryTransportBus(): {
  createTransport(): SsoTransport;
} {
  const subscribers = new Set<Subscriber>();

  function createTransport(): SsoTransport {
    return {
      subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): SsoSubscription {
        const sub: Subscriber = { topics, callback };
        subscribers.add(sub);
        return {
          unsubscribe() {
            subscribers.delete(sub);
          },
        };
      },

      async submit(statement: SignedStatement): Promise<void> {
        const stmt = toStatement(statement);
        for (const sub of subscribers) {
          if (topicsMatch(statement.topics, sub.topics)) {
            sub.callback([stmt]);
          }
        }
      },
    };
  }

  return { createTransport };
}
