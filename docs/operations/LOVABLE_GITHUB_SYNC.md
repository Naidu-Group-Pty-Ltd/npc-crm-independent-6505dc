# A merge that never reached Lovable

**Read this the moment a merged pull request does not appear in Lovable.** The
instinct is that the merge failed, and the instinct is usually wrong: nothing
about a green merge on GitHub says anything about whether the Lovable ↔ GitHub
connection carried it.

## What happened on 28 August 2026

PR #2326 was merged into `main` at 04:15:05Z. Lovable never offered it to
publish. The reflex — "re-open it, or raise the same change as a new PR and
merge it again" — cannot work and is worth understanding before anyone tries
it: **the commits were already on `main`.** A branch cut from `main` has an
empty diff against `main`, so a "same changes" pull request has nothing in it,
and merging it a second time is not a thing GitHub can do.

The fault was on the other side of the connection, and it was diagnosable in
about a minute:

| Evidence | Reading |
| --- | --- |
| `origin/main` was `4882c0fc8`, containing the change | the merge landed |
| Lovable's project reported `latest_commit_sha: a42e99c3e` | Lovable was one merge behind, at PR #2325 |
| `last_edited_at` was 22 seconds after #2325 merged, and nothing since | the sync used to work and had stopped |
| The #2325 merge commit says `from lavan96/…`; #2326 says `from Naidu-Group-Pty-Ltd/…` | **the repository changed owner between the two merges** |

The repository was transferred from `lavan96` to the `Naidu-Group-Pty-Ltd`
organisation in the half-hour between those two merges. That is the whole
story: Lovable's GitHub App is installed **per account**, and its webhook is
bound to that installation. A transfer moves the repository out from under the
installation that was watching it. GitHub keeps serving the old URL by
redirect — which is why `git push`, `gh` and every documentation link kept
working, and why nothing looked broken — but push events stop being delivered.

## The fix

Nothing in this repository can restore it. Re-pointing an app installation is
an account-level act:

1. **On GitHub** — the new owner's *Settings → Applications → Installed GitHub
   Apps → Lovable → Configure*, and grant it access to
   `Naidu-Group-Pty-Ltd/npc-property-dashbord`. If Lovable is not installed on
   the organisation at all, install it there first.
2. **In Lovable** — open the project, then *Settings → GitHub*. Disconnect and
   reconnect the repository so the stored `owner/name` is the new one rather
   than the redirect.
3. **Give it something to carry.** A reconnect does not replay the pushes it
   missed. Merging any pull request moves `main` forward, and because the
   missed commits are already in that history, **one merge catches everything
   up** — there is no need to reconstruct the change that went missing.
4. **Confirm rather than assume.** Lovable's project reports
   `latest_commit_sha`; it should equal `git rev-parse origin/main`. Until
   those two match, the publish button is offering an older build whatever the
   screen says.

## The rule this is here to record

**A merged pull request and a published build are two different facts, and only
one of them is visible on GitHub.** Everything about a transfer is silent by
design: the redirect keeps the URLs alive, CI keeps passing, pushes keep
succeeding, and the only symptom is an absence. So when a change does not
appear, check `latest_commit_sha` against `origin/main` FIRST. It answers in
one comparison whether the problem is the merge, the connection, or the build —
and it is the one check that cannot be misled by a redirect.

Nothing in the workflows reads the repository owner (verified: no
`github.repository` or `repository_owner` guard exists in
`.github/workflows/`), so CI and the deploy pipelines were unaffected by the
transfer. The live references that named the old owner have been repointed;
the historical ones — a run id, a raw URL pinned to a SHA, a link to a merged
PR — were deliberately left alone, because they record what happened at a
moment in time and rewriting them would falsify the record.
