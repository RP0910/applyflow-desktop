import { useCallback, useEffect, useState } from 'react';
import type { CareerProfile, FactStatus, MasterResume, VerifiedFact } from '@/types';
import { deleteResume, getProfile, listResumes, saveProfile, saveResume, setDefaultResume, EMPTY_PROFILE } from '@/storage/repositories';
import { buildMasterResume, PARSER_VERSION } from '@/services/resume/facts';
import { buildMasterFromForm, builderProblems } from '@/services/resume/builder';
import type { BuilderForm } from '@/types';
import { onDataChange } from '@/storage/events';
import { assessParse } from '@/services/resume/parser';
import { readResumeFile, rereadSource, ResumeFileError } from '@/services/resume/fileReaders';
import { newId } from '@/utils/id';

export interface LibraryMessage {
  tone: 'success' | 'critical' | 'warning' | 'info';
  text: string;
  details?: string[];
}

export function useLibrary() {
  const [resumes, setResumes] = useState<MasterResume[]>([]);
  const [profile, setProfile] = useState<CareerProfile>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<LibraryMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    let list = await listResumes();
    // Re-read resumes imported by an older reader (keeps the user's fact decisions).
    // Resumes entered in the form are never re-read from text.
    const stale = list.filter((r) => r.sourceFormat !== 'form' && (r.parserVersion ?? 1) < PARSER_VERSION && r.rawText.trim());
    if (stale.length) {
      for (const r of stale) {
        // Re-read the original file when it was kept; otherwise re-parse the stored text.
        let text = r.rawText;
        if (r.sourceData) text = (await rereadSource(r.sourceData, r.sourceFormat).catch(() => null)) || r.rawText;
        const next = await saveResume(buildMasterResume(r.name, text, r.sourceFormat, r.sourceFileName, r));
        if (next.parsed.experience.length !== r.parsed.experience.length) {
          setMessage({ tone: 'success', text: `ApplyFlow re-read “${r.name}” with its improved reader and now finds ${next.parsed.experience.length} jobs (before: ${r.parsed.experience.length}). Tailored documents will be written again.` });
        }
      }
      list = await listResumes();
    }
    setResumes(list);
    setProfile(await getProfile());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
    return onDataChange((t) => (t === 'resumes' || t === 'profile') && void reload());
  }, [reload]);

  const report = (r: MasterResume, verb: string) => {
    const a = assessParse(r.parsed);
    setMessage(
      a.ok && !a.problems.length
        ? { tone: 'success', text: `${verb} “${r.name}”: ${r.parsed.experience.length} roles, ${r.parsed.skills.length} skills, ${r.facts.length} facts.` }
        : a.ok
          ? { tone: 'warning', text: `${verb} “${r.name}”, but some sections need a look.`, details: a.problems }
          : { tone: 'critical', text: 'This resume looks malformed: no work experience was recognized. Check the text and use standard headings like “Experience”.', details: a.problems },
    );
  };

  const addFromText = useCallback(async (name: string, text: string) => {
    if (text.trim().length < 200) {
      setMessage({ tone: 'warning', text: 'That text is too short to be a resume. Paste the full resume.' });
      return null;
    }
    const r = await saveResume(buildMasterResume(name, text, 'text', null));
    report(r, 'Saved');
    await reload();
    return r;
  }, [reload]);

  const addFromFile = useCallback(async (file: File) => {
    setBusy(true);
    setMessage({ tone: 'info', text: `Reading ${file.name}…` });
    try {
      const { text, format, data } = await readResumeFile(file);
      const r = await saveResume(buildMasterResume(file.name.replace(/\.[^.]+$/, ''), text, format, file.name, undefined, data));
      report(r, 'Imported');
      await reload();
      return r;
    } catch (e: unknown) {
      setMessage({ tone: 'critical', text: e instanceof ResumeFileError ? e.message : 'The file could not be read. Paste the resume text instead.' });
      return null;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const updateText = useCallback(async (r: MasterResume, name: string, text: string) => {
    // Edited text no longer matches the original file, so stop re-reading that file.
    const next = await saveResume(buildMasterResume(name, text, r.sourceFormat, r.sourceFileName, r, text === r.rawText ? undefined : null));
    report(next, 'Updated');
    await reload();
    return next;
  }, [reload]);

  const makeDefault = useCallback(async (id: string) => {
    await setDefaultResume(id);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await deleteResume(id);
    setMessage({ tone: 'info', text: 'Resume deleted.' });
    await reload();
  }, [reload]);

  const setFactStatus = useCallback(async (r: MasterResume, factId: string, status: FactStatus) => {
    await saveResume({ ...r, facts: r.facts.map((f) => (f.id === factId ? { ...f, status } : f)) });
    await reload();
  }, [reload]);

  const setAllFacts = useCallback(async (r: MasterResume, kind: VerifiedFact['kind'] | 'all', status: FactStatus) => {
    await saveResume({ ...r, facts: r.facts.map((f) => (kind === 'all' || f.kind === kind ? { ...f, status } : f)) });
    await reload();
  }, [reload]);

  const addFact = useCallback(async (r: MasterResume, kind: VerifiedFact['kind'], text: string) => {
    const t = text.trim();
    if (!t) return;
    await saveResume({ ...r, facts: [...r.facts, { id: newId('fact'), kind, text: t, status: 'confirmed', source: 'user' }] });
    await reload();
  }, [reload]);

  /** Save the resume form (new or existing). The first resume becomes the default. */
  const saveForm = useCallback(async (form: BuilderForm, name: string, existing?: MasterResume, profileNow?: CareerProfile): Promise<MasterResume | null> => {
    const problems = builderProblems(form);
    if (problems.length) {
      setMessage({ tone: 'warning', text: 'A few details are missing before ApplyFlow can use this resume.', details: problems });
      return null;
    }
    const list = await listResumes();
    const r = await saveResume({ ...buildMasterFromForm(form, profileNow ?? profile, name, existing), isDefault: existing?.isDefault ?? list.length === 0 });
    if (!list.length || !list.some((x) => x.isDefault)) await setDefaultResume(r.id);
    setMessage({ tone: 'success', text: `Saved candidate setup: ${r.parsed.experience.length} employers. Claude will write the resume content for each job.` });
    await reload();
    return r;
  }, [profile, reload]);

  const updateProfile = useCallback(async (p: CareerProfile) => {
    setProfile(await saveProfile(p));
    setMessage({ tone: 'success', text: 'Profile saved.' });
  }, []);

  return { resumes, profile, loaded, message, setMessage, busy, reload, addFromText, addFromFile, updateText, saveForm, makeDefault, remove, setFactStatus, setAllFacts, addFact, updateProfile };
}

export type LibraryController = ReturnType<typeof useLibrary>;
