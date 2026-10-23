// Live end-to-end check against the deployed site: `npm run e2e:live` (SITE defaults to https://botchelor.com).
// What a real visitor does, in a real browser: the 18+ gate, a Stripe TEST purchase paid with the test card and
// granted by the webhook, a character and a real date (one paid-model date, a few cents), a prediction and a
// rating (undone), a password account, the agent (MCP) endpoint and the public pages. Desktop, plus a phone pass.
// The test character also swipes: a like on a house character is a match, and its chat comes in on the free model.
//
// The purchase needs Stripe in test mode, and on production STRIPE_ALLOW_TEST_LINK=1 (lib/stripe.ts hides a test-mode
// link from real buyers there). On a live link it stops at Stripe's page and never pays: the step is skipped. Analytics requests are blocked so the run doesn't count as traffic, the test date is private,
// and the test visitor and account are deleted at the end (DELETE /api/me). Screenshots: docs/screenshots/live-*.png.
// RESOLVE=<ip> maps the site's host (and www.) to that IP: a stale local DNS cache right after a domain change.
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { chromium, devices } from 'playwright-core'

const SITE = (process.env.SITE || 'https://botchelor.com').replace(/\/$/, '')
const HOST = new URL(SITE).hostname
const OUT = process.argv[2] || 'docs/screenshots'
fs.mkdirSync(OUT, { recursive: true })
const args = process.env.RESOLVE ? [`--host-resolver-rules=MAP ${HOST} ${process.env.RESOLVE},MAP www.${HOST} ${process.env.RESOLVE}`] : []
const ANALYTICS = /google-analytics\.com|googletagmanager\.com|repohq\.vercel\.app\/api\/ideas\/signal/
// A person's browser: headless Chromium says "HeadlessChrome", which lib/bots.ts lets past the gate as a bot.
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const ok = (status) => status >= 200 && status < 300

const results = []
class Skip extends Error {}
async function step(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (e) {
    if (e instanceof Skip) {
      results.push({ name, ok: true, skipped: true })
      console.log(`○ ${name}: skipped, ${e.message}`)
      return
    }
    results.push({ name, ok: false })
    console.log(`✗ ${name}: ${e.message}`)
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

/** JSON over the browser's own network stack (same-origin cookies, the RESOLVE mapping). */
async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const res = await fetch(p, { method: m, headers: b === undefined ? {} : { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
    let data = null
    try { data = await res.json() } catch { /* not JSON */ }
    return { status: res.status, data }
  }, [method, path, body])
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({ userAgent: CHROME, ...options })
  await context.route(ANALYTICS, (route) => route.abort())
  return context
}

async function passGate(page, path) {
  await page.goto(SITE + path)
  if (new URL(page.url()).pathname === '/gate') {
    await page.locator('.age-gate-enter').click()
    await page.waitForURL((u) => u.pathname !== '/gate')
  }
}

async function payOnStripe(page, shot) {
  await page.waitForURL(/checkout\.stripe\.com|buy\.stripe\.com/, { timeout: 30_000 })
  await page.locator('#email').waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('#email').fill('stripe-test@example.com')
  const cardNumber = page.locator('#cardNumber')
  for (let i = 0; i < 5 && !(await cardNumber.isVisible().catch(() => false)); i++) {
    await page.locator('[data-testid="card-accordion-item-button"]').evaluate((e) => e.click()).catch(() => {})
    await page.waitForTimeout(1500)
  }
  await cardNumber.fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Stripe Test')
  const zip = page.locator('#billingPostalCode')
  if (await zip.isVisible().catch(() => false)) await zip.fill('94107')
  const link = page.locator('#enableStripePass')
  if (await link.isChecked().catch(() => false)) await link.evaluate((e) => e.click())
  await shot('stripe-checkout')
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
  await page.waitForURL((u) => u.hostname === HOST, { timeout: 60_000 })
}

const toppedUp = async (page) => Number((/plus (\d+) topped up/.exec(await page.locator('.token-balance').innerText()) ?? [0, 0])[1])

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args })
  const desktop = await newContext(browser, { viewport: { width: 1280, height: 860 } })
  const page = await desktop.newPage()
  const shot = (n) => page.screenshot({ path: `${OUT}/live-desktop-${n}.png` })
  let episodeId = null
  let houseIds = []
  let characterId = null

  await step('18+ gate, then the page you asked for', async () => {
    await page.goto(SITE + '/shop')
    must(new URL(page.url()).pathname === '/gate', `expected the gate, got ${page.url()}`)
    await shot('gate')
    await page.locator('.age-gate-enter').click()
    await page.waitForURL((u) => u.pathname === '/shop')
    return 'gate → /shop'
  })

  await step('public pages and agent docs answer 200', async () => {
    const paths = ['/', '/create', '/feed', '/matches', '/cast', '/watch', '/swipe', '/shop', '/agents', '/privacy', '/terms', '/reunion', '/llms.txt', '/sitemap.xml', '/robots.txt', '/.well-known/mcp.json', '/api/health']
    const bad = []
    for (const p of paths) {
      const r = await page.evaluate(async (u) => { const res = await fetch(u); return { status: res.status, url: res.url } }, p)
      if (r.status !== 200) bad.push(`${p} ${r.status}`)
    }
    must(!bad.length, bad.join(', '))
    const canonical = await page.evaluate(() => document.querySelector('link[rel=canonical]')?.getAttribute('href') ?? '')
    return `${paths.length} paths; canonical ${canonical || '(none on /shop)'}`
  })

  await step('Stripe test purchase: pay with the test card, the webhook adds 5 dates', async () => {
    await page.goto(SITE + '/shop')
    // Buying needs an account (since 2026-10-15): the test visitor makes a throwaway one, deleted with it at the end.
    if (await page.getByText('Sign in to buy').count()) {
      const handle = `e2e${randomBytes(4).toString('hex')}`
      const reg = await api(page, 'POST', '/api/auth/register', { handle, password: ['e2e', 'live', randomBytes(6).toString('hex')].join('-'), attest: true })
      must(ok(reg.status), `register ${reg.status} ${JSON.stringify(reg.data)?.slice(0, 160)}`)
      await page.goto(SITE + '/shop')
    }
    const before = await toppedUp(page)
    await page.locator('input[name="attest"]').check()
    const buy = page.getByRole('button', { name: /buy/i }).first()
    must(!(await buy.isDisabled()), 'Buy is disabled (no live link, or STRIPE_ALLOW_TEST_LINK unset on production)')
    await shot('shop')
    await buy.click()
    await page.waitForURL(/checkout\.stripe\.com|buy\.stripe\.com/, { timeout: 30_000 })
    // Only ever pay a test-mode checkout: a live one would charge a real card (the test card is declined there anyway).
    if (!/buy\.stripe\.com\/test_|\/c\/pay\/cs_test_/.test(page.url())) {
      await shot('stripe-checkout-live')
      throw new Skip('the shop sells through a live Payment Link, so this run stops at Stripe\'s page')
    }
    await payOnStripe(page, shot)
    must(page.url().includes('checkout=success'), `came back to ${page.url()}`)
    let after = before
    for (let i = 0; i < 20 && after < before + 5; i++) {
      await page.waitForTimeout(3000)
      await page.reload()
      after = await toppedUp(page)
    }
    await shot('tokens-added')
    must(after === before + 5, `topped-up dates ${before} → ${after}`)
    return `topped up ${before} → ${after}`
  })

  await step('create a character and go on a real date (private)', async () => {
    await page.goto(SITE + '/create')
    houseIds = [...new Set((await page.content()).match(/house-[a-z]+(?:-[a-z]+)?/g) ?? [])]
    const made = await api(page, 'POST', '/api/characters', {
      name: 'Wren Kestrel', age: 31, bio: 'A lighthouse keeper who collects other people\'s postcards.',
      traits: ['dry', 'patient', 'curious'], want: 'Someone who writes back', dealbreaker: 'People who never ask questions', attest: true, keep_name: true,
      // A dating profile, so it can swipe (closed to dates, so it never shows in a real person's deck).
      extras: {
        hobbies: ['Postcards', 'Night walks'],
        prompts: [{ id: 'simple_pleasures', answer: 'A postcard from someone I have never met.' }, { id: 'win_me_over', answer: 'Write back. Any length.' }],
      },
    })
    must(ok(made.status), `create character: ${made.status} ${JSON.stringify(made.data)?.slice(0, 200)}`)
    let started = null
    for (const partner of houseIds) {
      started = await api(page, 'POST', '/api/episodes', { character_id: made.data.id, partner_id: partner, visibility: 'private' })
      if (started.status !== 422) break
    }
    must(started && ok(started.status), `start date: ${started?.status} ${JSON.stringify(started?.data)?.slice(0, 200)}`)
    episodeId = started.data.id
    characterId = made.data.id
    console.log(`  test character ${made.data.id}, test date ${episodeId} (private)`)
    let ep = started.data
    for (let i = 0; i < 60 && ep.status !== 'ready'; i++) {
      await page.waitForTimeout(5000)
      ep = (await api(page, 'GET', `/api/episodes/${episodeId}`)).data
    }
    must(ep.status === 'ready', `episode still ${ep.status} after 5 minutes`)
    await page.goto(`${SITE}/episodes/${episodeId}`)
    await shot('episode')
    return `${made.data.name} × ${ep.characters?.[1]?.name ?? 'house'}: ${ep.ending ?? 'ready'}, ${ep.transcript?.length ?? 0} lines`
  })

  await step('swipe: a like on a house character is a match, and the two start texting (free model)', async () => {
    must(characterId, 'no test character (the date step failed)')
    const deck = await api(page, 'GET', `/api/swipes?character_id=${characterId}`)
    must(deck.status === 200, `deck ${deck.status} ${JSON.stringify(deck.data)?.slice(0, 160)}`)
    const house = deck.data.cards.find((c) => c.house)
    must(house, `no house character in the deck (${deck.data.cards.length} cards)`)
    const liked = await api(page, 'POST', '/api/swipes', { character_id: characterId, target_id: house.id, like: true })
    must(liked.status === 200 && liked.data?.match, `swipe ${liked.status} ${JSON.stringify(liked.data)?.slice(0, 160)}`)
    const pair = [characterId, house.id].sort().join('/')
    let items = []
    for (let i = 0; i < 20 && !items.some((x) => x.kind === 'text'); i++) {
      await page.waitForTimeout(3000)
      items = (await api(page, 'GET', `/api/couples/${pair}/texts`)).data?.items ?? []
    }
    must(items[0]?.kind === 'event' && items[0]?.event === 'matched', `the thread should open with the match (${items.map((x) => x.event ?? x.kind).join(',')})`)
    must(items.some((x) => x.kind === 'text'), 'the opening chat never came in')
    await page.goto(`${SITE}/couples/${pair}`)
    await page.locator('.match-state').waitFor({ timeout: 15_000 })
    await shot('swipe-match')
    return `${house.name}: ${items.map((x) => x.event ?? x.kind).join(', ')}`
  })

  await step('Matches lists the match, it opens the thread only, and on a phone the deck is the whole screen', async () => {
    must(characterId, 'no test character (the date step failed)')
    await page.goto(`${SITE}/matches?character=${characterId}`)
    const row = page.locator('.matches-row, .matches-face').first()
    await row.waitFor({ timeout: 15_000 })
    await shot('matches')
    await row.click()
    await page.waitForURL(/\/messages\//)
    await page.locator('#texts .phone-messages').waitFor({ timeout: 15_000 })
    must((await page.locator('.couple-head').count()) === 0, 'the thread page should show the thread only')
    await shot('messages')
    const thread = new URL(page.url())
    const phone = await newContext(browser, { ...devices['iPhone 13'], userAgent: devices['iPhone 13'].userAgent, storageState: await desktop.storageState() })
    const p = await phone.newPage()
    for (const [name, path, ready] of [
      ['matches', `/matches?character=${characterId}`, '.matches-row, .matches-face'],
      ['messages', thread.pathname + thread.search, '#texts .phone-messages'],
      ['swipe', `/swipe?character=${characterId}`, '.swipe-topbar'],
    ]) {
      await p.goto(SITE + path)
      await p.locator(ready).first().waitFor({ timeout: 15_000 })
      if (name !== 'matches') must(!(await p.locator('.site-header').isVisible()), `${name} on a phone should hide the site header`)
      await p.screenshot({ path: `${OUT}/live-mobile-${name}.png` })
    }
    await phone.close()
    const feed = await page.goto(`${SITE}/feed`)
    must(new URL(page.url()).pathname === '/watch' && feed?.ok(), `/feed should land on /watch (${page.url()})`)
    return `thread ${thread.pathname}`
  })

  await step('predict a public date and rate a character (rating undone)', async () => {
    const feed = await api(page, 'GET', '/api/episodes')
    const list = Array.isArray(feed.data) ? feed.data : feed.data?.episodes ?? []
    let predicted = null
    for (const e of list) {
      if (e.id === episodeId || e.is_creator || e.revealed) continue
      const r = await api(page, 'POST', '/api/predictions', { episode_id: e.id, pick: 'friends' })
      if (ok(r.status)) { predicted = e.id; break }
    }
    must(predicted, 'no open public date accepted a prediction')
    const house = houseIds[0]
    const on = await api(page, 'POST', `/api/characters/${house}/ratings`, { category: 'likable' })
    const off = await api(page, 'POST', `/api/characters/${house}/ratings`, { category: 'likable' })
    must(ok(on.status) && ok(off.status) && on.data?.rated === true && off.data?.rated === false, `rating ${on.status}/${off.status} ${JSON.stringify(on.data)?.slice(0, 80)}`)
    return `predicted ${predicted.slice(0, 8)}…, rated and unrated ${house}`
  })

  await step('password account: register, sign out, sign in, delete', async () => {
    const ctx = await newContext(browser)
    const p = await ctx.newPage()
    await passGate(p, '/')
    const handle = 'e2e' + randomBytes(3).toString('hex')
    const password = randomBytes(12).toString('base64url')
    const reg = await api(p, 'POST', '/api/auth/register', { handle, password, attest: true })
    must(ok(reg.status), `register ${reg.status} ${JSON.stringify(reg.data)?.slice(0, 160)}`)
    must(ok((await api(p, 'POST', '/api/auth/logout', {})).status), 'logout')
    const login = await api(p, 'POST', '/api/auth/login', { handle, password })
    must(ok(login.status), `login ${login.status}`)
    const me = await api(p, 'GET', '/api/me')
    must(me.data?.account?.handle?.toLowerCase() === handle, `me: ${JSON.stringify(me.data?.account)}`)
    const del = await api(p, 'DELETE', '/api/me', { confirm: true })
    must(ok(del.status), `delete ${del.status}`)
    await ctx.close()
    return `${handle} registered, signed back in, deleted`
  })

  await step('agents: MCP initialize, tools/list, browse_episodes', async () => {
    const r = await page.evaluate(async () => {
      const post = (body, sid) => fetch('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) })
      const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'botchelor-e2e-live', version: '1' } } })
      const sid = init.headers.get('mcp-session-id')
      const tools = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid)).json()
      const browse = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'browse_episodes', arguments: {} } }, sid)).json()
      return { init: init.status, tools: (tools.result?.tools ?? []).map((t) => t.name), browseError: browse.result?.isError ?? Boolean(browse.error) }
    })
    must(r.init === 200 && r.tools.includes('go_on_date') && !r.browseError, JSON.stringify(r).slice(0, 200))
    return `${r.tools.length} tools`
  })

  await step('phone: home, watch, shop and a public episode render', async () => {
    const ctx = await newContext(browser, devices['iPhone 13'])
    const p = await ctx.newPage()
    await passGate(p, '/')
    await p.screenshot({ path: `${OUT}/live-mobile-home.png` })
    await p.goto(SITE + '/watch')
    await p.screenshot({ path: `${OUT}/live-mobile-watch.png` })
    const href = await p.locator('a[href^="/episodes/"]').first().getAttribute('href')
    await p.goto(SITE + '/shop')
    await p.screenshot({ path: `${OUT}/live-mobile-shop.png` })
    if (href) {
      await p.goto(SITE + href)
      await p.screenshot({ path: `${OUT}/live-mobile-episode.png` })
    }
    await ctx.close()
    return href ? `episode ${href}` : 'no public episode linked from the feed'
  })

  await step('clean up: the test visitor and its data are deleted', async () => {
    await page.goto(SITE + '/')
    await shot('home')
    const del = await api(page, 'DELETE', '/api/me', { confirm: true })
    must(ok(del.status), `delete ${del.status} ${JSON.stringify(del.data)?.slice(0, 160)}`)
    return JSON.stringify(del.data).slice(0, 160)
  })

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped).length
  console.log(`\n${results.length - failed.length - skipped}/${results.length} passed${skipped ? `, ${skipped} skipped` : ''} on ${SITE}`)
  if (failed.length) process.exit(1)
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
