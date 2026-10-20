/**
 * @fileoverview REST client for assistant sessions on the ChatApi Lambda's
 * `/chat/conversations/{proxy+}` routes (per Cognito user, server-scoped).
 *
 * @module assistant/sessions/sessionsApi
 */
import { z } from 'zod'
import { fetchApi } from '../../api/client'
import { apiErrorStatus } from '../../api/apiErrorStatus'
import {
  isValidSessionId, normalizeSessionList, normalizeSessionRecord,
} from './schema'
import { dropOldestTurns } from './serialize'
import type { SessionRecord, SessionSummary } from './schema'
import type { SaveSessionBody } from './serialize'

const PAYLOAD_TOO_LARGE = 413

function sessionPath(id: string): string {
  if (!isValidSessionId(id)) throw new Error('Invalid session id')
  return `/chat/conversations/${encodeURIComponent(id)}`
}

export async function listSessions(): Promise<SessionSummary[]> {
  return normalizeSessionList(await fetchApi<unknown>('/chat/conversations/_list?kind=assistant'))
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  return normalizeSessionRecord(await fetchApi<unknown>(sessionPath(id)))
}

function postSession(body: SaveSessionBody): Promise<unknown> {
  return fetchApi<unknown>(sessionPath(body.id), { method: 'POST', body: JSON.stringify(body) })
}

/** Save; on 413 drop the oldest turns once and retry. */
export async function saveSession(body: SaveSessionBody): Promise<void> {
  try {
    await postSession(body)
  } catch (error) {
    if (apiErrorStatus(error) !== PAYLOAD_TOO_LARGE) throw error
    await postSession({ ...body, messages: dropOldestTurns(body.messages) })
  }
}

export async function deleteSession(id: string): Promise<void> {
  await fetchApi<unknown>(sessionPath(id), { method: 'DELETE' })
}

const renamedSchema = z.object({ title: z.string().min(1) })

/**
 * Rename a saved conversation (`PUT /chat/conversations/{id}/title`). Every
 * later save keeps the name. Answers the stored title; 409 while a reply is
 * still being generated for it.
 */
export async function renameSession(id: string, title: string): Promise<string> {
  const raw = await fetchApi<unknown>(`${sessionPath(id)}/title`, { method: 'PUT', body: JSON.stringify({ title }) })
  const parsed = renamedSchema.safeParse(raw)
  return parsed.success ? parsed.data.title : title
}
