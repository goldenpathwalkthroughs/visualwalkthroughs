# VisualWalkthroughs — The Plain-English Guide
### Setting it up and running it, for someone who doesn't code

This is the "how do I actually make this happen" guide. No jargon without an explanation. Read Part 0 first — it's the map.

---

## Part 0 — The honest map

There are two phases, and they feel completely different:

- **Setup (once, ~a weekend).** This part is technical. You won't *write* code, but you'll create accounts, install two programs, and let an AI assistant (Claude Code) build everything while you answer its questions. If you get stuck, the escape hatch is always "paste the problem to Claude and ask." If you'd rather not, ~2–3 hours of a freelance developer's time can do this part for you — it's a small, well-defined job.
- **Daily running (forever after, ~5 minutes a day).** This part is genuinely hands-off and happens entirely in a web browser. No code, no terminal, no installed software.

**The one idea that makes this work for a non-coder:** Claude Code is your builder. You tell it what you want (you already have the plan — the architecture, pipeline, and style-guide documents), it writes the website and the robot, and it puts everything in the cloud so it runs itself.

**Where the robot lives:** in the cloud, on a service called GitHub, which runs your nightly job on a timer for free. Your own computer does **not** need to stay on overnight. You only use your computer once — to do the initial build.

---

## Part 1 — Setup (the one-time technical bit)

Do these in order. Each step says *what it is*, *why you need it*, and *what to do*.

### Step 1 — Your accounts (all free except the domain)

You're collecting a handful of free logins. Open a notes file and paste each username/key as you go.

1. **Claude Pro** — *what:* your £/$20 subscription. *why:* it powers the AI writing. *do:* you already have it. Watch your email for a message about claiming your **Agent SDK credit** (the allowance that lets Claude run automatically) and click to claim it.
2. **GitHub** — *what:* a free "filing cabinet in the cloud" that stores your website's files and runs the nightly robot. *why:* it's the home of everything. *do:* sign up at github.com (free).
3. **Cloudflare** — *what:* the free service that puts your website on the internet, fast, worldwide. *why:* hosting, at no cost. *do:* sign up at cloudflare.com (free, no card needed).
4. **Twitch developer account (for IGDB)** — *what:* IGDB is a giant database of games; you reach it through a free Twitch developer login. *why:* it tells the robot a game is real and gives you the box art. *do:* you'll do this with Claude Code's help in Step 3 — just note now that it's free.
5. **Google account (for the YouTube key)** — *what:* a free key that lets the robot find the right gameplay videos. *why:* the embedded videos. *do:* again, Claude Code will walk you through generating this in Step 3.
6. **A domain name (optional)** — *what:* your web address, e.g. `visualwalkthroughs.com`. *why:* looks real; optional because you get a free address to start. *do:* buy one later (~£10/year) only if you want it. You can launch without it.

### Step 2 — Install the two programs (on your computer, once)

You need these only to *build* the project.

1. **Node.js** — *what:* a free engine that other tools run on. *do:* go to **nodejs.org**, download the "LTS" version, run the installer, click Next/Next/Done. You'll never open it directly.
2. **Claude Code** — *what:* your AI builder; it lives in a plain typing window called the "terminal." *do:* follow the official install at **docs.claude.com/en/docs/claude-code** (it's one command to paste). Don't worry about the terminal looking intimidating — you'll mostly type sentences, not code.

> The terminal is just a window where you type instructions instead of clicking buttons. Claude Code turns your plain-English sentences into the actual work.

### Step 3 — Let Claude Code build everything

This is the magic step. You open Claude Code and hand it the plan.

1. Make a new empty folder on your computer (e.g. "VisualWalkthroughs"). Put your four planning documents in it (architecture, pipeline, style guide, and the advisor guide).
2. Open the terminal **in that folder** and type `claude` to start Claude Code.
3. Give it a build brief — in plain English — that says, roughly:
   > "Build the website and the nightly content pipeline described in these documents. Use Astro, host on Cloudflare Pages, store content as files in this GitHub repo, and run the nightly job as a scheduled GitHub Action that uses my Claude subscription via the Agent SDK. Keep me non-technical: set everything up for me and tell me exactly which buttons to click and which keys to paste."
4. **Answer its questions in plain English.** It will ask things like "what's your GitHub username?" and "paste your IGDB key here." When it needs a key you don't have yet (IGDB, YouTube), ask it: *"walk me through getting that key, step by step."* It will.
5. It will create the website, the content system, the research → write → check → publish robot, the quality tests, and the nightly timer — and push it all to your GitHub filing cabinet.

> You are the director, not the builder. If anything errors, copy the red text, paste it back to Claude Code, and say "fix this." That loop solves almost everything.

### Step 4 — Connect the website to the internet

1. In your **Cloudflare** dashboard, choose **Pages → Connect to Git**, and pick the GitHub project Claude Code just made. Click through the defaults (Claude Code will tell you the exact build settings to enter).
2. Cloudflare gives you a free web address like `visualwalkthroughs.pages.dev`. Visit it — your site is live.

### Step 5 — One supervised test run

Don't trust it asleep until you've watched it awake once.

1. Put a single game in the queue (see Part 2 for how) — pick one with a clear story, like a classic Zelda or Final Fantasy.
2. Ask Claude Code: *"run the nightly pipeline once now, while I watch."*
3. Watch it research, write, check, and publish that one game. Read what it produced on your live site.
4. Anything wrong? Tell Claude Code in plain English; it adjusts the robot or the style settings.

### Step 6 — Turn on the timer and walk away

Once a test run looks good, tell Claude Code: *"schedule the pipeline to run every night and email me the morning report."* It sets the GitHub timer. From here on, your computer can be off — the cloud does the work.

**Setup done.** You never need the terminal again unless you want to change how the robot behaves (and even then, you just ask Claude Code).

---

## Part 2 — The daily rhythm (browser only, ~5 minutes)

This is your real, ongoing job. All of it is point-and-click on the GitHub website — no installs, no terminal.

### Each evening (2 minutes)
1. Go to your project on **github.com**.
2. Open the file called **`queue.md`**, click the **pencil icon** (edit), and type the game(s) you want made tonight — one per line. (Your Advisor AI gives you a shortlist to pick from — see the Advisor guide.) Click **Commit changes** to save.
3. Open **`feedback.md`**, click the pencil, and type any notes on yesterday's published walkthroughs ("the Forsaken Fortress section needs the barrel trick spelled out more"). Save. The robot reads this tonight and fixes things.

### Overnight (you're asleep)
The cloud robot validates the games are real, researches them, writes the walkthroughs in your house style, checks its own work, publishes to the live site, tests the live pages, fixes what it can, and writes a report.

### Each morning (3 minutes)
1. Read the **morning report** (emailed to you, and saved as a file). It tells you what got published, what needs your eyes, and what it couldn't do.
2. Anything in the "NEEDS YOU" list? You don't fix it yourself — you write a sentence about it in `feedback.md` that evening, and the robot handles it the next night.

### During the day (whenever)
Browse the live site, read a new walkthrough as a player would, and jot anything off into `feedback.md`. That's your quality control — *after* publishing, exactly as you wanted, never in the middle.

> **You are the taste, not the typing.** Pick the games, judge the results, give feedback. The robot does everything between.

---

## Part 3 — When something breaks (your escape hatch)

You will never debug code. Your two tools are:

- **For content problems** (a section reads badly, a wrong tip): write it in `feedback.md`. Fixed next night.
- **For machine problems** (the report says a run failed, or something looks broken): open Claude Code, paste the "NEEDS YOU" part of the report, and say *"fix this for me."* It diagnoses and repairs, then redeploys.

If you're ever truly stuck, that same paste-and-ask works in the normal Claude app too.

---

## Part 4 — Keeping it cheap and safe (a recap)

- Your spend is capped at your **£/$20 Agent SDK credit**. Leave "extra usage / overflow" **OFF** so you can never be charged more — if a month runs long, the robot just pauses until the credit resets.
- **One game per night** keeps you comfortably inside that budget when the writing is done by Haiku (the fast, cheap model).
- Everything else — hosting, the database, the cloud timer, the box art — runs on **free tiers**.
- Your floor is roughly **£10/year for a domain** (optional) plus the subscription you already pay.

---

## The thirty-second version

1. Make free accounts (GitHub, Cloudflare). 2. Install Node + Claude Code. 3. Tell Claude Code to build it from your plans. 4. Connect Cloudflare to GitHub. 5. Watch one test run. 6. Turn on the nightly timer.
Then forever: **evening** — type games + feedback on the GitHub website; **morning** — read the report; **day** — browse and judge. The cloud does the rest.
