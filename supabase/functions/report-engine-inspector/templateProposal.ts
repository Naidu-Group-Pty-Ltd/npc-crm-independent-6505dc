export function buildNewTemplateRow(
  afterValue: Record<string, unknown> | null | undefined,
  userId: string,
  proposalId: string,
) {
  const generatedFileName = `${proposalId}.md`;

  return {
    ...(afterValue || {}),
    // Agent-created templates are backed by parsed_content rather than an uploaded
    // source file, but these legacy columns are still required by the table.
    file_path: afterValue?.file_path ?? `agent-generated/${generatedFileName}`,
    file_name: afterValue?.file_name ?? generatedFileName,
    is_active: afterValue?.is_active ?? true,
    created_by: userId,
  };
}
