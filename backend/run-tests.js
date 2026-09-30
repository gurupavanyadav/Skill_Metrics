const { spawnSync } = require('child_process');
require('dotenv').config();

const { DATABASE_URL, TEST_DATABASE_URL } = process.env;

if (!TEST_DATABASE_URL) {
  console.error('\n❌ FATAL: TEST_DATABASE_URL environment variable is missing.');
  console.error('Please configure TEST_DATABASE_URL in your .env file to a dedicated test database.');
  process.exit(1);
}

if (TEST_DATABASE_URL === DATABASE_URL) {
  console.error('\n❌ FATAL: TEST_DATABASE_URL cannot be identical to DATABASE_URL.');
  console.error('Test execution performs destructive data cleanup and MUST use a fully isolated test database.');
  process.exit(1);
}

console.log('✅ Test database isolation verified.');
console.log(`Swapping DATABASE_URL to use TEST_DATABASE_URL...`);

// Force safe environment for the child process
const testEnv = Object.assign({}, process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL
});

// Run Jest in band with inherited stdio
const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

console.log(`Running: ${npxCmd} prisma migrate reset --force --skip-generate --skip-seed`);
const migrateResult = spawnSync(npxCmd, ['prisma', 'migrate', 'reset', '--force', '--skip-generate', '--skip-seed'], { 
  stdio: 'inherit', 
  env: testEnv,
  shell: true
});

if (migrateResult.status !== 0) {
  console.error('\n❌ FATAL: Failed to migrate test database.');
  process.exit(1);
}

const userArgs = process.argv.slice(2);
const args = ['jest', '--runInBand', ...userArgs];

console.log(`Running: ${npxCmd} ${args.join(' ')}\n`);

const result = spawnSync(npxCmd, args, { 
  stdio: 'inherit', 
  env: testEnv,
  shell: true
});

process.exit(result.status !== null ? result.status : 1);
