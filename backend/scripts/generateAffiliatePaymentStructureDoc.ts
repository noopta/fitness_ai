// Regenerate data/affiliate-resources/payment-structure.md from the shared
// constant in src/services/affiliatePaymentStructure.ts.
//   cd backend && npx tsx scripts/generateAffiliatePaymentStructureDoc.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPaymentStructureMarkdown } from '../src/services/affiliatePaymentStructure.js';

const out = join(process.cwd(), 'data', 'affiliate-resources', 'payment-structure.md');
writeFileSync(out, renderPaymentStructureMarkdown());
console.log(`wrote ${out}`);
