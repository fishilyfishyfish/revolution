// UI 연기 테스트: node scripts/ui-smoke.cjs <url> <screenshot-prefix>
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:4173/', pre = process.argv[3] || 'out/ui';
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(url); await p.waitForTimeout(500);
  await p.click('#speeds [data-s=max]'); await p.waitForTimeout(6000);
  await p.screenshot({ path: pre + '_1.png' });
  // 개체 클릭
  const box = await p.locator('#map').boundingBox();
  for (let i = 0; i < 40; i++) { await p.mouse.click(box.x + 20 + (i * 37) % (box.width - 40), box.y + 20 + (i * 53) % (box.height - 40)); await p.waitForTimeout(30); if ((await p.locator('#tab-inspect.on').count()) > 0) break; }
  await p.waitForTimeout(800); await p.screenshot({ path: pre + '_2.png' });
  await p.click('#tabs button[data-tab=species]'); await p.waitForTimeout(1200); await p.screenshot({ path: pre + '_3.png' });
  // 운석
  await p.click('#tabs button[data-tab=graphs]'); await p.click('#toolbtns [data-tool=meteor]'); await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(1500);
  await p.click('#toolbtns [data-tool=terrain1]'); await p.mouse.move(box.x + 100, box.y + 100); await p.mouse.down(); await p.mouse.move(box.x + 200, box.y + 160, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(1500);
  await p.screenshot({ path: pre + '_4.png' });
  const snaps = await p.locator('#snaps button').count();
  console.log('snapshot buttons:', snaps);
  await p.locator('#snaps button').first().click(); await p.waitForTimeout(4000); await p.screenshot({ path: pre + '_5.png' });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
