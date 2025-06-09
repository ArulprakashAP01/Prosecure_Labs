import express from 'express';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';
import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();

const {
  APP_ID,
  PRIVATE_KEY,
  WEBHOOK_SECRET,
  PORT = 3000
} = process.env;

// Setup Octokit with JWT auth for your GitHub App
function getAppOctokit() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + (10 * 60),
    iss: APP_ID
  };
  const token = jwt.sign(payload, PRIVATE_KEY.replace(/\\n/g, '\n'), { algorithm: 'RS256' });
  return new Octokit({ auth: token });
}

// Run a shell command in a directory, return stdout as Promise
function runCmd(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      resolve(stdout);
    });
  });
}

// Check if file exists (sync)
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// Parse npm outdated output
async function checkNpm(repoDir) {
  if (!fileExists(path.join(repoDir, 'package.json'))) return null;
  try {
    const out = await runCmd('npm outdated --json', repoDir);
    return JSON.parse(out || '{}');
  } catch {
    return null;
  }
}

// Parse pip outdated output
async function checkPython(repoDir) {
  if (!fileExists(path.join(repoDir, 'requirements.txt'))) return null;
  try {
    const out = await runCmd('pip list --outdated --format=json', repoDir);
    return JSON.parse(out || '[]');
  } catch {
    return null;
  }
}

// Main handler
async function analyzeRepo(owner, repo, cloneUrl, installationOctokit) {
  const tmpDir = path.join('/tmp', `repo-${Date.now()}`);

  // Clone the repo
  const git = simpleGit();
  await git.clone(cloneUrl, tmpDir);

  // Check outdated
  const npmOutdated = await checkNpm(tmpDir);
  const pyOutdated = await checkPython(tmpDir);

  // Compose issue body
  let body = `# Outdated Dependencies Report\n\n`;

  if (npmOutdated && Object.keys(npmOutdated).length > 0) {
    body += `## npm packages:\n`;
    for (const [pkg, info] of Object.entries(npmOutdated)) {
      body += `- **${pkg}**: current ${info.current}, latest ${info.latest}\n`;
    }
  } else {
    body += 'No outdated npm packages found.\n';
  }

  if (pyOutdated && pyOutdated.length > 0) {
    body += `\n## Python packages:\n`;
    pyOutdated.forEach(pkg => {
      body += `- **${pkg.name}**: current ${pkg.version}, latest ${pkg.latest_version}\n`;
    });
  } else {
    body += '\nNo outdated Python packages found.\n';
  }

  // Cleanup cloned repo
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Create a GitHub issue
  await installationOctokit.issues.create({
    owner,
    repo,
    title: 'Outdated Dependencies Report',
    body,
  });
}

const webhooks = new Webhooks({
  secret: WEBHOOK_SECRET,
});

webhooks.on(['push', 'pull_request'], async ({ id, name, payload }) => {
  console.log(`Received event ${name} for repo ${payload.repository.full_name}`);

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const cloneUrl = payload.repository.clone_url;

  try {
    // Authenticate as app installation
    const appOctokit = getAppOctokit();
    const installations = await appOctokit.apps.listInstallationsForAuthenticatedUser();
    const installationId = payload.installation?.id;

    // Get installation token
    const installationOctokit = new Octokit({
      authStrategy: Octokit.plugin(),
      auth: async () => {
        const tokenResponse = await appOctokit.request('POST /app/installations/{installation_id}/access_tokens', {
          installation_id: installationId,
        });
        return tokenResponse.data.token;
      },
    });

    await analyzeRepo(owner, repo, cloneUrl, installationOctokit);
  } catch (error) {
    console.error('Error handling webhook:', error);
  }
});

app.use(createNodeMiddleware(webhooks));

app.listen(PORT, () => {
  console.log(`GitHub App listening on port ${PORT}`);
});
