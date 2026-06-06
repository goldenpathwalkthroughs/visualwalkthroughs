# VisualWalkthroughs — Legal & Compliance Pack

> **Important — read first.** I'm an AI, not a lawyer, and this is **not legal advice**. These are starting templates and a plain-English explanation of the current rules, written to save you money and time when you take them to a qualified UK solicitor for review before you launch. Laws change; have a professional check anything before you rely on it.

This pack assumes: a UK-based, public, fan-run site that hosts game box art, embeds others' YouTube videos, publishes original written walkthroughs, and wants to measure traffic.

---

## 1. The good news: a low-burden compliant design

UK cookie law changed recently in a way that helps a small site like yours. The Data (Use and Access) Act 2025 received Royal Assent on 19 June 2025, and its cookie provisions came into force on 5 February 2026, introducing a new "statistical purposes" (analytics) exception to the consent rules in PECR. In plain terms: you can run analytics without a consent pop-up, as long as you give clear information and a simple opt-out instead of opt-in — **but only** if the analytics are aggregated, used solely to improve your own service, not used to identify individuals, and not shared for advertising or third-party purposes.

So the smart, cheap, low-friction design is:

- **Use cookieless / privacy-first analytics** (e.g. Cloudflare Web Analytics), configured to be aggregate-only and not identifying. Standard Google Analytics almost certainly does NOT qualify for the new exception, because Google uses the data for its own purposes — avoid it, or you're back to needing consent.
- **Keep video embeds click-to-load** (your prototype already does this). The YouTube player only loads when the visitor actively clicks play — which both improves performance and means no third-party video cookies are set until the user chooses to engage. Pair it with a one-line notice at the player ("Pressing play loads YouTube, which may set its own cookies").

Done this way, you may avoid an intrusive consent banner entirely — just a clear privacy/cookie notice plus opt-outs. **Confirm this approach with your solicitor**, especially the video-embed point, since YouTube is a third party using data for its own purposes.

If you ever add advertising, marketing pixels, or non-exempt cookies, you then **do** need a proper consent banner: opt-in only, "Accept all" and "Reject all" shown with equal prominence, consent obtained before cookies are set, no pre-ticked boxes, and no cookie wall.

Two more current facts worth knowing: PECR fines have risen to UK GDPR levels — up to £17.5 million or 4% of turnover, and from 19 June 2026 organisations must have a formal data-protection complaints procedure in place (template F below).

---

## 2. The documents to publish

Fill in the `[brackets]`, get them reviewed, then link all of them in your site footer.

### A. Privacy Policy (template)

> **Privacy Policy — VisualWalkthroughs**
> Last updated: [date]
>
> **Who we are.** VisualWalkthroughs ("we") is a fan-run, non-commercial video-game walkthrough website operated by [your name / "an individual based in the UK"]. Contact: [email].
>
> **What we collect.** We aim to collect as little as possible.
> - *Analytics:* we use [Cloudflare Web Analytics], a privacy-first tool that measures aggregate traffic (pages viewed, rough country, device type) **without** cookies that identify you and without sharing your data for advertising. We rely on the PECR "statistical purposes" exception. You can opt out: [how].
> - *Contact:* if you email us (e.g. a correction or takedown), we keep your message and address to respond and keep records.
> - *Embedded video:* when you press play on a video, it loads from YouTube (Google), which may set its own cookies and process data under [Google's privacy policy link]. We don't load it until you click.
>
> **What we don't do.** No accounts, no advertising profiles, no selling data, no marketing emails.
>
> **Legal basis.** Legitimate interests (running and improving the site) and, where relevant, consent.
>
> **Your rights.** Under UK GDPR you can ask for access to, correction of, or deletion of your personal data, and you can complain to us (see our Complaints Procedure) or to the ICO (ico.org.uk).
>
> **Retention.** We keep emails for [12 months]; analytics are aggregate and not tied to you.
>
> **Changes.** We'll update this page and the "last updated" date.

### B. Cookie & Tracking Notice (template)

> **Cookies & tracking.** We keep this minimal.
> - **Essential:** only what's needed to serve the site.
> - **Analytics (no consent required):** [Cloudflare Web Analytics], aggregate and non-identifying, used solely to improve the site, never for advertising or shared with third parties. Opt out here: [link/instructions].
> - **Embedded YouTube video:** loads only when you click play, and may then set YouTube's own cookies. Don't want them? Don't press play, or read the written walkthrough, which needs none.
> We do not use advertising or profiling cookies. If that ever changes, we'll ask for your consent first.

### C. Terms of Use (light template)

> **Terms of Use.** By using VisualWalkthroughs you agree:
> - This is a free fan resource provided "as is"; walkthrough content may contain errors and we give no warranty.
> - Content is for personal use. Our original written walkthroughs are © [your name]; please don't republish them wholesale.
> - We are not affiliated with, endorsed by, or sponsored by any game publisher. All game names, box art, and trademarks belong to their respective owners.
> - We link to and embed third-party video; we're not responsible for third-party content.
> - We may change or remove content at any time. Governed by the laws of England and Wales.

### D. Takedown / IP Complaints Policy (template)

> **Takedown requests.** We respect intellectual property. If you own rights in material shown here (box art, an embedded video, or text) and want it removed, email [email] with: the specific URL, what the material is, proof you hold the rights, and your contact details. We aim to respond within [5 working days] and will remove or correct promptly where the claim is valid. (Cloudflare and YouTube also have their own notice-and-takedown processes.)

### E. Attribution & IP notice (template — sits in footer / about)

> Box art and game imagery are the property of their respective publishers, shown for identification and editorial purposes under fair-dealing principles, sourced via [IGDB]. Gameplay videos are embedded from their original creators on YouTube and remain their property; we link back to the source. Our written walkthroughs are original work. If any attribution is missing or wrong, tell us: [email].

### F. Data-Protection Complaints Procedure (template — required from 19 June 2026)

> **Complaints about your data.** If you're unhappy with how we've handled your personal data, email [email] with "Data complaint" in the subject. We will: acknowledge within [5 working days], investigate, and respond with an outcome within [30 days]. If you're still unhappy, you can complain to the Information Commissioner's Office (ico.org.uk). We keep a log of complaints and how we resolved them.

---

## 3. Practical compliance checklist

- [ ] Choose cookieless analytics; configure it aggregate-only and non-identifying.
- [ ] Keep video embeds click-to-load; add the play-time notice.
- [ ] Publish A–F above (reviewed by a solicitor) and link them in the footer.
- [ ] Set up a dedicated contact email and actually monitor it (takedowns and complaints are time-sensitive).
- [ ] Decide your stance on box art with your solicitor (identification/editorial use via IGDB is common for fan sites, but it is publishers' copyright — know your risk).
- [ ] Keep the site genuinely non-commercial, or get specific advice before adding any money-making (ads, affiliate links, donations change the picture).
- [ ] Re-review annually and whenever you add a feature that collects data.

---

## 4. Where this intersects the robot

- The **takedown email** is a human-and-solicitor job, never the agent's. The ops runbook routes it to you.
- If you act on a takedown, you (via Claude Code) **unpublish** the item — additive-only design makes that clean.
- Keep these documents in `/docs` and linked in the site footer template so every generated page carries them automatically.

> Bottom line: your design choices (cookieless analytics, click-to-load video, original writing, no ads) keep your legal burden low — but "low" isn't "none." Spend a little on a solicitor's review once, before launch. It's the cheapest insurance here.
