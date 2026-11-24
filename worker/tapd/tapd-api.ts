import * as z from 'zod'
import type { ExternalTaskResult } from './contracts/external-task-source'

const API = 'https://api.tapd.cn/'
const envelopeSchema = z.object({ status: z.number(), data: z.unknown() })

function errorCode(status: number): ExternalTaskResult<never> {
  switch (status) {
    case 401:
      return { ok: false, code: 'credentials' }
    case 403:
      return { ok: false, code: 'permission' }
    case 404:
      return { ok: false, code: 'not-found' }
    case 409:
      return { ok: false, code: 'conflict' }
    case 429:
      return { ok: false, code: 'rate-limit' }
    case 400:
    case 422:
      return { ok: false, code: 'invalid' }
    default:
      return { ok: false, code: 'unavailable' }
  }
}

async function tapdRequest(
  path: string,
  params: URLSearchParams,
  token: string,
  method: 'GET' | 'POST'
): Promise<ExternalTaskResult<unknown>> {
  const url = new URL(path, API)
  if (method === 'GET') {
    url.search = params.toString()
  }
  try {
    const response = await fetch(url, {
      method,
      ...(method === 'POST' ? { body: params } : {}),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    })
    if (!response.ok) {
      return errorCode(response.status)
    }
    const result = envelopeSchema.safeParse(await response.json())
    if (!result.success) {
      return { ok: false, code: 'invalid' }
    }
    return result.data.status === 1
      ? { ok: true, value: result.data.data }
      : errorCode(result.data.status)
  } catch {
    return { ok: false, code: 'unavailable' }
  }
}

export function tapdGet(path: string, params: URLSearchParams, token: string) {
  return tapdRequest(path, params, token, 'GET')
}

export function tapdPost(path: string, params: URLSearchParams, token: string) {
  return tapdRequest(path, params, token, 'POST')
}
