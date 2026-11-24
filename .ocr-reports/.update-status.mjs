// Usage: node .ocr-reports/.update-status.mjs '<json-array of {id,status,verification_notes}>'
import { readFileSync, writeFileSync } from 'node:fs';
const arg = process.argv[2];
const updates = JSON.parse(arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg);
const jp = '.ocr-reports/full-audit.json', mp = '.ocr-reports/full-audit.md';
const arr = JSON.parse(readFileSync(jp, 'utf8'));
let md = readFileSync(mp, 'utf8');
for (const u of updates) {
  const f = arr.find((x) => x.id === u.id);
  if (!f) throw new Error('no finding ' + u.id);
  if (!['fixed', 'skipped', 'reverted'].includes(u.status)) throw new Error('bad status');
  f.status = u.status;
  f.verification_notes = u.verification_notes;
  const head = `- [ ] **#${u.id} — `;
  const idx = md.indexOf(head);
  if (idx === -1) throw new Error('md entry not found for ' + u.id);
  if (u.status === 'fixed') md = md.slice(0, idx) + `- [x] **#${u.id} — ` + md.slice(idx + head.length);
  // insert status line after the category line of this entry
  const catIdx = md.indexOf('  - `', idx);
  const lineEnd = md.indexOf('\n', catIdx);
  const statusLine = `\n  - **Status:** ${u.status} — ${u.verification_notes}`;
  md = md.slice(0, lineEnd) + statusLine + md.slice(lineEnd);
}
writeFileSync(jp, JSON.stringify(arr, null, 2) + '\n');
writeFileSync(mp, md);
const done = arr.filter((f) => f.status === 'fixed').length;
const skip = arr.filter((f) => f.status === 'skipped').length;
const rev = arr.filter((f) => f.status === 'reverted').length;
console.log(`updated ${updates.length}; totals: fixed=${done} skipped=${skip} reverted=${rev} open=${arr.length - done - skip - rev}`);
