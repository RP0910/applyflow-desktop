import { canonicalSkill, mentionsSkill } from '@/services/skills/extract';
import { SKILL_BY_NAME } from '@/services/skills/taxonomy';
import { hasForm, sameKeyword, synonymsOf, termKey } from './terms';

export function isBacked(term: string, text: string, extraForms: string[] = []): boolean {
  if (!text) return false;
  if (hasForm(text, term) || extraForms.some((f) => hasForm(text, f))) return true;
  if (synonymsOf(term).some((f) => hasForm(text, f))) return true;
  const def = SKILL_BY_NAME.get(canonicalSkill(term).toLowerCase());
  if (!def) return false;
  if (!(sameKeyword(term, def.name) || termKey(term) === termKey(def.name))) return false;
  if (mentionsSkill(text, def.name)) return true;
  return (def.includes ?? []).some((m) => mentionsSkill(text, m));
}
