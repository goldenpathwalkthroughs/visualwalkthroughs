# VisualWalkthroughs — Nightly Queue

The pipeline reads this file each night to decide what to build.
Put the game you want built in the **TONIGHT** section and save.
The Content Advisor shortlist in each nightly report tells you what to pick.

---

## TONIGHT

<!-- One game per night (see pipeline.config.json → gamesPerNight).
     Fill in all fields and save before the nightly run. -->

```
game:      
franchise: 
slug:      
year:      
platforms: 
```

**Example:**
```
game:      Ocarina of Time
franchise: zelda
slug:      ocarina-of-time
year:      1998
platforms: N64, GameCube, 3DS
```

Add `allowReplace: true` on a new line inside the block to permit overwriting an existing guide.

---

## COMING UP (your backlog — the pipeline ignores this section)

<!-- Add games here as the Content Advisor suggests them.
     Move one to TONIGHT when you're ready to build it. -->

- 

---

## DONE (the pipeline appends here after each successful publish)

- Wind Waker HD — published 2026-06-06
