import { z } from 'zod';
import { CdirDocumentSchema, CdirPageSchema, type CdirDocument, type CdirPage } from './schema';

export interface CdirValidationIssue {
  path: string;
  message: string;
}

export interface CdirValidationResult<T> {
  ok: boolean;
  value?: T;
  issues: CdirValidationIssue[];
}

function issuesFromZod(error: z.ZodError): CdirValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

export function validateCdirDocument(input: unknown): CdirValidationResult<CdirDocument> {
  const parsed = CdirDocumentSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, issues: [] };
  return { ok: false, issues: issuesFromZod(parsed.error) };
}

export function parseCdirDocument(input: unknown): CdirDocument {
  return CdirDocumentSchema.parse(input);
}

export function validateCdirPage(input: unknown): CdirValidationResult<CdirPage> {
  const parsed = CdirPageSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data, issues: [] };
  return { ok: false, issues: issuesFromZod(parsed.error) };
}
