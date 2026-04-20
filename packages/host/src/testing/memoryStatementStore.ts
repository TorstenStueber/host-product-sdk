/**
 * In-memory statement store adapter for testing.
 *
 * Provides a shared bus where all adapters see each other's statements.
 *
 * Topic matching uses the same `matchAll` semantics as the real adapter:
 * a statement is delivered to a subscriber when the subscriber's topic
 * set is a subset of the statement's topics (empty subscriber topics
 * match everything).
 */

import { okAsync } from 'neverthrow';
import type {
  StatementStoreAdapter,
  Statement,
  SignedStatement,
  StatementStoreError,
} from '../statementStore/types.js';

type Subscriber = {
  topics: Uint8Array[];
  callback: (statements: Statement[]) => void;
};

function topicEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * `matchAll` semantics: every filter topic must appear in the
 * statement's topics. Empty filter matches any statement.
 */
function matchAll(statementTopics: Uint8Array[] | undefined, filterTopics: Uint8Array[]): boolean {
  if (filterTopics.length === 0) return true;
  if (!statementTopics || statementTopics.length === 0) return false;
  return filterTopics.every(filter => statementTopics.some(topic => topicEquals(topic, filter)));
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

      submit(statement: SignedStatement) {
        const stmt: Statement = { ...statement };
        allStatements.push(stmt);
        for (const sub of subscribers) {
          if (matchAll(statement.topics, sub.topics)) {
            sub.callback([stmt]);
          }
        }
        return okAsync<void, StatementStoreError>(undefined);
      },

      query(topics: Uint8Array[]) {
        return okAsync<Statement[], StatementStoreError>(allStatements.filter(s => matchAll(s.topics, topics)));
      },
    };
  }

  return { createAdapter };
}
