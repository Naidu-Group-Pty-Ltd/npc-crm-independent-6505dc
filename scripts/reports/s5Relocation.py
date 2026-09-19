"""Was the financial detail that left the Compass verified at its destination?

Three misses in a row taught the rule this uses: extracted PDF text is a
MEASUREMENT, and this one has to survive tracked small caps (`pdftotext`
renders the KPI label as "W E E K L Y  R E N T"), hyphenation ("Cash-on-cash
return" against a search for "Cash on cash") and case. Each of those produced
a confident wrong answer on the first three attempts — one false absence, two
false presences.

So it folds all three away, and judges the document's own MARKDOWN as well as
its printed text: the markdown is what the composition wrote, the PDF is what
reached paper, and a claim about relocation has to hold in both.
"""
import re, subprocess

fold = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())

def body(name):
    printed = subprocess.run(['pdftotext', '-raw', f'reports/pdf/{name}.pdf', '-'],
                             capture_output=True, text=True).stdout
    return fold(printed) + fold(open(f'reports/html/{name}.md').read())

def holds(name, phrases):
    b = body(name)
    return any(fold(p) in b for p in phrases)

MOVED = {
    'purchase-cost breakdown': ['stamp duty', 'Acquisition item', 'Purchase Costs'],
    'gross yield':             ['Gross yield', 'Gross rental yield'],
    'net yield':               ['Net yield'],
    'loan structure':          ['Loan amount', 'Loan Structure'],
    'LVR':                     ['LVR'],
    'repayments':              ['Annual repayment', 'Monthly repayment'],
    'sensitivity testing':     ['Sensitivity', 'Scenario Testing'],
    'ten-year projection':     ['10-Year Cashflow', 'Equity bridge'],
    'cash-on-cash return':     ['Cash-on-cash return', 'Cash on cash'],
    'year-1 net position':     ['Weekly net position', 'Weekly position', 'Annual net cashflow'],
}
STAYS = {'purchase price': ['Purchase price'], 'weekly rent': ['Weekly rent']}

bad = 0
for s in ('annabelle', 'pallas'):
    print(f'=== {s}')
    for label, ph in MOVED.items():
        c, f = holds(f's5-{s}-compass', ph), holds(f's5-{s}-financial', ph)
        ok = (not c) and f
        bad += 0 if ok else 1
        note = 'OK' if ok else ('>>> STILL IN COMPASS' if c else '>>> ABSENT FROM DESTINATION')
        print(f'  {label:26} compass={"YES" if c else "no ":3}  financial={"yes" if f else "NO ":3}  {note}')
    for label, ph in STAYS.items():
        c = holds(f's5-{s}-compass', ph)
        bad += 0 if c else 1
        print(f'  {label:26} compass={"yes" if c else "NO ":3}  ' + ('OK' if c else '>>> MISSING'))
    print()
print('problems:', bad)
