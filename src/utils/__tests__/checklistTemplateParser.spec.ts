import { describe, expect, it } from 'vitest';
import { parseTemplateContent } from '@/utils/checklistTemplateParser';

describe('parseTemplateContent — markdown / extracted text', () => {
  it('reads sections and checkbox state', () => {
    const parsed = parseTemplateContent(`
# Onboarding
## Before the call
- [x] Send agreement
- [ ] Book meeting
    `);
    expect(parsed.name).toBe('Onboarding');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Send agreement', is_pre_checked: true },
      { label: 'Book meeting', is_pre_checked: false },
    ]);
  });

  it('reads the checkbox glyphs Word and PDF documents actually contain', () => {
    // These lines previously fell through to the plain-text branch, so the
    // glyph stayed in the label and the checked state was lost.
    const parsed = parseTemplateContent(`
## Daily tasks
☑ Review inbox
☐ Update pipeline
✔ File compliance note
    `);
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Review inbox', is_pre_checked: true },
      { label: 'Update pipeline', is_pre_checked: false },
      { label: 'File compliance note', is_pre_checked: true },
    ]);
  });

  it('reads a bulleted glyph checkbox', () => {
    const parsed = parseTemplateContent('## Tasks\n- ☑ Signed\n- ☐ Unsigned');
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Signed', is_pre_checked: true },
      { label: 'Unsigned', is_pre_checked: false },
    ]);
  });

  it('reads a markdown table as items with their status', () => {
    const parsed = parseTemplateContent(`
## Settlement
| Task | Status |
| --- | --- |
| Order title search | Done |
| Confirm finance | Pending |
    `);
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Order title search', is_pre_checked: true },
      { label: 'Confirm finance', is_pre_checked: false },
    ]);
  });

  it('drops the page furniture PDF extraction leaves behind', () => {
    const parsed = parseTemplateContent(`
## Checklist
--- Page 1 ---
- First task
Page 2 of 4
- Second task
    `);
    expect(parsed.sections[0]!.items.map((item) => item.label)).toEqual(['First task', 'Second task']);
  });

  it('de-duplicates repeated headers and footers within a section', () => {
    const parsed = parseTemplateContent(`
## Checklist
- Confirm identity
- Confirm identity
- Confirm address
    `);
    expect(parsed.sections[0]!.items.map((item) => item.label)).toEqual([
      'Confirm identity',
      'Confirm address',
    ]);
  });

  it('accepts a checklist with no section headings at all', () => {
    // Previously this threw "Could not find any checklist items".
    const parsed = parseTemplateContent('- [ ] Task one\n- [x] Task two');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.items).toHaveLength(2);
  });

  it('reads unicode bullet characters as items', () => {
    const parsed = parseTemplateContent('## Tasks\n• First\n▪ Second');
    expect(parsed.sections[0]!.items.map((item) => item.label)).toEqual(['First', 'Second']);
  });

  it('normalises ligatures and non-breaking spaces from extraction', () => {
    const parsed = parseTemplateContent('## Tasks\n- Conﬁrm the oﬃce address');
    expect(parsed.sections[0]!.items[0]!.label).toBe('Confirm the office address');
  });

  it('still throws when there is genuinely nothing to import', () => {
    expect(() => parseTemplateContent('   ')).toThrow(/checklist items/i);
  });
});

describe('parseTemplateContent — HTML', () => {
  it('finds a checklist nested inside wrapper elements', () => {
    // The previous direct-children-only scan found nothing in real exported HTML.
    const parsed = parseTemplateContent(`
      <html><body><div class="page"><main>
        <h1>Client Onboarding</h1>
        <h2>Documents</h2>
        <ul>
          <li><input type="checkbox" checked /> ID verified</li>
          <li><input type="checkbox" /> Bank statements</li>
        </ul>
      </main></div></body></html>
    `);
    expect(parsed.name).toBe('Client Onboarding');
    expect(parsed.sections[0]!.title).toBe('Documents');
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'ID verified', is_pre_checked: true },
      { label: 'Bank statements', is_pre_checked: false },
    ]);
  });

  it('reads a nested list without double-counting the parent item', () => {
    const parsed = parseTemplateContent(`
      <body><h2>Steps</h2><ul>
        <li>Parent task<ul><li>Child task</li></ul></li>
      </ul></body>
    `);
    expect(parsed.sections[0]!.items.map((item) => item.label)).toEqual(['Parent task', 'Child task']);
  });

  it('reads an HTML table checklist', () => {
    const parsed = parseTemplateContent(`
      <body><h2>Settlement</h2><table>
        <tr><td>Order search</td><td>Done</td></tr>
        <tr><td>Confirm finance</td><td>Pending</td></tr>
      </table></body>
    `);
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Order search', is_pre_checked: true },
      { label: 'Confirm finance', is_pre_checked: false },
    ]);
  });
});

describe('parseTemplateContent — JSON', () => {
  it('reads an explicit JSON template', () => {
    const parsed = parseTemplateContent(
      JSON.stringify({
        name: 'Compliance',
        sections: [{ title: 'AML', items: ['Verify identity', { label: 'File report', is_pre_checked: true }] }],
      }),
    );
    expect(parsed.name).toBe('Compliance');
    expect(parsed.sections[0]!.items).toEqual([
      { label: 'Verify identity', is_pre_checked: false },
      { label: 'File report', is_pre_checked: true },
    ]);
  });
});
