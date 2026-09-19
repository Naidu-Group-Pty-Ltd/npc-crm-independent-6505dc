/**
 * The rule under test is the one the client Files tab broke: a pick ADDS.
 *
 * Everything else here exists because the accumulating version the finance
 * vault had written by hand got the edge cases wrong in ways that all look, from
 * the outside, like the product losing a file.
 */
import { describe, expect, it } from 'vitest';

import { fileIdentity, stageUploadFiles } from '../stageUploadFiles.pure';

const MB = 1024 * 1024;
const formatBytes = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

/** A `File` with a size we control; jsdom's constructor honours the parts. */
function makeFile(name: string, bytes: number, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(bytes)], name, { lastModified, type: 'application/pdf' });
}

const OPTIONS = { maxFiles: 10, maxTotalBytes: 50 * MB, formatBytes };

describe('stageUploadFiles', () => {
  it('adds to the tray rather than replacing it', () => {
    // The reported defect, in one assertion: pick 1554.pdf, then pick 54.pdf,
    // and 1554.pdf must still be there.
    const first = stageUploadFiles([], [makeFile('1554.pdf', 1024)], OPTIONS);
    const second = stageUploadFiles(first.files, [makeFile('54.pdf', 2048)], OPTIONS);

    expect(first.files.map((f) => f.name)).toEqual(['1554.pdf']);
    expect(second.files.map((f) => f.name)).toEqual(['1554.pdf', '54.pdf']);
    expect(second.added.map((f) => f.name)).toEqual(['54.pdf']);
    expect(second.notices).toEqual([]);
  });

  it('keeps the chosen order across picks', () => {
    const tray = stageUploadFiles([], [makeFile('a.pdf', 1), makeFile('b.pdf', 1)], OPTIONS);
    const next = stageUploadFiles(tray.files, [makeFile('c.pdf', 1)], OPTIONS);
    expect(next.files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });

  it('does not stage the same file twice, and says so', () => {
    const tray = stageUploadFiles([], [makeFile('54.pdf', 2048)], OPTIONS);
    const again = stageUploadFiles(tray.files, [makeFile('54.pdf', 2048)], OPTIONS);

    expect(again.files).toHaveLength(1);
    expect(again.added).toEqual([]);
    expect(again.rejected.map((r) => r.reason)).toEqual(['duplicate']);
    expect(again.notices).toEqual(['54.pdf is already staged.']);
  });

  it('treats a different file with the same name as a different file', () => {
    // Two documents called `scan.pdf` from two folders are two documents.
    const tray = stageUploadFiles([], [makeFile('scan.pdf', 1000)], OPTIONS);
    const next = stageUploadFiles(tray.files, [makeFile('scan.pdf', 2000)], OPTIONS);
    expect(next.files).toHaveLength(2);
    expect(next.notices).toEqual([]);
  });

  it('de-duplicates within a single pick as well as against the tray', () => {
    const same = makeFile('x.pdf', 10);
    const result = stageUploadFiles([], [same, makeFile('x.pdf', 10)], OPTIONS);
    expect(result.files).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('stops at the file cap and NAMES what it excluded', () => {
    // `slice` is what the two hand-written versions used, and it is why
    // neither cap had ever been seen by anybody.
    const nine = Array.from({ length: 9 }, (_, i) => makeFile(`f${i}.pdf`, 1));
    const tray = stageUploadFiles([], nine, OPTIONS);
    const result = stageUploadFiles(tray.files, [makeFile('ten.pdf', 1), makeFile('eleven.pdf', 1)], OPTIONS);

    expect(result.files).toHaveLength(10);
    expect(result.added.map((f) => f.name)).toEqual(['ten.pdf']);
    expect(result.rejected).toEqual([expect.objectContaining({ reason: 'file_limit' })]);
    expect(result.notices.join(' ')).toContain('eleven.pdf');
    expect(result.notices.join(' ')).toContain('10 files');
  });

  it('stages what fits under the batch cap and names what does not', () => {
    const result = stageUploadFiles(
      [makeFile('big.pdf', 48 * MB)],
      [makeFile('huge.pdf', 10 * MB), makeFile('small.pdf', 1 * MB)],
      OPTIONS,
    );

    // Greedy in the chosen order: `huge` does not fit, `small` does — refusing
    // both would make the operator work out which one was the problem.
    expect(result.files.map((f) => f.name)).toEqual(['big.pdf', 'small.pdf']);
    expect(result.rejected).toEqual([expect.objectContaining({ reason: 'batch_size' })]);
    expect(result.notices.join(' ')).toContain('huge.pdf');
    expect(result.notices.join(' ')).toContain('50.0 MB');
  });

  it('never returns fewer files than it was given', () => {
    // The invariant behind rule 2. Whatever a pick is refused for, the tray
    // that existed before it survives.
    const existing = [makeFile('kept-1.pdf', 20 * MB), makeFile('kept-2.pdf', 25 * MB)];
    const result = stageUploadFiles(existing, [makeFile('too-big.pdf', 40 * MB)], OPTIONS);

    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.name)).toEqual(['kept-1.pdf', 'kept-2.pdf']);
    expect(result.added).toEqual([]);
    expect(result.notices).toHaveLength(1);
  });

  it('reports one notice per reason rather than one per file', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => makeFile(`f${i}.pdf`, 1));
    const result = stageUploadFiles([], [...eleven, eleven[0]], OPTIONS);
    // One file-limit line and one duplicate line — not five.
    expect(result.notices).toHaveLength(2);
  });

  it('abbreviates a long list so a notice stays one line', () => {
    const staged = Array.from({ length: 6 }, (_, i) => makeFile(`d${i}.pdf`, 1));
    const tray = stageUploadFiles([], staged, OPTIONS);
    const result = stageUploadFiles(tray.files, staged, OPTIONS);
    expect(result.notices[0]).toContain('and 3 more');
  });

  it('reports the tray total, which is what the progress bar reads', () => {
    const result = stageUploadFiles([makeFile('a.pdf', 2 * MB)], [makeFile('b.pdf', 3 * MB)], OPTIONS);
    expect(result.totalBytes).toBe(5 * MB);
  });

  it('is a no-op for an empty pick', () => {
    const existing = [makeFile('a.pdf', 1)];
    const result = stageUploadFiles(existing, [], OPTIONS);
    expect(result.files).toEqual(existing);
    expect(result.notices).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('does not mutate the tray it was handed', () => {
    const existing = [makeFile('a.pdf', 1)];
    stageUploadFiles(existing, [makeFile('b.pdf', 1)], OPTIONS);
    expect(existing).toHaveLength(1);
  });

  it('identifies a file by name, size and modified time', () => {
    expect(fileIdentity(makeFile('a.pdf', 3, 10))).toBe('a.pdf 3 10');
    expect(fileIdentity(makeFile('a.pdf', 3, 11))).not.toBe(fileIdentity(makeFile('a.pdf', 3, 10)));
  });
});
