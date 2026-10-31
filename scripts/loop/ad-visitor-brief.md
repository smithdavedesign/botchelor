You've been given a subscriber's account on Botchelor (https://botchelor.com), a show where AI characters go on blind dates. The subscription opens After Dark, its private adult tier for fictional adult characters. Use it the way a new subscriber would on their first evening, and tell us honestly what it's like.

Your account:
- Handle: {{HANDLE}}
- Password: {{PASSWORD}}
- Sign in at https://botchelor.com/account (confirm you're 18+ at the gate, then "Already have one? Sign in"). After Dark is "🌙 After Dark" in the menu; it opens on its own host, https://ad.botchelor.com.

How to browse: you have no screen, so drive a real browser from Node. Headless Chrome is installed:
```js
import { chromium } from "{{PLAYWRIGHT}}";
const browser = await chromium.launch({ executablePath: "{{CHROME}}" });
const page = await (await browser.newContext({ userAgent: "{{UA}}", viewport: { width: 1280, height: 900 } })).newPage();
```
Keep that user agent: the site treats "HeadlessChrome", curl and scripts as bots and hides After Dark from them. Save screenshots (`page.screenshot`) and read them back with the Read tool to see the pages. Read the page text too. A script that keeps one browser open and takes commands is easier than starting over each time, but either works.

Rules:
- Use only botchelor.com and ad.botchelor.com. Don't read any source code on this machine and don't use the web.
- Keep all your scratch files (scripts, notes, screenshots) in your own folder, the current directory: {{DIR}}. Never anywhere else, and never read other folders.
- Don't change anything else on the machine, and don't change the account's password or settings that lock it (the PIN).
- The account has a small allowance of tokens. Spend them on what a subscriber would: scenes, steering, pictures. Don't buy anything.
- Take your time. You have about {{MINUTES}} minutes, until about {{UNTIL}} (`date` tells you the time). Stay at least {{MIN_MINUTES}} minutes: don't write the report before {{NOT_BEFORE}}.
- Try more than one pair, steer at least one scene, and look at what the pictures, the gallery and the settings offer.

When you're done, write a report. Start it with one line, `Model: <the model you run on, as exactly as you know it>`, then these sections:
1. What you expected After Dark to be, and what it is.
2. What you did, in order (briefly).
3. What worked well: the writing, the characters, the pictures, the controls.
4. What confused you, blocked you or failed (quote error messages, name the page).
5. Writing quality: did the characters stay themselves, answer each other, and avoid repeating? Quote a good line and a bad one.
6. Pictures and video: did they match the scene and the characters? Anything that looked wrong or unsafe?
7. A rating out of 10 for After Dark overall, and why.
8. A separate rating out of 10 for how easy it was to use (finding things, the theater, steering, settings). Say what would make it a 10.
9. Would you keep paying $12.99 a month? Why or why not?
10. Your suggestions, most important first.
