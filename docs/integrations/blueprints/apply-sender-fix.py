#!/usr/bin/env python3
"""
Rebuild `npc-email-1-new.upgraded.json` from `npc-email-1-new.original.json`.

The defect: every listing the `NPC Email 1 New` scenario writes records an NPC
colleague as the sender. Six Airtable modules map

    Sender Email  <-  {{1.from.emailAddress.address}}
    Sender Name   <-  {{1.from.emailAddress.name}}

which is the *envelope*, and listing mail no longer arrives from agents — it
arrives forwarded by NPC staff out of their personal mailboxes, sometimes six
hops deep. So `Sender Email` held `lavankenobi@gmail.com` or
`naidu.rugesh@gmail.com` on all 51 records the scenario had written, and the
dashboard — which falls back to `Sender Email` when the agent and agency columns
are empty, as they usually are — presented the forwarder as the agent.

The original sender is still in the body, in the forwarding headers. A new
`regexp:Parser` (module 200) recovers it and the six modules map from that,
falling back to the envelope when the message is not a forward.

Run:  python3 docs/integrations/blueprints/apply-sender-fix.py
"""

from __future__ import annotations

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
ORIGINAL = HERE / "npc-email-1-new.original.json"
UPGRADED = HERE / "npc-email-1-new.upgraded.json"

# Airtable field ids on Property Intake Master (tblWIg5cs85O30pcY).
SENDER_EMAIL = "fld4IPtcoGDjj6uml"
SENDER_NAME = "fldUWHc1JQ7DHCfei"

# The Airtable modules that write a listing and carry the two sender columns.
WRITE_MODULES = [25, 28, 38, 72, 96, 105]

# The extraction prompts, so the model is told the same thing the parser enforces.
PROMPT_MODULES = [20, 21, 36, 98]

PARSER_ID = 200

# ---------------------------------------------------------------------------
# The pattern
# ---------------------------------------------------------------------------
# Read right to left, because both `[\s\S]*` runs are greedy and that is what
# makes this pick the *innermost* hop of a forward chain:
#
#   1. a forwarding marker must appear somewhere. Reply threads quote a bare
#      `From:` line with no marker, and two of the 120 bodies sampled were
#      replies whose quoted text was our own outbound mail — without this gate
#      the parser replaced a real agent with `rugesh@npcservices.com.au`.
#   2. after the last marker, the last `From:` line wins. A Gmail forward of an
#      Outlook forward nests one header block inside another and only the outer
#      one carries the "Forwarded message" text, so anchoring each `From:` to a
#      marker of its own loses the real sender.
#   3. the address may not be one of ours. Chains routinely pass through
#      property@npcservices.com.au on the way in; skipping those is what turns
#      "the last From:" into "the last From: that belongs to an agency".
#
# `<?` is optional because html-to-text renders a mailto as
# `Name <addr [addr]>` in some clients and as a bare `From: addr` in others. It
# also expands a linked display name to `realcommercial.com.au
# [http://realcommercial.com.au]`, so the name stops at `[` and an optional
# bracketed run is skipped before the address — without that the captured name
# carries the URL, and excluding `[` from the name alone loses the match.
#
# Measured over the 120 most recent bodies in the Emails table: 6 of 6
# recoverable forwards resolved to the originating agency
# (scott@shore-property.com.au, admin@jmsons.com.au, yp@blights.com.au,
# sales@waterscarpenter.com.au), 0 resolved to an NPC address, and 0 of the 106
# non-forwarded messages were touched.
FORWARD_PATTERN = (
    r"[\s\S]*(?:Begin forwarded message|Forwarded message|Original Message)"
    r"[\s\S]*[\n>]From[ \t]*:[ \t]*(?<fwd_name>[^<\[\n]{0,150}?)"
    r"[ \t]*(?:\[[^\]\n]*\][ \t]*)?<?[ \t]*"
    r"(?<fwd_email>(?!(?:lavankenobi|naidu\.rugesh)@gmail\.com)"
    r"(?![A-Za-z0-9._%+-]+@npcservices\.com\.au)"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"
)

# Fall back to the envelope when the body carried no forwarded header — a direct
# agent email is still the common case and must keep behaving as it did.
SENDER_EMAIL_EXPR = f"{{{{ifempty({PARSER_ID}.fwd_email; 1.from.emailAddress.address)}}}}"
# Deliberately not `ifempty(fwd_name; ...)`: when the header gave an address but
# no display name, falling through would pair the agency's address with the
# forwarder's name.
SENDER_NAME_EXPR = (
    f"{{{{if(length({PARSER_ID}.fwd_email) > 0; "
    f"{PARSER_ID}.fwd_name; 1.from.emailAddress.name)}}}}"
)

PROMPT_RULE = """

FORWARDED MAIL - WHO THE AGENT IS
This mailbox receives listing mail that NPC staff forward in, often several hops
deep. The forwarding headers inside the body ("---------- Forwarded message
---------", "From: ... Sent: ... To: ... Subject: ...") describe how the mail
reached us. They do not describe who is selling the property.
* Never report a forwarder as the agent. agent_name and agent_email must be the
  listing agent named in the listing content itself.
* Never emit an @npcservices.com.au address, lavankenobi@gmail.com or
  naidu.rugesh@gmail.com in any agent, agency or sender field. Those are ours.
* agent_email is the agent's own published address. When the source shows only a
  general agency inbox (sales@, info@, admin@, enquiries@), put it in
  agency_email and leave agent_email null - do not copy one into the other.
* Leave a field null rather than guessing. A null is recoverable; a wrong contact
  gets an enquiry sent to a real person about a property they do not represent.
"""


def walk(flow, out):
    """Every module in the blueprint, including inside routes and error handlers."""
    for module in flow:
        out[module["id"]] = module
        for route in module.get("routes") or []:
            walk(route.get("flow", []), out)
        for handler in module.get("onerror") or []:
            walk([handler], out)
    return out


def build_parser_module(template):
    """A `regexp:Parser` shaped like module 13, which already works here."""
    return {
        "id": PARSER_ID,
        "module": "regexp:Parser",
        "version": 1,
        "mapper": {"text": "{{4.text}}"},
        "parameters": {
            "pattern": FORWARD_PATTERN,
            "global": False,          # one bundle in, at most one bundle out
            "sensitive": False,       # "FROM:" survives uppercaseHeadings
            "multiline": True,
            "singleline": False,
            "continueWhenNoRes": True,  # a direct email must not stall here
            "ignoreInfiniteLoopsWhenGlobal": False,
        },
        "metadata": {
            "designer": {"x": 300, "y": 2850, "name": "Original sender of a forward"},
            "expect": [{"name": "text", "type": "text", "label": "Text"}],
            "restore": {},
            "interface": [
                {"name": "i", "type": "uinteger", "label": "i"},
                {"name": "fwd_name", "type": "text", "label": "fwd_name"},
                {"name": "fwd_email", "type": "text", "label": "fwd_email"},
                {"name": "__IMTMATCH__", "type": "any", "label": "Fallback Match"},
            ],
            "parameters": template["metadata"]["parameters"],
        },
    }


def main() -> int:
    blueprint = json.loads(ORIGINAL.read_text())
    modules = walk(blueprint["flow"], {})
    changes = []

    if PARSER_ID in modules:
        print(f"module {PARSER_ID} already present - has this been applied?", file=sys.stderr)
        return 1

    # 1. Insert the parser directly after module 4 (HTMLToText), whose `text`
    #    output it reads, and before module 108 splits the body into chunks.
    top = blueprint["flow"]
    at = next(i for i, m in enumerate(top) if m["id"] == 4)
    top.insert(at + 1, build_parser_module(modules[13]))
    changes.append(f"inserted module {PARSER_ID} (regexp:Parser) after module 4")

    # 2. Repoint the sender columns on every module that writes a listing.
    for mid in WRITE_MODULES:
        record = modules[mid]["mapper"]["record"]
        for field, expr, label in (
            (SENDER_EMAIL, SENDER_EMAIL_EXPR, "Sender Email"),
            (SENDER_NAME, SENDER_NAME_EXPR, "Sender Name"),
        ):
            if field not in record:
                print(f"module {mid}: {label} not mapped - skipped", file=sys.stderr)
                continue
            record[field] = expr
            changes.append(f"module {mid}: {label} -> {expr}")

    # 3. Tell the extractors the same rule, so the model does not reintroduce a
    #    forwarder through `agent_email` instead.
    for mid in PROMPT_MODULES:
        module = modules.get(mid)
        if not module:
            continue
        mapper = module["mapper"]
        # Chat modules carry a system message; `analyzeImages` carries one
        # flat `prompt` string instead.
        for message in mapper.get("messages", []):
            if message.get("role") != "system":
                continue
            if "FORWARDED MAIL" in message.get("content", ""):
                continue
            message["content"] = message.get("content", "") + PROMPT_RULE
            changes.append(f"module {mid}: appended forwarded-mail rule to system prompt")
        if "prompt" in mapper and "FORWARDED MAIL" not in mapper["prompt"]:
            mapper["prompt"] += PROMPT_RULE
            changes.append(f"module {mid}: appended forwarded-mail rule to prompt")

    # Minified, matching the npc-email-1.* files beside it: Make emits the
    # blueprint this way and the import path takes it verbatim.
    UPGRADED.write_text(json.dumps(blueprint, separators=(",", ":"), ensure_ascii=False))
    for change in changes:
        print(" -", change)
    print(f"\nwrote {UPGRADED} ({UPGRADED.stat().st_size:,} bytes, {len(changes)} changes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
