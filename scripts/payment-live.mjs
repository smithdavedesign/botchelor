// Payment proof on the live site: `npm run payment:live` (not part of `npm test`; needs Stripe in test mode).
// A fresh browser creates an account (buying needs one), lands back on the shop, clicks Buy, pays on Stripe's
// test checkout with card 4242 4242 4242 4242,
// comes back to /shop?checkout=success and waits for the webhook to add the pack's dates. Desktop and phone;
// screenshots go to docs/screenshots/payment-*.png. SITE overrides the URL; CHROMIUM_PATH the browser.
import fs from 'node:fs'
import { chromium, devices } from 'playwright-core'
const SITE = process.env.SITE || 'https://botchelor.com'
const OUT = process.argv[2] || 'docs/screenshots'
fs.mkdirSync(OUT, { recursive: true })
async function payOnStripe(page, shot) {
  await page.waitForURL(/checkout\.stripe\.com|buy\.stripe\.com/, { timeout: 30_000 })
  await page.locator('#email').waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('#email').fill('stripe-test@example.com')
  // With several payment methods, the card fields only show once "Card" is picked.
  await page.waitForLoadState('networkidle').catch(() => {})
  const cardNumber = page.locator('#cardNumber')
  for (let i = 0; i < 5 && !(await cardNumber.isVisible().catch(() => false)); i++) {
    // The accordion button is a zero-size overlay, so Playwright can't click it like a user would.
    await page.locator('[data-testid="card-accordion-item-button"]').evaluate((e) => e.click()).catch(() => {})
    await page.waitForTimeout(1500)
  }
  await cardNumber.fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Stripe Test')
  const zip = page.locator('#billingPostalCode')
  if (await zip.isVisible().catch(() => false)) await zip.fill('94107')
  // Stripe Link "save my info" would ask for a phone number; leave it unticked.
  const link = page.locator('#enableStripePass')
  if (await link.isChecked().catch(() => false)) await link.evaluate((e) => e.click())
  await shot('2-stripe-checkout')
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
  await page.waitForURL((u) => u.hostname === new URL(SITE).hostname, { timeout: 60_000 })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const sizes = { desktop: { viewport: { width: 1280, height: 800 } }, mobile: devices['iPhone 13'] }
  const results = {}
  for (const [size, options] of Object.entries(sizes)) {
    const context = await browser.newContext(options)
    const page = await context.newPage()
    const shot = (n) => page.screenshot({ path: `${OUT}/payment-${size}-${n}.png` })
    // Past the 18+ gate, then an account: the shop sends signed-out buyers to /account?next=/shop.
    await context.addCookies([{ name: 'bz_adult', value: '1', url: SITE }])
    await page.goto(`${SITE}/account?next=%2Fshop`)
    await page.locator('input[name="handle"]').fill(`paytest_${Math.random().toString(36).slice(2, 10)}`)
    await page.locator('input[name="password"]').fill(`pay-test-${Math.random().toString(36).slice(2)}`)
    await page.locator('input[name="attest"]').check()
    await page.getByRole('button', { name: /create account/i }).click()
    await page.waitForURL(/\/shop/, { timeout: 30_000 })
    // Buying needs the 18+ and terms box ticked.
    await page.getByRole('checkbox').first().check()
    const buy = page.getByRole('button', { name: /buy|\$/i }).first()
    await buy.waitFor()
    if (await buy.isDisabled()) throw new Error('Buy is disabled: no payment link in the env')
    await buy.scrollIntoViewIfNeeded()
    await shot('1-shop-buy')
    await buy.click()
    await payOnStripe(page, shot)
    // The webhook adds the dates; the success page says to refresh until it has.
    let added = false
    for (let i = 0; i < 20 && !added; i++) {
      added = await page.getByText(/pack dates?/).isVisible().catch(() => false)
      if (!added) { await page.waitForTimeout(3000); await page.reload() }
    }
    await shot('3-dates-added')
    results[size] = { added }
    console.log(size, added ? 'PACK ADDED after payment' : 'pack NOT added after 60 s')
    await context.close()
  }
  await browser.close()
  if (Object.values(results).some((r) => !r.added)) throw new Error('a payment did not add its pack')
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
