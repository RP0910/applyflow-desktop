import { useCallback, useEffect, useState } from 'react';
import type { ApplicationRecord, ApplicationStage } from '@/types';
import { onDataChange } from '@/storage/events';
import { deleteApplication, importApplications, listApplications, saveApplication } from '@/storage/repositories';
import { addNote, duplicateApplication, parseImport, setStage, toCsv, toJson } from '@/services/history/history';
import { showInFolder } from '@/services/downloads/downloader';
import { sanitizeRelativePath } from '@/utils/filename';
import { todayLocal } from '@/utils/dates';
import { bridge } from '@/platform/bridge';

async function saveExport(name: string, content: string, mime: string): Promise<string> {
  const blob = new Blob([content], { type: mime });
  const b = bridge();
  if (b) {
    const path = await b.invoke('files.saveAs', { defaultName: name, bytes: new TextEncoder().encode(content) });
    return path ? `Saved to ${path}` : 'Export cancelled.';
  }
  const url = URL.createObjectURL(blob);
  try {
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      await chrome.downloads.download({ url, filename: sanitizeRelativePath(`ApplyFlow/exports/${name}`), conflictAction: 'uniquify', saveAs: false });
      return `Saved to Downloads/ApplyFlow/exports/${name}`;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    return `Downloaded ${name}`;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function useHistory() {
  const [records, setRecords] = useState<ApplicationRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => setRecords(await listApplications()), []);
  useEffect(() => {
    void reload();
    const off = onDataChange((t) => t === 'applications' && void reload());
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  const persist = useCallback(async (r: ApplicationRecord) => {
    await saveApplication(r);
    await reload();
  }, [reload]);

  const changeStage = useCallback((r: ApplicationRecord, stage: ApplicationStage) => persist(setStage(r, stage)), [persist]);
  const note = useCallback((r: ApplicationRecord, text: string) => persist(addNote(r, text)), [persist]);

  const setFollowUp = useCallback(async (r: ApplicationRecord, date: string | null) => {
    await persist({ ...r, followUpDate: date });
    const b = bridge();
    if (b) {
      if (date) await b.invoke('reminders.set', { applicationId: r.id, whenIso: new Date(`${date}T09:00:00`).toISOString(), label: `Follow up on ${r.title} at ${r.company}` });
      else await b.invoke('reminders.clear', r.id);
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      if (date) await chrome.runtime.sendMessage({ type: 'AF_BG_SET_REMINDER', applicationId: r.id, whenIso: `${date}T09:00:00`, label: `Follow up on ${r.title} at ${r.company}` }).catch(() => undefined);
      else await chrome.runtime.sendMessage({ type: 'AF_BG_CLEAR_REMINDER', applicationId: r.id }).catch(() => undefined);
    }
    setMessage(date ? `Reminder set for ${date}.` : 'Reminder removed.');
  }, [persist]);

  const duplicate = useCallback(async (r: ApplicationRecord) => {
    await persist(duplicateApplication(r));
    setMessage(`Duplicated “${r.title}”. The copy starts at the Saved stage.`);
  }, [persist]);

  const remove = useCallback(async (r: ApplicationRecord) => {
    await deleteApplication(r.id);
    const b = bridge();
    if (b) await b.invoke('reminders.clear', r.id).catch(() => undefined);
    else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) await chrome.runtime.sendMessage({ type: 'AF_BG_CLEAR_REMINDER', applicationId: r.id }).catch(() => undefined);
    await reload();
    setMessage(`Deleted the record for “${r.title}”. Saved files were not touched.`);
  }, [reload]);

  const openJob = useCallback((r: ApplicationRecord) => {
    if (bridge()) window.open(r.jobUrl, '_blank', 'noopener');
    else if (typeof chrome !== 'undefined' && chrome.tabs) void chrome.tabs.create({ url: r.jobUrl });
    else window.open(r.jobUrl, '_blank', 'noopener');
  }, []);

  const openFolder = useCallback(async (r: ApplicationRecord) => {
    const res = await showInFolder(r.files);
    setMessage(res.message);
  }, []);

  const exportCsv = useCallback(async (rs: ApplicationRecord[]) => setMessage(await saveExport(`applyflow-history-${todayLocal()}.csv`, toCsv(rs), 'text/csv;charset=utf-8')), []);
  const exportJson = useCallback(async (rs: ApplicationRecord[]) => setMessage(await saveExport(`applyflow-history-${todayLocal()}.json`, toJson(rs), 'application/json')), []);

  const importJson = useCallback(async (file: File) => {
    try {
      const n = await importApplications(parseImport(await file.text()));
      await reload();
      setMessage(`Imported ${n} application record(s).`);
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'That file could not be imported.');
    }
  }, [reload]);

  return { records, reload, message, setMessage, persist, changeStage, note, setFollowUp, duplicate, remove, openJob, openFolder, exportCsv, exportJson, importJson };
}

export type HistoryController = ReturnType<typeof useHistory>;
