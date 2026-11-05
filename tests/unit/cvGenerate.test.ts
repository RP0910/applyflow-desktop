import { describe, expect, it, vi } from 'vitest';
import { CV_CORE, cvSystem, validateCv, type CvReply } from '@/prompts/cvGenerate';
import type { CompanyResearchReply } from '@/prompts/companyResearch';
import { compactFacts } from '@/prompts/application';
import { assembleCv } from '@/services/workflow/cvEngine';
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

describe('CV Generate 2.1 pipeline',()=>{
 it('accepts employer/date-only input without prewritten bullets or title',()=>expect(builderProblems(form)).toEqual([]));
 it('uses one complete supplied prompt and explicit candidate overrides',()=>{
   expect(CV_CORE.match(/<output_schema>/g)?.length).toBeGreaterThan(0);
   expect(CV_CORE.match(/^<goal>$/gm)).toHaveLength(1);
   const system=cvSystem(compactFacts(master,profile));
   expect(system[0]!.text).toContain('<final_check>');
   expect(system[1]!.text).toContain('Employer names and job locations in CANDIDATE.jobs are final');
   expect(system[1]!.text).not.toContain(profile.email);
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
   const researchCompanies=vi.fn().mockImplementation(async()=>{order.push('research');return{data:{companies:[{periodIndex:0,name:'HashiCorp',activeYears:'2020-Present',techFit:'TypeScript platforms',hq:''}]},model:'test'};});
   const tailoredReply={...reply,experience:[{...reply.experience[0]!,company:'HashiCorp'}]};
   const generateCv=vi.fn().mockImplementation(async()=>{order.push('cv');return{data:tailoredReply,model:'test'};});
   const phases:string[]=[];
   const d={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies} as unknown as ClaudeProvider),saveCompanyResearch:async(k:string,v:CompanyResearchReply)=>{saved.set(k,v);},loadCompanyResearch:async(k:string)=>saved.get(k)??null};
   const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
   const result=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional',(p)=>phases.push(p));
   expect(researchCompanies).toHaveBeenCalledTimes(1);
   expect(generateCv.mock.calls.length).toBeGreaterThanOrEqual(1);
   expect(generateCv.mock.calls.length).toBeLessThanOrEqual(2);
   expect(order[0]).toBe('research');
   expect(order.slice(1).every((x)=>x==='cv')).toBe(true);
   expect(phases.indexOf('researching_companies')).toBeGreaterThanOrEqual(0);
   expect(phases.indexOf('generating_resume')).toBeGreaterThan(phases.indexOf('researching_companies'));
   expect(generateCv.mock.calls[0]!).toHaveLength(3);
   expect(JSON.parse(generateCv.mock.calls[0]![0].text).jobs[0].company).toBe('HashiCorp');
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
   await expect(runDocuments(s,master,profile,dFail,'professional')).rejects.toThrow(/Company research must finish/);
   await expect(runDocuments(s,master,profile,dEmpty,'professional')).rejects.toThrow(/no companies/);
   expect(generateCv).not.toHaveBeenCalled();
 });
 it('retains a complete draft after a refine failure once research succeeded',async()=>{
   const researchCompanies=vi.fn().mockResolvedValue({data:{companies:[{periodIndex:0,name:'Example Systems',activeYears:'2020-Present',techFit:'TypeScript platforms',hq:''}]},model:'test'});
   const generateCv=vi.fn().mockResolvedValueOnce({data:reply,model:'test'}).mockRejectedValueOnce(new Error('refine failed'));
   const d={settings:{...DEFAULT_SETTINGS,engine:'claude' as const},apiKey:'test',providerFactory:()=>({generateCv,researchCompanies} as unknown as ClaudeProvider)};
   const a=await runAnalysis(session.job,false,master,profile,{...d,settings:{...d.settings,deepAnalysisWithClaude:false}});
   const r=await runDocuments({...session,analysis:a.analysis},master,profile,d,'professional');
   expect(r.resume.summary).toBe(reply.summary);
   expect(r.resume.experience[0]!.company).toBe('Example Systems');
   expect(r.notices.join(' ')).toMatch(/optimization pass failed|Company research completed/);
 });
});
