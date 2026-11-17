import type { ApprovedAnswer } from '@/types';
import type { QuestionType } from './types';

const YES_NO = /^(yes|no|y|n|prefer not to say)$/i;

export function questionTypeOf(a: Pick<ApprovedAnswer, 'category' | 'control' | 'answer' | 'options' | 'questionPattern'>): QuestionType {
  if (a.category === 'salary') return 'salary';
  if (a.category === 'work_authorization' || a.category === 'sponsorship') return 'availability_authorization';
  if (a.category === 'years_experience') return 'experience';
  const question = a.questionPattern;
  const answer = a.answer.trim();
  if (/describe|explain|tell us about|walk us through/i.test(question)) {
    return answer.length > 280 ? 'long_form' : 'technical';
  }
  if (a.control === 'textarea' || answer.length > 280) return 'long_form';
  if (a.control === 'select' || a.control === 'combobox') return 'dropdown';
  const opts = (a.options ?? []).map((o) => o.trim().toLowerCase());
  const yesNoOptions = opts.length > 0 && opts.every((o) => YES_NO.test(o));
  if (a.control === 'radio' && (yesNoOptions || (opts.length === 0 && YES_NO.test(answer)))) return 'yes_no';
  if (a.control === 'radio' || a.control === 'checkbox') return 'multiple_choice';
  if (/^-?\d+(\.\d+)?$/.test(answer.replace(/,/g, ''))) return 'numeric';
  return 'short_text';
}
