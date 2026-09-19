/**
 * What choosing files does to a staging tray.
 *
 * ## The defect this exists for
 *
 * The client Files tab said "Drag & drop or click to upload multiple files",
 * "up to 10 files" and "Files upload together for faster batches" — and its
 * drop handler was `setSelectedFiles(nextFiles)`. So choosing files one at a
 * time, which is what a person does when the documents are in different
 * folders, discarded everything already staged: pick `1554.pdf`, pick
 * `54.pdf`, and `1554.pdf` is gone with nothing said about it. The tray
 * offered a delete button per row, which is the shape of something that
 * accumulates, so the loss reads as the product forgetting rather than as a
 * rule anybody chose.
 *
 * The finance portal's document vault had already grown an accumulating
 * version of this by hand, with three faults of its own: nothing
 * de-duplicated (choosing the same file twice staged it twice, two rows, two
 * delete buttons), the caps were enforced by `slice`, which drops the excess
 * without saying so, and it raised its notices from inside a `setState`
 * updater, which React is free to run more than once.
 *
 * So the decision lives here, once, and both trays ask it.
 *
 * ## The rules
 *
 * 1. **A pick adds. It never replaces.** That is the reported defect.
 * 2. **A rejected addition leaves the tray exactly as it was.** Losing what is
 *    already staged is a worse outcome than refusing the new file, and it is
 *    the one the operator cannot undo by trying again.
 * 3. **The same file is not staged twice** — name, size and modified time,
 *    which is as much as a browser will tell us about identity.
 * 4. **Anything excluded is NAMED.** Both caps were enforced with `slice`,
 *    which is why neither had ever been seen: the eleventh file simply was
 *    not there.
 * 5. **A cap excludes files, not the pick.** Choosing three when only two fit
 *    stages the two — refusing all three because one did not fit makes the
 *    operator do arithmetic the tray has already done.
 */

/** Why a chosen file did not reach the tray. */
export type StageRejectionReason = 'duplicate' | 'file_limit' | 'batch_size';

export interface StageRejection {
  file: File;
  reason: StageRejectionReason;
}

export interface StageFilesOptions {
  /** How many files the tray may hold in total. */
  maxFiles: number;
  /** How many bytes the tray may hold in total. */
  maxTotalBytes: number;
  /** Renders a byte count the way the surrounding surface does. */
  formatBytes: (bytes: number) => string;
}

export interface StageFilesResult {
  /** The tray after the pick. Identical to `existing` when nothing was added. */
  files: File[];
  /** What actually reached the tray, in the order it was chosen. */
  added: File[];
  /** What did not, and why. */
  rejected: StageRejection[];
  /**
   * One line per reason, already worded for an operator.
   *
   * Grouped by reason rather than by file: five files over the batch cap is
   * one thing that happened, and five separate messages is a wall.
   */
  notices: string[];
  /** The tray's total size after the pick. */
  totalBytes: number;
}

/**
 * As much identity as a `File` carries.
 *
 * Two picks of the same file produce different `File` objects, so reference
 * equality never sees a duplicate. Name, size and modified time collide for
 * two genuinely different files only if they are alike in every way that
 * matters here — in which case staging one of them is the right answer anyway.
 */
export function fileIdentity(file: File): string {
  return `${file.name} ${file.size} ${file.lastModified}`;
}

/** "a.pdf, b.pdf and 4 more" — a list that stays one line. */
function listOf(files: File[]): string {
  if (files.length <= 3) return files.map((file) => file.name).join(', ');
  const head = files.slice(0, 3).map((file) => file.name).join(', ');
  return `${head} and ${files.length - 3} more`;
}

export function stageUploadFiles(
  existing: File[],
  incoming: File[],
  options: StageFilesOptions,
): StageFilesResult {
  const { maxFiles, maxTotalBytes, formatBytes } = options;

  const seen = new Set(existing.map(fileIdentity));
  const files = [...existing];
  const added: File[] = [];
  const rejected: StageRejection[] = [];
  let totalBytes = existing.reduce((sum, file) => sum + file.size, 0);

  for (const file of incoming) {
    const identity = fileIdentity(file);
    if (seen.has(identity)) {
      rejected.push({ file, reason: 'duplicate' });
      continue;
    }
    if (files.length >= maxFiles) {
      rejected.push({ file, reason: 'file_limit' });
      continue;
    }
    if (totalBytes + file.size > maxTotalBytes) {
      // Greedy in the order chosen: one large file that does not fit must not
      // stop the smaller ones behind it, and the reader can tell which it was
      // because it is named in the notice.
      rejected.push({ file, reason: 'batch_size' });
      continue;
    }
    seen.add(identity);
    files.push(file);
    added.push(file);
    totalBytes += file.size;
  }

  const notices: string[] = [];
  const filesRejectedFor = (reason: StageRejectionReason) =>
    rejected.filter((entry) => entry.reason === reason).map((entry) => entry.file);

  const duplicates = filesRejectedFor('duplicate');
  if (duplicates.length) {
    notices.push(
      duplicates.length === 1
        ? `${duplicates[0].name} is already staged.`
        : `${listOf(duplicates)} are already staged.`,
    );
  }

  const overFileLimit = filesRejectedFor('file_limit');
  if (overFileLimit.length) {
    notices.push(
      `The tray holds ${maxFiles} files. ${listOf(overFileLimit)} `
      + `${overFileLimit.length === 1 ? 'was' : 'were'} not added — upload what is staged, then choose the rest.`,
    );
  }

  const overBatch = filesRejectedFor('batch_size');
  if (overBatch.length) {
    notices.push(
      `A batch must stay under ${formatBytes(maxTotalBytes)}. ${listOf(overBatch)} `
      + `${overBatch.length === 1 ? 'does' : 'do'} not fit — upload what is staged, then choose the rest.`,
    );
  }

  return { files, added, rejected, notices, totalBytes };
}
