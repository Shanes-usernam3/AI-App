"""Browser end-to-end test. Run: python3 tests/e2e.py  (needs `pip install playwright` + a Chrome/Chromium)."""
import http.server, threading, functools, os, sys, shutil
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.join(os.path.dirname(__file__), '..', 'src')
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_port}/'
chrome = shutil.which('google-chrome') or shutil.which('chromium')
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    ctx = b.new_context(viewport={'width': 400, 'height': 860})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL)

    # Create a group and add people
    pg.fill('[data-form=new-group] input', 'Roommates')
    pg.click('[data-form=new-group] button')
    for n in ['Shane', 'Alex', 'Jo']:
        pg.fill('[data-form=add-member] input', n); pg.press('[data-form=add-member] input', 'Enter')
    expect(pg.locator('#view .list li')).to_have_count(3)
    pg.fill('[data-form=add-member] input', 'alex'); pg.press('[data-form=add-member] input', 'Enter')
    expect(pg.locator('#toast')).to_contain_text('already')

    # Expense split equally: Shane pays $90
    pg.click('[data-tab=expenses]'); pg.click('#fab')
    pg.fill('#expenseForm [name=description]', 'Internet'); pg.fill('[name=amount]', '90')
    expect(pg.locator('#splitPreview')).to_contain_text('3 people')
    pg.click('#expenseForm .primary')
    expect(pg.locator('#view')).to_contain_text('Internet')

    # Validation shows an error and keeps dialog open
    pg.click('#fab'); pg.fill('#expenseForm [name=description]', 'Bad'); pg.fill('[name=amount]', 'abc')
    pg.click('#expenseForm .primary')
    expect(pg.locator('#expenseError')).to_contain_text('valid amount')
    pg.click('#expenseForm .ghost')

    # Expense by shares: Alex pays $60, Alex 2 shares, Jo 1, Shane excluded
    pg.click('#fab'); pg.fill('#expenseForm [name=description]', 'Groceries'); pg.fill('[name=amount]', '60')
    pg.select_option('[name=paidBy]', label='Alex')
    pg.click('.seg [data-mode=shares]')
    rows = pg.locator('.split-row')
    rows.nth(0).locator('input[type=checkbox]').uncheck()
    rows.nth(1).locator('input[type=number]').fill('2')
    expect(rows.nth(1).locator('.amt')).to_have_text('$40.00')
    pg.click('#expenseForm .primary')
    expect(pg.locator('.stat .amt')).to_have_text('$150.00')

    # Balances: Shane +60, Alex 60-30-40=-10, Jo -30-20=-50
    pg.click('[data-tab=balances]')
    txt = pg.inner_text('#view')
    assert 'gets back' in txt and '$60.00' in txt and '$10.00' in txt and '$50.00' in txt, txt

    # Settle everything
    while pg.locator('[data-action=settle]').count():
        pg.locator('[data-action=settle]').first.click()
    expect(pg.locator('#view')).to_contain_text('Everyone is square')

    # Persistence across reload
    pg.reload()
    expect(pg.locator('#title')).to_have_text('Roommates')
    expect(pg.locator('#view')).to_contain_text('Everyone is square')

    # Back home, sample group works
    pg.click('#backBtn')
    expect(pg.locator('.group-link')).to_have_count(1)
    pg.evaluate("localStorage.clear()"); pg.reload()
    pg.click('[data-action=demo]')
    expect(pg.locator('[data-action=settle]').first).to_be_visible()
    pg.screenshot(path='/tmp/tabby-balances.png', full_page=True)

    # Offline: service worker serves the app with network cut
    pg.evaluate("navigator.serviceWorker.ready")
    pg.reload(); pg.wait_for_timeout(500)
    ctx.set_offline(True)
    pg.reload()
    expect(pg.locator('#title')).to_contain_text('Cabin weekend')
    ctx.set_offline(False)
    b.close()

srv.shutdown()
if errors: sys.exit('Page errors: ' + '; '.join(errors))
print('E2E OK')
