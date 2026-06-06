# VisualWalkthroughs — Operations Runbook
### What to do when something goes wrong (for a non-coder)

You will never debug code. This is your "something's wrong, what do I click" guide. Keep it bookmarked. Most fixes are one of two moves: **flip a switch in a web dashboard**, or **paste the problem to Claude Code and say "fix this."**

---

## 🔴 THE KILL SWITCH (memorise this)

If anything looks badly wrong and you just want everything to STOP, do these two things. They're safe, reversible, and take under a minute.

**1. Stop the robot from running again.**
- Go to your project on **github.com → the "Actions" tab → the "Nightly Pipeline" workflow → "..." menu → Disable workflow.**
- The nightly job will not run again until you re-enable it. Nothing else is affected.

**2. Put the website back to the last good version.**
- Go to **Cloudflare dashboard → Workers & Pages → your site → Deployments.**
- Find the last deployment from *before* the problem, click its "..." menu, and choose **Rollback to this deployment**.
- The live site instantly reverts. Visitors see the good version again.

That's it. The site is frozen on a known-good state and the robot is paused. Now you can investigate calmly, or paste the situation to Claude Code and ask for help. **Re-enable the workflow only once you understand what happened.**

---

## The everyday incidents

Find your symptom. The fix is in the right-hand column.

| What you're seeing | What it means | What to do |
|---|---|---|
| **A walkthrough reads badly / has a wrong tip** | Content quality issue, not a breakage | Write it in `feedback.md` (the pencil on GitHub). The robot fixes it tonight. No rush, site stays up. |
| **A page looks broken / blank / unstyled** | A code or build problem slipped through | **Kill switch step 2** (roll back). Then paste the page URL + a screenshot to Claude Code: *"this page is broken, roll-forward a fix."* |
| **The whole site is down** | Hosting or a bad deploy | **Kill switch step 2.** If still down, it's likely Cloudflare itself — check status.cloudflare.com; wait it out. |
| **No morning report arrived** | The robot may not have run (silent failure — the dangerous one) | Check **GitHub → Actions** for last night's run. Red X = it failed; click it, copy the error, paste to Claude Code: *"last night's run failed, here's the log, fix it."* No run at all = the schedule/credit; see next rows. |
| **Report says "credit exhausted" / runs stopped** | You've used this month's £20 Agent SDK allowance | Nothing is broken. Either wait for the monthly reset, or reduce to fewer/shorter games. **Do not** turn on "extra usage" unless you *want* to pay overage. |
| **Report says a game was "left on preview / rolled back"** | The robot caught its own bad output and refused to publish it (working as designed) | Read its diagnosis in the report. Add a note to `feedback.md`, or paste the report section to Claude Code and say *"sort this and try again tonight."* The live site was never affected. |
| **A wrong/duplicate game got published** | Advisor or queue slip | Add `feedback.md` note to remove/replace it, or tell Claude Code: *"unpublish <game> and roll back."* |
| **Email/alert says the nightly job didn't start at all** | Schedule broke, or GitHub had an outage | Check GitHub Actions. If GitHub was down, it'll resume next night. If the schedule's broken, paste to Claude Code: *"the nightly schedule didn't fire, check the workflow."* |
| **You suspect a key/password leaked** (saw it in a log, shared a screen, etc.) | Security incident — act fast | **Kill switch both steps.** Then: rotate the key (regenerate it in IGDB/Google/Anthropic and update the GitHub secret). Ask Claude Code: *"a key may have leaked, help me rotate all secrets and check the history."* |

---

## Routine operations (no incident)

- **Going on holiday / want a pause:** Kill switch step 1 (disable the workflow). Re-enable when back. The live site keeps serving as normal the whole time.
- **Skip tonight:** just leave `queue.md` empty. The robot runs, finds nothing to build, and writes a short "idle" report.
- **Undo one specific game:** tell Claude Code *"roll back <game> to before it was published"* — it's additive, so removing one is clean.
- **Change how the robot writes / behaves:** never edit code yourself. Open Claude Code and describe the change in plain English (*"make the do-now tips shorter"*). It edits the right file and the change takes effect next run.

---

## The two rules that keep you out of trouble

1. **When unsure, freeze first, investigate second.** The kill switch is always safe. A paused, rolled-back site is never an emergency.
2. **You describe problems; Claude Code fixes them.** Your job is to notice and report clearly (URL, screenshot, the report's error text). The fixing is the AI's job — interactively, with you, never silently.

---

## Escalation — when to get a human

If Claude Code can't resolve something across a couple of attempts, or anything touches money, security, or a legal/takedown notice, that's the moment for a person:
- A few hours of a **freelance developer** for a stubborn technical fault.
- A **solicitor** for anything in the compliance pack (a takedown demand, a data-protection complaint).
Keep the site frozen (kill switch) until it's resolved. Frozen is fine. Broken-and-live is not.
