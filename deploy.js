// Publishes your latest changes to GitHub. GitHub Pages then updates the website automatically (about 1 minute).
// Run: npm run deploy            (or: npm run deploy -- "what I changed")
const { execSync } = require('child_process');

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

let remote;
try {
  remote = out('git remote get-url origin');
} catch {
  console.error('This folder is not connected to GitHub yet (no "origin" remote). See PUBLISHING.md.');
  process.exit(1);
}

run('git add -A');
if (out('git status --porcelain')) {
  const message = process.argv.slice(2).join(' ') || `Update Flugtag Lab (${new Date().toLocaleString()})`;
  run(`git commit -m ${JSON.stringify(message)}`);
} else {
  console.log('No new changes to commit — pushing anything not yet on GitHub.');
}
run('git push -u origin main');

const m = remote.match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
if (m) {
  console.log(`\nPushed. GitHub Pages usually updates within about a minute:\n  https://${m[1].toLowerCase()}.github.io/${m[2]}/`);
  console.log(`Build status: https://github.com/${m[1]}/${m[2]}/actions`);
}
