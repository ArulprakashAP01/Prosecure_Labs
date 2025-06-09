import express from 'express';
import { createNodeMiddleware, createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = express();

const APP_ID = process.env.APP_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/\\n/g, '\n'); // multiline fix
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

app.use(express.json({ verify: verifyWebhookSignature }));

// Verify webhook signature middleware
function verifyWebhookSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    throw new Error('No X-Hub-Signature-256 found on request');
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(buf);

  const digest = 'sha256=' + hmac.digest('hex');
  if (signature !== digest) {
    throw new Error('X-Hub-Signature-256 does not match blob signature');
  }
}

// Authenticate GitHub App
async function getInstallationOctokit(installationId) {
  const auth = createAppAuth({
    appId: APP_ID,
    privateKey: PRIVATE_KEY,
    installationId,
  });
  const installationAuth = await auth({ type: 'installation' });
  return new Octokit({ auth: installationAuth.token });
}

// Helper to check outdated dependencies for npm and pip (add more if needed)
async function checkOutdatedDeps(repoDir) {
  let report = '';

  // NPM
  try {
    await execPromise('npm install', { cwd: repoDir });
    const npmOutdated = await execPromise('npm outdated --json', { cwd: repoDir });
    if (npmOutdated) {
      const outdated = JSON.parse(npmOutdated);
      if (Object.keys(outdated).length === 0) {
        report += 'NPM dependencies are up to date.\n\n';
      } else {
        report += '### NPM Outdated Dependencies:\n';
        for (const [pkg, info] of Object.entries(outdated)) {
          report += `- **${pkg}**: current ${info.current}, latest ${info.latest}\n`;
        }
        report += '\n';
      }
    }
  } catch {
    report += 'No package.json or npm not installed.\n\n';
  }

  // Python pip (if requirements.txt exists)
  try {
    const reqFile = path.join(repoDir, 'requirements.txt');
    await fs.access(reqFile);
    const pipOutdated = await execPromise('pip list --outdated --format=json', { cwd: repoDir });
    const outdatedPip = JSON.parse(pipOutdated);
    if (outdatedPip.length === 0) {
      report += 'Python pip dependencies are up to date.\n\n';
    } else {
      report += '### Python pip Outdated Dependencies:\n';
      for (const pkg of outdatedPip) {
        report += `- **${pkg.name}**: current ${pkg.version}, latest ${pkg.latest_version}\n`;
      }
      report += '\n';
    }
  } catch {
    report += 'No requirements.txt or pip not available.\n\n';
  }

  // You can add more languages (e.g., Ruby gems, composer, etc.) here similarly.

  return report || 'No dependency files found to check.';
}

// promisify exec
function execPromise(command, options) {
  return new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err) return reject(stderr || err);
      resolve(stdout.trim());
    });
  });
}

async function findExistingIssue(octokit, owner, repo) {
  const issues = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: 'dependency-check',
  });

  return issues.data.find(issue => issue.title === 'Outdated Dependencies Report');
}

async function analyzeRepo(owner, repo, cloneUrl, octokit) {
  const tmpDir = `/tmp/${repo}-${Date.now()}`;

  // Clone repo shallowly
  await execPromise(`git clone --depth=1 ${cloneUrl} ${tmpDir}`);

  // Get outdated deps report
  const report = await checkOutdatedDeps(tmpDir);

  // Find existing issue with label "dependency-check"
  const existingIssue = await findExistingIssue(octokit, owner, repo);

  if (existingIssue) {
    await octokit.issues.update({
      owner,
      repo,
      issue_number: existingIssue.number,
      body: report,
    });
  } else {
    await octokit.issues.create({
      owner,
      repo,
      title: 'Outdated Dependencies Report',
      body: report,
      labels: ['dependency-check'],
    });
  }

  // Clean up
  await execPromise(`rm -rf ${tmpDir}`);
}

app.post('/api/webhooks', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (!payload.installation) {
    return res.status(400).send('No installation information');
  }

  const installationId = payload.installation.id;
  const octokit = await getInstallationOctokit(installationId);

  // Listen for push or pull_request events
  if (event === 'push' || event === 'pull_request') {
    const repoFullName = payload.repository.full_name;
    const [owner, repo] = repoFullName.split('/');
    const cloneUrl = payload.repository.clone_url;

    try {
      await analyzeRepo(owner, repo, cloneUrl, octokit);
      res.status(200).send('Checked outdated dependencies and updated issue.');
    } catch (error) {
      console.error(error);
      res.status(500).send('Error analyzing repo');
    }
  } else {
    res.status(200).send('Event ignored');
  }
});

app.listen(PORT, () => {
  console.log(`GitHub App listening on port ${PORT}`);
});
