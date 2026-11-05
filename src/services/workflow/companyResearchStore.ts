import type { CompanyResearchReply } from '@/prompts/companyResearch';
import { bridge } from '@/platform/bridge';
import type { EngineDeps } from './engine';

export async function persistCompanyResearch(deps: EngineDeps, jobKey: string, research: CompanyResearchReply): Promise<void> {
  if (deps.saveCompanyResearch) {
    await deps.saveCompanyResearch(jobKey, research);
    return;
  }
  const b = bridge();
  if (b) await b.invoke('companyResearch.save', { jobKey, research });
}

export async function loadCompanyResearch(deps: EngineDeps, jobKey: string): Promise<CompanyResearchReply | null> {
  if (deps.loadCompanyResearch) return deps.loadCompanyResearch(jobKey);
  const b = bridge();
  if (!b) return null;
  return (await b.invoke('companyResearch.get', jobKey)) ?? null;
}
