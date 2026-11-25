// Guards the page markup against class-name mix-ups that tests of the game rules can't see. Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('only bar fills use the "fill" class, so bar updates never land on an icon', () => {
  const fills = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/)).filter((c) => c.includes('fill'));
  assert.ok(fills.length >= 6);
  for (const classes of fills) assert.deepEqual(classes, ['fill'], `unexpected classes alongside "fill": ${classes.join(' ')}`);
  assert.equal(/querySelector\('\.fill'\)/.test(js), false, 'select bar fills as ".bar .fill"');
});
