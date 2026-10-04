import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'Absolute workspace required');
const project = path.resolve(process.argv[2]);
const { createServer } = await import(pathToFileURL(path.join(project, 'server.js')).href);
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/servicios', '/proyectos', '/contacto']) {
      const response = await page.goto(url + route);
      assert.equal(response.status(), 200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Overflow ${route} at ${width}`);
      assert.equal(await page.locator('h1').count(), 1);
    }
    checks.push(`Four routes, no horizontal overflow at ${width}px`);
  }
  await page.goto(url + '/proyectos');
  const all = await page.locator('#proyectos-grid article').count();
  assert.ok(all > 1);
  await page.locator('[data-categoria="mezcla"]').click();
  const filtered = await page.locator('#proyectos-grid article').count();
  assert.ok(filtered > 0 && filtered < all);
  checks.push(`Filter changed ${all} cards to ${filtered}`);
  await page.goto(url + '/contacto');
  await page.locator('button[type="submit"]').click();
  assert.equal(await page.locator('[aria-invalid="true"]').count(), 5);
  await page.locator('#nombre').fill('Prueba QA');
  await page.locator('#email').fill('qa@example.com');
  await page.locator('#servicio').selectOption('mezcla');
  await page.locator('#mensaje').fill('Prueba de validación local del formulario completo.');
  await page.locator('#privacidad').check();
  await page.locator('button[type="submit"]').click();
  await page.locator('#enviar-otro').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#formulario-contacto').isVisible(), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('salieri-mensaje')).nombre), 'Prueba QA');
  await page.locator('#enviar-otro').click();
  assert.equal(await page.locator('#nombre').inputValue(), '');
  checks.push('Five validation errors, local confirmation, stored message and form reset');
  assert.deepEqual(errors, []);
  await writeFile(path.join(project, '.codeclub-qa', 'independent.json'), JSON.stringify({ checks, errors, completedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ independentVerification: true, checks }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
