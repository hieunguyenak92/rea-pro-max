#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (typeof modulePath !== 'string' || !modulePath) throw new Error('Missing oracle module path.');
const source = readFileSync(0, 'utf8');
if (Buffer.byteLength(source, 'utf8') > 4 * 1024 * 1024) throw new Error('Oracle input exceeds 4MiB.');
const input = JSON.parse(source);
const module = await import(pathToFileURL(modulePath).href);
const resetApplied = typeof module.reset === 'function';
if (resetApplied) await module.reset();
if (typeof module.oracle !== 'function') throw new Error('The oracle module must export async oracle(sequence).');
const result = await module.oracle(input);
process.stdout.write(JSON.stringify({ result, reset_applied: resetApplied }));
