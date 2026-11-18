#!/usr/bin/env node
import { readJson } from '../skills/rea-pro-max/lib/common.mjs';
import { reviewRea69Receipt } from '../skills/rea-pro-max/lib/providers/rea-6-9.mjs';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Usage: node tools/verify-rea69.mjs SAVED_RECEIPT.json');
  console.log(JSON.stringify(reviewRea69Receipt(readJson(path)), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
