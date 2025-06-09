// .github/scripts/create-issue.mjs

import { Octokit } from "@octokit/rest";

// Pull repo info from GitHub Actions environment
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "ArulprakashAP01/Prosecure_Labs").split("/");
const token = process.env.GITHUB_TOKEN;

// Initialize Octokit
const octokit = new Octokit({ auth: token });

// Dummy outdated packages list (replace this with your logic)
const outdatedPackages = [
  "lodash@4.17.15 → 4.17.21",
  "express@4.16.0 → 4.18.2"
];

// If outdated dependencies found, create a GitHub Issue
if (outdatedPackages.length > 0) {
  const issueTitle = "⚠️ Outdated Dependencies Detected";
  const issueBody = `The following dependencies are outdated:\n\n${outdatedPackages.map(pkg => `- ${pkg}`).join("\n")}`;

  try {
    await octokit.issues.create({
      owner,
      repo,
      title: issueTitle,
      body: issueBody,
    });
    console.log("✅ Issue created successfully.");
  } catch (err) {
    console.error("❌ Failed to create issue:", err.message);
    process.exit(1);
  }
} else {
  console.log("🎉 No outdated dependencies found.");
}
