/**
 * One rule, used by both the ATS plan and the truthfulness validator, for "does this text back
 * this term?" — so the plan never places a keyword where the validator would then revert it.
 *
 *   - the same words (plural allowed, hyphen/space variants), or a true synonym (K8s = Kubernetes);
 *   - for a category term, one of its members ("Observability" ← Prometheus, "Connected TV" ← Roku);
 *   - never a broader term for a narrower one ("Roku" doesn't back "Roku SceneGraph").
 */
import { canonicalSkill, mentionsSkill } from '@/services/skills/extract';
import { SKILL_BY_NAME } from '@/services/skills/taxonomy';
import { hasForm, sameKeyword, synonymsOf, termKey } from './terms';

export function isBacked(term: string, text: string, extraForms: string[] = []): boolean {
  if (!text) return false;
  if (hasForm(text, term) || extraForms.some((f) => hasForm(text, f))) return true;
  if (synonymsOf(term).some((f) => hasForm(text, f))) return true;
  const def = SKILL_BY_NAME.get(canonicalSkill(term).toLowerCase());
  if (!def) return false;
  // Only when the term IS the taxonomy skill (or its synonym) — not one of its members.
  if (!(sameKeyword(term, def.name) || termKey(term) === termKey(def.name))) return false;
  if (mentionsSkill(text, def.name)) return true;
  return (def.includes ?? []).some((m) => mentionsSkill(text, m));
}
