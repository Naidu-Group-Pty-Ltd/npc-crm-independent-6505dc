export const INCOME_KEYS=['baseSalary','bonus','commission','overtime','otherTaxableIncome'] as const;
export const incomeNames=(index:0|1)=>INCOME_KEYS.map(key=>`employment.${index}.${key}` as const);
