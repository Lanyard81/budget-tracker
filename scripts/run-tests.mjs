// Run the same test suite as tests.html in Node: node scripts/run-tests.mjs
import { runTests } from '../js/tests-core.js';

const results = runTests();
const failed = results.filter((r) => !r.ok);
failed.forEach((r) => console.error('FAIL', r.name, '-', r.detail));
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
