import { describe, expect, it, vi } from 'vitest';
import { CV_CORE, cvEmploymentRolesBlock, cvSystem, validateCv, type CvReply } from '@/prompts/cvGenerate';
import type { CompanyResearchReply } from '@/prompts/companyResearch';
import { compactFacts, compactFactsForCv } from '@/prompts/application';
import { assembleCv, reusedMasterLines } from '@/services/workflow/cvEngine';
import { roleTitlesForCv } from '@/services/workflow/cvRoleTitles';
import { buildMasterFromForm, emptyBuilder, builderProblems } from '@/services/resume/builder';
import { runAnalysis, runDocuments, revalidateEdited } from '@/services/workflow/engine';
import { toResumeDocument, fromResumeDocument, renderResumePdf } from '@/resume-renderer';
import { uploadFileName } from '@/services/export/bundle';
import { DEFAULT_SETTINGS } from '@/types';
import { EMPTY_PROFILE } from '@/storage/repositories';
import { ClaudeProvider } from '@/services/claude/provider';
import { emptySession, mockJob } from '../helpers';

const form = emptyBuilder();
form.jobs[0] = {...form.jobs[0]!,company:'Example Systems',start:'2020-01',current:true};
const profile = {...EMPTY_PROFILE,fullName:'Test Candidate',email:'candidate@example.com',phone:'555-0100'};
const master = buildMasterFromForm(form, profile, 'Candidate');
const session = emptySession(mockJob(),master.id);
const reply: CvReply = {company_name:'Hiring Co',role_title:'Software Engineer',subtitle:'Software Engineer | TypeScript',summary:'Software engineer building TypeScript services.',cover_letter:'Dear Hiring Team,\n\nI build TypeScript services.\n\nSincerely,\nTest Candidate',skill_groups:[{category:'Languages',items:['TypeScript']}],additional_categories:[],experience:[{company:'Example Systems',role_title:'Software Engineer',location:'Wrong City',dates:'1999 - 2000',role_description:'Built reliable customer platforms.',bullets:['Developed TypeScript API services with automated regression tests.']}]};
const researchCompany={periodIndex:0,name:'Example Systems',activeYears:'2020-Present',techFit:'TypeScript platforms',hq:'',roleTitle:''};
const cvReply=()=>{
  const role_title=roleTitlesForCv(session.job.title,1,{companies:[researchCompany]})[0]!;
  return {...reply,role_title,experience:[{...reply.experience[0]!,role_title}]};
};

describe('CV Generate 2.1 pipeline',()=>{
 it('accepts employer/date-only input without prewritten bullets or title',()=>expect(builderProblems(form)).toEqual([]));
 it('uses one complete supplied prompt and explicit candidate overrides',()=>{
   expect(CV_CORE.match(/<output_schema>/g)?.length).toBeGreaterThan(0);
   expect(CV_CORE.match(/^<goal>$/gm)).toHaveLength(1);
   const system=cvSystem(compactFactsForCv(master,profile));
   expect(system[0]!.text).toContain('<final_check>');
   expect(system[1]!.text).toContain('Employer names, role_title values, and job locations in CANDIDATE.jobs are final');
   expect(system[1]!.text).toContain('Do not reuse or lightly paraphrase');
   expect(system[1]!.text).not.toContain(profile.email);
 });
 it('puts finalized role_title in the CV prompt before generation',()=>{
   const draft=buildMasterFromForm({...form,jobs:[{...form.jobs[0]!,title:'Staff Platform Engineer',company:'Progyny, Inc.'}]},profile,'Candidate');
   const facts=compactFactsForCv(draft,profile,{companies:[{periodIndex:0,name:'Progyny, Inc.',activeYears:'2020-Present',techFit:'Fertility benefits platform',hq:'New York, NY',roleTitle:'Staff Platform Engineer'}]});
   expect(cvEmploymentRolesBlock(facts)).toContain('role_title: "Staff Platform Engineer"');
   expect(JSON.parse(facts.text).jobs[0].role_title).toBe('Staff Platform Engineer');
   expect(cvSystem(facts)[1]!.text).toContain('FIXED EMPLOYMENT ROLES');
 });
 it('omits master bullets from CV candidate facts and passes company research context',()=>{
   const rich=buildMasterFromForm({...form,jobs:[{...form.jobs[0]!,company:'Example Systems',did:'Legacy streaming bullet about OTT.',title:'Senior Streaming Engineer'}]},profile,'Candidate');
   const cvFacts=compactFactsForCv(rich,profile,{companies:[{periodIndex:0,name:'HashiCorp',activeYears:'2020-Present',techFit:'Infrastructure automation',hq:'San Francisco, CA',roleTitle:'Senior Platform Engineer'}]});
   const payload=JSON.parse(cvFacts.text);
   expect(payload.jobs[0].company).toBe('Example Systems');
   expect(payload.jobs[0].facts).toBeUndefined();
   expect(payload.jobs[0].companyContext).toBe('Infrastructure automation');
   expect(compactFacts(rich,profile).text).toContain('Legacy streaming');
 });
 it('counts draft lines that repeat master bullets and uses the supplied CV role title in the resume',()=>{
   const rich=buildMasterFromForm({...form,jobs:[{...form.jobs[0]!,did:'Built OTT delivery pipelines.',title:'Senior Streaming Engineer'}]},profile,'Candidate');
   const draft=buildMasterFromForm({...form,jobs:[{...form.jobs[0]!,title:'Software Engineer',company:'Example Systems'}]},profile,'Candidate');
   const copied={...reply,experience:[{...reply.experience[0]!,role_title:'Software Engineer',bullets:['Built OTT  delivery pipelines.','Developed TypeScript API services.']}]};
   expect(reusedMasterLines(copied,rich,profile)).toBe(1);
   expect(reusedMasterLines(reply,rich,profile)).toBe(0);
   expect(assembleCv(copied,draft,profile,session,'test').experience[0]!.title).toBe('Software Engineer');
 });
 it('preserves employer dates and identity while accepting generated work content',()=>{
   const r=assembleCv(reply,master,profile,session,'test-model');
   expect(r.experience[0]).toMatchObject({company:'Example Systems',startDate:'01/2020',endDate:'Present',location:'',title:'Software Engineer'});
   expect(r.experience[0]!.bullets).toContain(reply.experience[0]!.bullets[0]);
   expect(r.contact.email).toBe(profile.email);
   expect(r.contentSource).toBe('cv-generate');
 });
 it('rejects changed employers and malformed/incomplete JSON',()=>{
   expect(()=>assembleCv({...reply,experience:[{...reply.experience[0]!,company:'Invented Employer'}]},master,profile,session,'test')).toThrow(/employer/);
   expect(()=>validateCv({...reply,experience:[]},1)).toThrow(/number/);
   expect(()=>validateCv({...reply,skill_groups:[{category:'x',items:[42]}]},1)).toThrow(/skill_groups/);
 });
 it('passes generated JSON through the same PDF renderer used by PDF Studio',async()=>{
   const r=assembleCv(reply,master,profile,session,'test');
   const doc=toResumeDocument(r,{text:reply.cover_letter});
   expect(fromResumeDocument(doc).sourceJson).toBe(JSON.stringify(reply));
   const bytes=await renderResumePdf(doc);
   expect(new TextDecoder().decode(bytes.slice(0,5))).toBe('%PDF-');
   expect(bytes.length).toBeGreaterThan(1000);
 });
 it('uses unique filenames per job and edited generation',()=>{
   const r=assembleCv(reply,master,profile,session,'test');
   const a=uploadFileName({...session,resume:r},'resume','pdf');
   const b=uploadFileName({...session,job:{...session.job,company:'Different Co'},resume:r},'resume','pdf');
   const edited=revalidateEdited(r,session,master,profile,'two_pages');
   expect(a).not.toBe(b);
   expect(a).not.toBe(uploadFileName({...session,resume:edited},'resume','pdf'));
   expect(edited.experience[0]!.bullets).toEqual(r.experience[0]!.bullets);
 });
 it('requires Claude instead of silently returning the employer-only input',async()=>{
   const d={settings:DEFAULT_SETTINGS,apiKey:null};
   const a=await runAnalysis(session.job,false,master,profile,d);
   await expect(runDocuments({...session,analysis:a.analysis},master,profile,d,'professional')).rejects.toThrow(/Claude API key/);
 });
 it('runs company research then CV generate as two separate calls',async()=>{
   const order:string[]=[];
   const saved=new Map<string,CompanyResearchReply>();
   const researchCompanies=vi.fn().mockImplementation(async()=>{order.push('research');return{data:{companies:[{periodIndex:0,name:'HashiCorp',activeYears:'2020-Present',techFit:'TypeScript platforms',hq:'',roleTitle:''}]},model:'test'};});
   const hashicorpTitle=roleTitlesForCv(session.job.title,1,{companies:[{periodIndex:0,name:'HashiCorp',activeYears:'2020-Present',techFit:'TypeScript platforms',hq:'',roleTitle:''}]})[0]!;
   const tailoredReply={...reply,role_title:hashicorpTitle,experience:[{...reply.experience[0]!,company:'HashiCorp',role_title:hashicorpTitle}]};
   const generateCv=vi.fn().mockImplementation(async()=>{order.push('cv');return{data:tailoredReply,model:'test'};});
   const suggestRoleTitles=vi.fn().mockImplementation(async()=>{order.push('titles');return{data:{roles:[{periodIndex:0,role_title:hashicorpTitle}]},model:'test'};});
   const phases:string[]=[];
   const d={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies,suggestRoleTitles} as unknown as ClaudeProvider),saveCompanyResearch:async(k:string,v:CompanyResearchReply)=>{saved.set(k,v);},loadCompanyResearch:async(k:string)=>saved.get(k)??null};
   const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
   const result=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional',(p)=>phases.push(p));
   expect(researchCompanies).toHaveBeenCalledTimes(1);
   expect(generateCv.mock.calls.length).toBeGreaterThanOrEqual(1);
   expect(generateCv.mock.calls.length).toBeLessThanOrEqual(2);
   expect(order[0]).toBe('research');
   expect(order[1]).toBe('titles');
   expect(order.slice(2).every((x)=>x==='cv')).toBe(true);
   expect(suggestRoleTitles).toHaveBeenCalledTimes(1);
   expect(phases.indexOf('researching_companies')).toBeGreaterThanOrEqual(0);
   expect(phases.indexOf('generating_resume')).toBeGreaterThan(phases.indexOf('researching_companies'));
   expect(generateCv.mock.calls[0]!).toHaveLength(3);
   const sent=JSON.parse(generateCv.mock.calls[0]![0].text);
   expect(sent.jobs[0].company).toBe('HashiCorp');
   expect(sent.jobs[0].facts).toBeUndefined();
   expect(saved.has(session.jobKey)).toBe(true);
   expect(result.resume.experience[0]!.company).toBe('HashiCorp');
   expect(result.resume.experience[0]!.bullets).toContain(reply.experience[0]!.bullets[0]);
   expect(result.coverLetter!.text).toBe(reply.cover_letter);
   expect(result.companyResearch?.companies[0]?.name).toBe('HashiCorp');
   expect(result.notices.join(' ')).toMatch(/Company research completed|Target not reached/);
 });
 it('does not start CV generate when company research fails or returns no companies',async()=>{
   const generateCv=vi.fn();
   const failResearch=vi.fn().mockRejectedValue(new Error('research API down'));
   const emptyResearch=vi.fn().mockResolvedValue({data:{companies:[]},model:'test'});
   const dFail={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies:failResearch} as unknown as ClaudeProvider)};
   const dEmpty={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies:emptyResearch} as unknown as ClaudeProvider)};
   const a=await runAnalysis(session.job,false,master,profile,{...dFail,settings:{...dFail.settings,deepAnalysisWithClaude:false}});
   const s={...session,analysis:a.analysis};
   await expect(runDocuments(s,master,profile,dFail,'professional')).rejects.toThrow(/Company research did not complete/);
   await expect(runDocuments(s,master,profile,dEmpty,'professional')).rejects.toThrow(/no companies/);
   expect(generateCv).not.toHaveBeenCalled();
 });
 describe('speed: no repeated Claude.ai work',()=>{
   const company=researchCompany;
   const setup=(generateCv:ReturnType<typeof vi.fn>,saved=new Map<string,CompanyResearchReply>())=>{
     const researchCompanies=vi.fn().mockResolvedValue({data:{companies:[company]},model:'test'});
     const rt=roleTitlesForCv(session.job.title,1,{companies:[company]})[0]!;
     const suggestRoleTitles=vi.fn().mockResolvedValue({data:{roles:[{periodIndex:0,role_title:rt}]},model:'test'});
     const d={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies,suggestRoleTitles} as unknown as ClaudeProvider),saveCompanyResearch:async(k:string,v:CompanyResearchReply)=>{saved.set(k,v);},loadCompanyResearch:async(k:string)=>saved.get(k)??null};
     return {d,researchCompanies,suggestRoleTitles,saved};
   };
   it('Tailor writes the resume once (no automatic second pass) and says where the time went',async()=>{
     const generateCv=vi.fn().mockResolvedValue({data:cvReply(),model:'test'});
     const {d,researchCompanies}=setup(generateCv);
     const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
     const r=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional');
     expect(researchCompanies).toHaveBeenCalledTimes(1);
     expect(generateCv).toHaveBeenCalledTimes(1);
     expect(r.notices.join(' ')).toMatch(/Claude\.ai time: research \d+:\d\d · titles \d+:\d\d · resume \d+:\d\d\./);
     expect(r.notices.join(' ')).toMatch(/Optimize with Claude/);
   });
   it('a second run for the same job reuses the saved company research',async()=>{
     const generateCv=vi.fn().mockResolvedValue({data:cvReply(),model:'test'});
     const saved=new Map<string,CompanyResearchReply>([[session.jobKey,{companies:[company]}]]);
     const {d,researchCompanies}=setup(generateCv,saved);
     const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
     const r=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional');
     expect(researchCompanies).not.toHaveBeenCalled();
     expect(generateCv).toHaveBeenCalledTimes(1);
     expect(r.notices.join(' ')).toMatch(/Company research reused from this job: 1\. Example Systems/);
   });
   it('Optimize sends one measured revision of the current draft and keeps it only when scores do not drop',async()=>{
     const generateCv=vi.fn().mockResolvedValue({data:cvReply(),model:'test'});
     const saved=new Map<string,CompanyResearchReply>([[session.jobKey,{companies:[company]}]]);
     const {d,researchCompanies}=setup(generateCv,saved);
     const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
     const first=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional');
     generateCv.mockClear();
     const rt=roleTitlesForCv(session.job.title,1,{companies:[company]})[0]!;
     const weaker={...reply,role_title:rt,summary:'Engineer.',skill_groups:[{category:'Other',items:['Typing']}],experience:[{...reply.experience[0]!,role_title:rt,bullets:['Did work.']}]};
     generateCv.mockResolvedValueOnce({data:weaker,model:'test'});
     const s={...session,analysis:a.analysis,resume:first.resume,coverLetter:first.coverLetter,includeCoverLetter:true};
     const r=await runDocuments(s,master,profile,d,'professional',undefined,{optimize:true});
     expect(researchCompanies).not.toHaveBeenCalled();
     expect(generateCv).toHaveBeenCalledTimes(1);
     expect(JSON.parse(generateCv.mock.calls[0]![3]).target).toBe('>95');
     expect(r.resume).toBe(first.resume);
     expect(r.coverLetter).toBe(first.coverLetter);
     expect(r.notices.join(' ')).toMatch(/scored lower .* current draft was kept/);
     expect(r.notices.join(' ')).toMatch(/Claude\.ai time: optimization \d+:\d\d\./);
   });
 });
 it('retains a complete draft after a refine failure once research succeeded',async()=>{
   const researchCompanies=vi.fn().mockResolvedValue({data:{companies:[researchCompany]},model:'test'});
   const suggestRoleTitles=vi.fn().mockResolvedValue({data:{roles:[{periodIndex:0,role_title:roleTitlesForCv(session.job.title,1,{companies:[researchCompany]})[0]!}]},model:'test'});
   const generateCv=vi.fn().mockResolvedValueOnce({data:cvReply(),model:'test'}).mockRejectedValueOnce(new Error('refine failed'));
   const d={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies,suggestRoleTitles} as unknown as ClaudeProvider)};
   const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
   const r=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional');
   expect(r.resume.summary).toBe(reply.summary);
   expect(r.resume.experience[0]!.company).toBe('Example Systems');
   expect(r.notices.join(' ')).toMatch(/optimization pass failed|Company research completed/);
 });
});
