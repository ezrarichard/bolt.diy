import { getBuildersDbClient } from '~/lib/builders-db/client';
import {
  fromRequirementsSessionMessageRow,
  toRequirementsSessionMessageInsert,
  type BuildersDbRequirementsSessionMessageRow,
} from '~/lib/builders-db/requirementsSessionDbTypes';
import { createRepositoryLogger } from '~/lib/builders-db/repositories/requirementsDiscoveryLogging';
import type { RequirementsSessionMessage } from '~/lib/projects/requirementsSession';

/**
 * Requirements Session Message Repository — Sprint 50 (Durable Foundation).
 *
 * Async, network-backed, append-only persistence for
 * `builders_requirements_session_messages`. Deliberately exposes no update/delete function —
 * the table itself has no UPDATE/DELETE policy for `authenticated` either (see the migration),
 * so append-only is enforced at both the repository interface and the database layer, not
 * just by convention.
 */

const { unavailable, logError } = createRepositoryLogger('RequirementsSessionMessageRepository');

/**
 * Appends one message to a session, computing the next deterministic `sequenceNumber` from
 * the current highest value for this session. Not wrapped in a database transaction/RPC in
 * this sprint — the `unique (session_id, sequence_number)` constraint means a genuine race
 * surfaces as a clear insert error rather than silently duplicating an ordering position.
 * Hardening this into a single atomic RPC is a reasonable Interview Mode (Sprint 55) follow-up
 * once concurrent same-session appends are actually possible; Sprint 50 introduces no caller
 * that appends concurrently.
 */
export async function appendRequirementsSessionMessage(
  sessionId: string,
  projectId: string,
  message: Pick<RequirementsSessionMessage, 'role' | 'messageType' | 'content' | 'metadata'>,
): Promise<RequirementsSessionMessage | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('appendRequirementsSessionMessage');
    return null;
  }

  try {
    const { data: latest, error: latestError } = await client
      .from('builders_requirements_session_messages')
      .select('sequence_number')
      .eq('session_id', sessionId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      throw latestError;
    }

    const nextSequenceNumber = (latest?.sequence_number ?? 0) + 1;

    const { data, error } = await client
      .from('builders_requirements_session_messages')
      .insert(toRequirementsSessionMessageInsert(sessionId, projectId, message, nextSequenceNumber))
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return fromRequirementsSessionMessageRow(data as BuildersDbRequirementsSessionMessageRow);
  } catch (error) {
    logError('appendRequirementsSessionMessage', error);
    return null;
  }
}

/** Every message for a session, in deterministic `sequenceNumber` order. */
export async function listRequirementsSessionMessages(sessionId: string): Promise<RequirementsSessionMessage[]> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('listRequirementsSessionMessages');
    return [];
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_session_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence_number', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => fromRequirementsSessionMessageRow(row as BuildersDbRequirementsSessionMessageRow));
  } catch (error) {
    logError('listRequirementsSessionMessages', error);
    return [];
  }
}

/** The most recently appended message for a session, or null if the session has no messages yet. */
export async function getLatestRequirementsSessionMessage(
  sessionId: string,
): Promise<RequirementsSessionMessage | null> {
  const client = getBuildersDbClient();

  if (!client) {
    unavailable('getLatestRequirementsSessionMessage');
    return null;
  }

  try {
    const { data, error } = await client
      .from('builders_requirements_session_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? fromRequirementsSessionMessageRow(data as BuildersDbRequirementsSessionMessageRow) : null;
  } catch (error) {
    logError('getLatestRequirementsSessionMessage', error);
    return null;
  }
}

export const requirementsSessionMessageRepository = {
  appendRequirementsSessionMessage,
  listRequirementsSessionMessages,
  getLatestRequirementsSessionMessage,
};
