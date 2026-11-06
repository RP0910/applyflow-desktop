/** Jobright’s own “Yes, I applied” action. source 0 is what the job page sends. */
export const JOBRIGHT_APPLY_API = 'https://swan-api.jobright.ai/swan/job/apply';

export interface JobrightApplyResult {
  ok: boolean;
  /** The API answered (success, rejection, or sign-in). A network failure is not settled. */
  settled: boolean;
  message: string;
}

export function jobrightApplyBody(jobId: string): { jobId: string; source: 0 } {
  return { jobId, source: 0 };
}

export function readJobrightApplyResult(status: number, json: unknown): JobrightApplyResult {
  const body = json && typeof json === 'object' ? (json as { success?: unknown; error?: unknown; message?: unknown }) : null;
  const detail = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
  if (body?.success === true || /already applied/i.test(detail)) {
    return { ok: true, settled: true, message: 'Marked as applied on Jobright.' };
  }
  if (status === 401 || status === 403 || /sign in|log ?in|unauthori[sz]ed|not authenticated/i.test(detail)) {
    return { ok: false, settled: true, message: 'Sign in on Jobright, then mark this job as applied.' };
  }
  if (body?.success === false) {
    return { ok: false, settled: true, message: detail || 'Jobright didn’t record this application.' };
  }
  return { ok: false, settled: false, message: 'Jobright didn’t record this application.' };
}

type ApplyFetch = (url: string, init: { method: string; credentials: 'include'; headers: Record<string, string>; body: string }) => Promise<{ status: number; json: () => Promise<unknown> }>;

/** Posts the apply mark. Tries Jobright’s API host, then the same path on the open job page. */
export async function postJobrightApplied(jobId: string, fetcher: ApplyFetch, pageOrigin?: string): Promise<JobrightApplyResult> {
  const urls = [JOBRIGHT_APPLY_API];
  if (pageOrigin) {
    try {
      urls.push(new URL('/swan/job/apply', pageOrigin).href);
    } catch {
      /* the page origin is only a fallback */
    }
  }
  const init = {
    method: 'POST',
    credentials: 'include' as const,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(jobrightApplyBody(jobId)),
  };
  let last = readJobrightApplyResult(0, null);
  for (const url of urls) {
    try {
      const res = await fetcher(url, init);
      const json = await res.json().catch(() => null);
      const read = readJobrightApplyResult(res.status, json);
      if (read.settled) return read;
      last = read;
    } catch {
      last = readJobrightApplyResult(0, null);
    }
  }
  return last;
}

/** Runs in the Jobright page so the request uses that signed-in session. */
export function jobrightApplyScript(jobId: string): string {
  const id = JSON.stringify(jobId);
  return `(async () => {
    const body = JSON.stringify({ jobId: ${id}, source: 0 });
    const urls = [${JSON.stringify(JOBRIGHT_APPLY_API)}, location.origin + '/swan/job/apply'];
    let last = { status: 0, json: null };
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
        let json = null;
        try { json = await res.json(); } catch (e) {}
        last = { status: res.status, json };
        if (json && typeof json.success === 'boolean') return last;
        if (res.status === 401 || res.status === 403) return last;
      } catch (e) {}
    }
    return last;
  })()`;
}
