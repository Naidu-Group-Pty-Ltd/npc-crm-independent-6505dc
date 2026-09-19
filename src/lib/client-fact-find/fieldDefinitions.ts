export type WorkbookFieldType = 'text' | 'email' | 'phone' | 'date' | 'integer' | 'money' | 'percentage';
export interface WorkbookFieldDefinition<K extends string = string> { key: K; label: string; displayOrder: number; type: WorkbookFieldType; cell: string; }
const fields = <T extends readonly WorkbookFieldDefinition[]>(value: T) => value;
export const APPLICANT_FIELDS = fields([
  {key:'title',label:'Title',displayOrder:0,type:'text',cell:'C6'}, {key:'firstName',label:'First Name',displayOrder:1,type:'text',cell:'C7'},
  {key:'middleName',label:'Middle Name',displayOrder:2,type:'text',cell:'C8'}, {key:'surname',label:'Surname',displayOrder:3,type:'text',cell:'C9'},
  {key:'dateOfBirth',label:'Date of Birth',displayOrder:4,type:'date',cell:'C10'}, {key:'gender',label:'Gender',displayOrder:5,type:'text',cell:'C11'},
  {key:'maritalStatus',label:'Marital Status',displayOrder:6,type:'text',cell:'C12'}, {key:'residencyStatus',label:'Residency Status',displayOrder:7,type:'text',cell:'C13'},
  {key:'numberOfDependants',label:'Number of Dependants',displayOrder:8,type:'integer',cell:'C14'}, {key:'mobile',label:'Mobile',displayOrder:9,type:'phone',cell:'C15'},
  {key:'email',label:'Email',displayOrder:10,type:'email',cell:'C16'},
] as const);
export const ADDRESS_FIELDS = fields([
  {key:'currentAddress',label:'Current Address',displayOrder:0,type:'text',cell:'C19'}, {key:'currentLivingSituation',label:'Living Situation',displayOrder:1,type:'text',cell:'C20'},
  {key:'currentMovedInDate',label:'Date Moved In',displayOrder:2,type:'date',cell:'C21'}, {key:'previousAddress',label:'Previous Address',displayOrder:3,type:'text',cell:'C22'},
  {key:'previousLivingSituation',label:'Previous Living Situation',displayOrder:4,type:'text',cell:'C23'}, {key:'previousMovedInDate',label:'Previous Date Moved In',displayOrder:5,type:'date',cell:'C24'},
] as const);
export const EMPLOYMENT_FIELDS = fields([
  {key:'employmentType',label:'Employment Type',displayOrder:0,type:'text',cell:'C27'}, {key:'employerOrBusiness',label:'Employer / Business',displayOrder:1,type:'text',cell:'C28'},
  {key:'roleOrPosition',label:'Role / Position',displayOrder:2,type:'text',cell:'C29'}, {key:'employerAddress',label:'Employer Address',displayOrder:3,type:'text',cell:'C30'},
  {key:'startDate',label:'Start Date',displayOrder:4,type:'date',cell:'C31'}, {key:'baseSalary',label:'Base Salary (Annual)',displayOrder:5,type:'money',cell:'C32'},
  {key:'bonus',label:'Bonus',displayOrder:6,type:'money',cell:'C33'}, {key:'commission',label:'Commission',displayOrder:7,type:'money',cell:'C34'},
  {key:'overtime',label:'Overtime',displayOrder:8,type:'money',cell:'C35'}, {key:'otherTaxableIncome',label:'Other Taxable Income',displayOrder:9,type:'money',cell:'C36'},
] as const);
export const ASSET_COLUMNS = fields([
  {key:'assetType',label:'Asset Type',displayOrder:0,type:'text',cell:'A39'}, {key:'descriptionOrAddress',label:'Description / Address',displayOrder:1,type:'text',cell:'B39'},
  {key:'owner',label:'Owner',displayOrder:2,type:'text',cell:'C39'}, {key:'currentValue',label:'Current Value',displayOrder:3,type:'money',cell:'D39'},
  {key:'rentalOrOtherIncome',label:'Rental / Other Income',displayOrder:4,type:'money',cell:'E39'}, {key:'financialInstitution',label:'Financial Institution',displayOrder:5,type:'text',cell:'F39'},
  {key:'loanBalance',label:'Loan Balance',displayOrder:6,type:'money',cell:'G39'}, {key:'monthlyRepayment',label:'Monthly Repayment',displayOrder:7,type:'money',cell:'H39'},
  {key:'interestRate',label:'Interest Rate',displayOrder:8,type:'percentage',cell:'I39'}, {key:'maturityDate',label:'Maturity Date',displayOrder:9,type:'date',cell:'J39'},
] as const);
export const LIABILITY_COLUMNS = fields([
  {key:'liabilityType',label:'Liability Type',displayOrder:0,type:'text',cell:'A52'}, {key:'lender',label:'Lender',displayOrder:1,type:'text',cell:'B52'},
  {key:'accountOrDescription',label:'Account / Description',displayOrder:2,type:'text',cell:'C52'}, {key:'owner',label:'Owner',displayOrder:3,type:'text',cell:'D52'},
  {key:'limitOrOriginalAmount',label:'Limit / Original Amount',displayOrder:4,type:'money',cell:'E52'}, {key:'currentBalance',label:'Current Balance',displayOrder:5,type:'money',cell:'F52'},
  {key:'monthlyRepayment',label:'Monthly Repayment',displayOrder:6,type:'money',cell:'G52'}, {key:'interestRate',label:'Interest Rate',displayOrder:7,type:'percentage',cell:'H52'},
  {key:'remainingTerm',label:'Remaining Term',displayOrder:8,type:'text',cell:'I52'}, {key:'notes',label:'Notes',displayOrder:9,type:'text',cell:'J52'},
] as const);
const EXPENSE_ROWS = [
['childcare','Childcare & Support','Childcare'],['child_maintenance','Childcare & Support','Child Maintenance'],['public_school_costs','Education','Public School Costs'],['private_school_costs','Education','Private School Costs'],['higher_education_vocational_training','Education','Higher Education / Vocational Training'],['groceries','Groceries','Groceries'],
['electricity_gas','Primary Residence','Electricity & Gas'],['council_rates','Primary Residence','Council Rates'],['water_sewer','Primary Residence','Water & Sewer'],['body_corporate','Primary Residence','Body Corporate'],['home_repairs','Primary Residence','Home Repairs'],['furnishings_electrical','Primary Residence','Furnishings & Electrical'],
['building_insurance','Insurance','Building Insurance'],['contents_insurance','Insurance','Contents Insurance'],['health_insurance','Insurance','Health Insurance'],['income_protection','Insurance','Income Protection'],['life_insurance','Insurance','Life Insurance'],['vehicle_insurance','Insurance','Vehicle Insurance'],
['investment_rates_utilities_body_corporate','Investment Property','Rates, Utilities & Body Corporate'],['investment_repairs_maintenance','Investment Property','Repairs & Maintenance'],['investment_insurance','Investment Property','Insurance'],['secondary_rates_utilities_body_corporate','Secondary Residence','Rates, Utilities & Body Corporate'],['secondary_repairs_maintenance','Secondary Residence','Repairs & Maintenance'],['secondary_insurance','Secondary Residence','Insurance'],
['medical_health','Medical','Medical & Health'],['natural_therapies','Medical','Natural Therapies'],['rent','Housing','Rent'],['board','Housing','Board'],['clothing_footwear','Personal Care','Clothing & Footwear'],['cosmetics_haircare','Personal Care','Cosmetics / Haircare'],['dry_cleaning','Personal Care','Dry Cleaning'],
['pets','Recreation','Pets'],['alcohol_tobacco','Recreation','Alcohol / Tobacco'],['cinema_concerts_memberships','Recreation','Cinema / Concerts / Memberships'],['dining_out','Recreation','Dining Out'],['gym_sports','Recreation','Gym / Sports'],['travel_holidays','Recreation','Travel & Holidays'],['gifts_miscellaneous','Recreation','Gifts & Miscellaneous'],['gambling','Recreation','Gambling'],
['home_mobile_phone','Communications','Home / Mobile Phone'],['internet_pay_tv_streaming','Communications','Internet / Pay TV / Streaming'],['petrol','Transport','Petrol'],['registration','Transport','Registration'],['vehicle_maintenance','Transport','Vehicle Maintenance'],['public_transport','Transport','Public Transport'],['taxi_ride_sharing','Transport','Taxi / Ride Sharing'],['tolls_parking','Transport','Tolls / Parking'],['regular_donations','Other','Regular Donations'],['voluntary_superannuation','Other','Voluntary Superannuation'],['other_regular_expense','Other','Other Regular Expense'],
] as const;
export const LIVING_EXPENSE_ITEMS = EXPENSE_ROWS.map(([key,category,itemLabel],displayOrder)=>({key,category,itemLabel,displayOrder,type:'money' as const,amountCell:`C${displayOrder+5}`,notesCell:`D${displayOrder+5}`}));
export const ASSET_ROW_COUNT=10 as const; export const LIABILITY_ROW_COUNT=8 as const; export const EXPENSE_ROW_COUNT=50 as const;
export const LIVING_SITUATION_OPTIONS=['Owned','Mortgaged','Renting','Boarding','Living with parents','Other'] as const;
export const TITLE_OPTIONS=['Mr','Mrs','Ms','Miss','Dr','Other'] as const;
