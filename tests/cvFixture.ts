import type { CvReply } from '@/prompts/cvGenerate';
import { exampleResume } from './helpers';
export function cvFixture(): CvReply {
 const p=exampleResume().parsed;
 return {company_name:'Meridian Credit Analytics LLC',role_title:p.headline,subtitle:p.headline,summary:p.summary,cover_letter:'Dear Hiring Team,\n\nI am applying for the engineering role. My experience includes building reliable production systems and working across teams.\n\nSincerely,\nJordan Rivera',skill_groups:[{category:'Technical skills',items:p.skills}],additional_categories:[],experience:p.experience.map(e=>({company:e.company,role_title:e.title,location:e.location,dates:`${e.startDate} - ${e.endDate}`,role_description:'',bullets:e.bullets}))};
}
