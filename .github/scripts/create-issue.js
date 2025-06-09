const fs = require("fs");
const { Octokit } = require("@octokit/rest");

const token = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: token });

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

async function run() {
  const data = JSON.parse(fs.readFileSync("outdated.json", "utf8"));

  if (Object.keys(data).length === 0) {
    console.log("✅ No outdated dependencies.");
    return;
  }

  let body = "### 🔧 Outdated Dependencies Detected\n\n";
  body += "| Package | Current | Wanted | Latest |\n";
  body += "|---------|---------|--------|--------|\n";

  for (const [pkg, info] of Object.entries(data)) {
    body += `| ${pkg} | ${info.current} | ${info.wanted} | ${info.latest} |\n`;
  }

  // Find existing issue
  const issues = await octokit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    labels: "dependencies",
  });

  const existing = issues.data.find(issue => issue.title === "📦 Outdated Dependencies Report");

  if (existing) {
    await octokit.issues.update({
      owner,
      repo,
      issue_number: existing.number,
      body,
    });
    console.log("✏️ Updated existing issue.");
  } else {
    await octokit.issues.create({
      owner,
      repo,
      title: "📦 Outdated Dependencies Report",
      body,
      labels: ["dependencies"],
    });
    console.log("🆕 Created new issue.");
  }
}

run().catch(err => {
  console.error("❌ Error running script:", err);
  process.exit(1);
});
