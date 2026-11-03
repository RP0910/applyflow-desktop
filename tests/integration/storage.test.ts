import { describe, expect, it, vi } from 'vitest';
import { getSettings, saveSettings, setApiKey, getApiKey, deleteApiKey } from '@/storage/settingsStore';
import { storageGet } from '@/storage/chromeStorage';
import { saveResume, listResumes, setDefaultResume, deleteResume, getDefaultResume, saveApplication, listApplications, findApplicationsByJobKey, saveSession, getSession } from '@/storage/repositories';
import { onDataChange } from '@/storage/events';
import { recordFromSession, setStage } from '@/services/history/history';
import { buildMasterResume } from '@/services/resume/facts';
import { emptySession, exampleResumeText, mockJob } from '../helpers';

describe('settings and API key storage', () => {
  it('upgrades settings saved by v1.0 so long documents are no longer cut off', async () => {
    const { storageSet } = await import('@/storage/chromeStorage');
    await storageSet('applyflow.settings.v1', { engine: 'claude', maxOutputTokens: 2000 });
    const s = await getSettings();
    expect(s.maxOutputTokens).toBeGreaterThanOrEqual(16000);
    expect(s).toMatchObject({ effort: 'low', autoAdvanceSteps: true, autoFillSavedAnswers: true });
  });

  it('upgrades older settings to one Claude request per job, and keeps a partly saved resume layout complete', async () => {
    const { storageSet } = await import('@/storage/chromeStorage');
    await storageSet('applyflow.settings.v1', { schema: 2, engine: 'claude', atsRefinePass: true, resumeFormat: { font: 'calibri' } });
    const s = await getSettings();
    // 2.0: the refine pass (a second full request) is opt-in.
    expect(s.atsRefinePass).toBe(false);
    expect(s.promptCache).toBe('5m');
    expect(s.resumeFormat).toEqual({ font: 'calibri', bodySize: 10.5, dateStyle: 'mon_yyyy', showJobTechnologies: true, margins: 'normal', template: 'classic', accentColor: '#007595' });
  });

  it('stores the key separately from settings and never inside them', async () => {
    await setApiKey('  sk-ant-secret-123456789  ');
    await saveSettings({ model: 'claude-opus-5-5', apiKey: 'sk-ant-leak' } as never);
    const s = await getSettings();
    expect(s.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(s)).not.toContain('sk-ant');
    expect(JSON.stringify(await storageGet('applyflow.settings.v1'))).not.toContain('sk-ant');
    expect(await getApiKey()).toBe('sk-ant-secret-123456789');
    await deleteApiKey();
    expect(await getApiKey()).toBeNull();
    await expect(setApiKey('   ')).rejects.toThrow(/empty/);
  });
});

describe('resume library', () => {
  it('keeps exactly one default resume', async () => {
    const a = await saveResume(buildMasterResume('A', exampleResumeText(), 'text', null));
    const b = await saveResume(buildMasterResume('B', exampleResumeText(), 'text', null));
    expect((await getDefaultResume())!.id).toBe(a.id);
    await setDefaultResume(b.id);
    expect((await listResumes()).filter((r) => r.isDefault).map((r) => r.id)).toEqual([b.id]);
    await deleteResume(b.id);
    expect((await getDefaultResume())!.id).toBe(a.id);
  });
});

describe('history record creation', () => {
  it('creates, updates and finds records, and tells other pages about it', async () => {
    const events: string[] = [];
    const off = onDataChange((t) => events.push(t));
    const session = emptySession(mockJob());
    await saveSession(session);
    expect((await getSession(session.jobKey))!.job.title).toBe(session.job.title);
    const rec = await saveApplication(recordFromSession(session, 'Analyzed'));
    await saveApplication(setStage(rec, 'Applied'));
    const found = await findApplicationsByJobKey(session.jobKey);
    expect(found).toHaveLength(1);
    expect(found[0]!.stage).toBe('Applied');
    expect(found[0]!.stageHistory.map((s) => s.stage)).toEqual(['Analyzed', 'Applied']);
    expect((await listApplications())[0]!.id).toBe(rec.id);
    expect(events).toEqual(['sessions', 'applications', 'applications']);
    off();
  });
});

describe('data bus', () => {
  it('unsubscribes cleanly', async () => {
    const cb = vi.fn();
    const off = onDataChange(cb);
    off();
    await saveApplication(recordFromSession(emptySession(mockJob()), 'Saved'));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('resumes imported by an older version', () => {
  it('are re-read automatically, finding the jobs the old reader merged, and keep your fact decisions', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useLibrary } = await import('@/hooks/useLibrary');
    const glued = [
      'Riley Chen',
      'grant@example.com',
      'Experience',
      'AI Video Playback Engineer, Lumenstream 02/2023 – 05/2026 Denver, CO',
      '• Built retrieval pipelines for support and operations teams. Staff Software Engineer, Comcast 06/2018 – 01/2023 Philadelphia, PA',
      '• Led the player platform used by millions of monthly viewers.',
      'Skills',
      'Python, Kubernetes',
    ].join('\n');
    const fresh = buildMasterResume('FlowCV resume', glued, 'pdf', 'resume.pdf');
    const skill = fresh.facts.find((f) => f.kind === 'skill' && f.text === 'Kubernetes')!;
    // What v1.1 stored: one job, no reader version, and a fact the user excluded.
    await saveResume({
      ...fresh,
      parserVersion: undefined,
      parsed: { ...fresh.parsed, experience: [{ ...fresh.parsed.experience[0]!, bullets: ['Built retrieval pipelines … Staff Software Engineer, Comcast 06/2018 – 01/2023', 'Led the player platform'] }] },
      facts: fresh.facts.map((f) => (f.id === skill.id ? { ...f, status: 'do_not_use' as const } : f)),
    });
    const { result } = renderHook(() => useLibrary());
    await waitFor(() => expect(result.current.resumes[0]?.parserVersion).toBe(3));
    const r = result.current.resumes[0]!;
    expect(r.parsed.experience.map((e) => e.company)).toEqual(['Lumenstream', 'Comcast']);
    expect(r.facts.find((f) => f.kind === 'skill' && f.text === 'Kubernetes')!.status).toBe('do_not_use');
    expect(result.current.message?.text).toMatch(/now finds 2 jobs \(before: 1\)/);
  });
});
