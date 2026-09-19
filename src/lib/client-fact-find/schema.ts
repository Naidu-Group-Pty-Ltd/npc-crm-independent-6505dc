import { z } from 'zod';
import { EXPENSE_ROW_COUNT, LIVING_EXPENSE_ITEMS } from './fieldDefinitions';
import { normalizePercentage } from './calculations';
const text=z.string(); const optionalDate=z.union([z.literal(''),z.string().date(),z.null()]);
export const EMPLOYMENT_TYPE_VALUES=['permanent','part_time','casual','contract','self_employed'] as const;
export function normalizeEmploymentType(value:string):typeof EMPLOYMENT_TYPE_VALUES[number]|null{const normalized=value.trim().toLowerCase().replace(/[\s-]+/g,'_');if(['permanent','full_time','fulltime'].includes(normalized))return 'permanent';if(['part_time','parttime'].includes(normalized))return 'part_time';if(['self_employed','selfemployed'].includes(normalized))return 'self_employed';if(['contract','contractor'].includes(normalized))return 'contract';if(normalized==='casual')return 'casual';return null}
const money=z.preprocess(v=>v==null||v===''?0:typeof v==='string'?Number(v.replace(/[$,\s]/g,'')):v,z.number().finite().nonnegative());
const percentage=z.preprocess(v=>normalizePercentage(v as number|string|null|undefined),z.number().finite().min(0).max(100));
const applicant=z.object({applicantNumber:z.union([z.literal(1),z.literal(2)]),title:text,firstName:text,middleName:text,surname:text,dateOfBirth:optionalDate,
 gender:text,maritalStatus:text,residencyStatus:text,numberOfDependants:z.number().int().nonnegative().nullable(),mobile:text,email:z.union([z.literal(''),z.string().email()]),relationship:z.enum(['primary_client','secondary_contact'])}).strict();
const address=z.object({applicantNumber:z.union([z.literal(1),z.literal(2)]),addressType:z.enum(['current','previous']),address:text,livingSituation:text,movedInDate:optionalDate,displayOrder:z.union([z.literal(0),z.literal(1)])}).strict();
const employment=z.object({applicantNumber:z.union([z.literal(1),z.literal(2)]),employmentType:text,employerOrBusiness:text,roleOrPosition:text,employerAddress:text,startDate:optionalDate,
 baseSalary:money,bonus:money,commission:money,overtime:money,otherTaxableIncome:money}).strict();
const asset=z.object({displayOrder:z.number().int().min(0),assetType:text,descriptionOrAddress:text,owner:text,currentValue:money,rentalOrOtherIncome:money,
 financialInstitution:text,loanBalance:money,monthlyRepayment:money,interestRate:percentage,maturityDate:optionalDate}).strict();
const liability=z.object({displayOrder:z.number().int().min(0),liabilityType:text,lender:text,accountOrDescription:text,owner:text,limitOrOriginalAmount:money,
 currentBalance:money,monthlyRepayment:money,interestRate:percentage,remainingTerm:text,notes:text}).strict();
const expense=z.object({expenseKey:z.string(),category:text,itemLabel:text,displayOrder:z.number().int().min(0).max(49),monthlyAmount:money,notes:text}).strict();
const totals=z.object({totalAssetsCents:z.number().int(),totalAssetLinkedDebtCents:z.number().int(),totalOtherLiabilitiesCents:z.number().int(),totalDebtCents:z.number().int(),netPositionCents:z.number().int(),
 applicant1AnnualIncomeCents:z.number().int(),applicant2AnnualIncomeCents:z.number().int(),totalMonthlyLivingExpensesCents:z.number().int(),clientFormOutputLivingExpensesCents:z.number().int()}).strict();
const branding=z.object({organisationName:text,tradingName:text,tagline:text,primaryColour:z.string().regex(/^#[0-9A-Fa-f]{6}$/),accentColour:z.string().regex(/^#[0-9A-Fa-f]{6}$/),website:text,
 email:z.union([z.literal(''),z.string().email()]),phone:text,businessAddress:text,documentTitle:text,confidentialityLabel:text,preparedBy:text,logoReference:text,version:text,sourceWhiteLabelSettingId:z.string().uuid().nullable().optional()}).strict();
const hasApplicantData=(a:z.infer<typeof applicant>)=>Object.entries(a).some(([k,v])=>!['applicantNumber','relationship'].includes(k)&&v!==''&&v!==null&&v!==0);
export const advancedClientCreationSchema=z.object({templateVersion:z.string().min(1),branding,applicants:z.array(applicant).min(1).max(2),addresses:z.array(address).max(4),employment:z.array(employment).min(1).max(2),
 assets:z.array(asset).min(1),liabilities:z.array(liability).min(1),expenses:z.array(expense).length(EXPENSE_ROW_COUNT),calculatedTotals:totals.optional()}).strict().superRefine((v,ctx)=>{
 const primary=v.applicants.find(a=>a.applicantNumber===1); if(!primary?.firstName.trim())ctx.addIssue({code:'custom',path:['applicants',0,'firstName'],message:'Primary first name is required'});
 if(!primary?.surname.trim())ctx.addIssue({code:'custom',path:['applicants',0,'surname'],message:'Primary surname is required'});
 const secondary=v.applicants.find(a=>a.applicantNumber===2); if(secondary&&hasApplicantData(secondary)){if(!secondary.firstName.trim())ctx.addIssue({code:'custom',path:['applicants',1,'firstName'],message:'Applicant 2 first name is required when any Applicant 2 information is supplied'});if(!secondary.surname.trim())ctx.addIssue({code:'custom',path:['applicants',1,'surname'],message:'Applicant 2 surname is required when any Applicant 2 information is supplied'});}
 v.employment.forEach((e,i)=>{const populated=Object.entries(e).some(([key,value])=>key!=='applicantNumber'&&value!==''&&value!==null&&value!==0);if(!populated)return;if(!normalizeEmploymentType(e.employmentType))ctx.addIssue({code:'custom',path:['employment',i,'employmentType'],message:`Employment type "${e.employmentType || '(blank)'}" is not supported. Use Permanent, Full-time, Part-time, Self-employed, Contractor, or Casual.`});if(!e.employerOrBusiness.trim())ctx.addIssue({code:'custom',path:['employment',i,'employerOrBusiness'],message:'Employer / Business is required for an Employment record'});});
 const orders=(rows:{displayOrder?:number}[],path:string)=>{if(new Set(rows.map(r=>r.displayOrder)).size!==rows.length||rows.some((r,i)=>r.displayOrder!==i))ctx.addIssue({code:'custom',path:[path],message:`${path} must contain sequential display positions`});}; orders(v.assets,'assets');orders(v.liabilities,'liabilities');orders(v.expenses,'expenses');
 v.expenses.forEach((e,i)=>{const expected=LIVING_EXPENSE_ITEMS[i];if(e.expenseKey!==expected.key||e.category!==expected.category||e.itemLabel!==expected.itemLabel)ctx.addIssue({code:'custom',path:['expenses',i],message:'Expense key, category and item must match the workbook definition'});});
});
export type ValidatedAdvancedClientCreationPayload=z.infer<typeof advancedClientCreationSchema>;
