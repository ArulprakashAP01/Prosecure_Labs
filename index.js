import express from 'express';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function verifyWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');

  if (signature !== digest) {
    return res.status(401).send('Invalid signature');
  }
  next();
}

app.post('/api/webhooks', verifyWebhook, async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'push' || event === 'pull_request') {
    const installationId = payload.installation.id;
    const auth = createAppAuth({
      appId: process.env.APP_ID,
      privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
      installationId,
    });

    const installationAuth = await auth({ type: 'installation' });
    const octokit = new Octokit({ auth: installationAuth.token });

    const [owner, repo] = payload.repository.full_name.split('/');

    try {
      // Fetch package.json
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: 'package.json',
      });

      const content = Buffer.from(fileData.content, fileData.encoding).toString();
      const packageJson = JSON.parse(content);

      // Your outdated check logic here:
      const deps = packageJson.dependencies || {};
      const outdatedDeps = [];

      // For demo, just report all dependencies
      for (const dep in deps) {
        outdatedDeps.push(`${dep}: ${deps[dep]}`);
      }

      if (outdatedDeps.length) {
        await octokit.issues.create({
          owner,
          repo,
          title: '⚠️ Outdated Dependencies Detected',
          body: `The following dependencies are detected:\n\n${outdatedDeps.join('\n')}\n\nPlease update as needed.`,
        });
      }
    } catch (err) {
      console.error('Error handling webhook:', err);
    }
  }

  res.status(200).send('Webhook processed');
});

app.listen(PORT, () => {
  console.log(`GitHub App listening on port ${PORT}`);
});
