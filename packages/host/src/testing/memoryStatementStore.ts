/**
 * In-memory statement store adapter for testing.
 *
 * Provides a shared bus where all adapters see each other's statements.
 * Replaces the old memoryTransport.
 */

import type { StatementStoreAdapter, Statement, SignedStatement } from '../statementStore/types.js';

type Subscriber = {
  topics: Uint8Array[];
  callback: (statements: Statement[]) => void;
};

function topicsMatch(statementTopics: Uint8Array[] | undefined, filterTopics: Uint8Array[]): boolean {
  if (!statementTopics) return false;
  return filterTopics.some(filter =>
    statementTopics.some(topic => topic.length === filter.length && topic.every((b, i) => b === filter[i])),
  );
}

/**
 * Create a shared in-memory statement store bus.
 *
 * All adapters created from this bus see each other's statements.
 */
export function createMemoryStatementStore(): {
  createAdapter(): StatementStoreAdapter;
} {
  const subscribers = new Set<Subscriber>();
  const allStatements: Statement[] = [];

  function createAdapter(): StatementStoreAdapter {
    return {
      subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void {
        const sub: Subscriber = { topics, callback };
        subscribers.add(sub);
        return () => {
          subscribers.delete(sub);
        };
      },

      async submit(statement: SignedStatement): Promise<void> {
        const stmt: Statement = { ...statement };
        allStatements.push(stmt);
        for (const sub of subscribers) {
          if (topicsMatch(statement.topics, sub.topics)) {
            sub.callback([stmt]);
          }
        }
      },

      async query(topics: Uint8Array[]): Promise<Statement[]> {
        return allStatements.filter(s => topicsMatch(s.topics, topics));
      },
    };
  }

  return { createAdapter };
}
