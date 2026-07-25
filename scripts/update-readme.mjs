// Pulls live data from the GitHub API and rewrites the auto-generated
// sections of README.md (tech stack + featured projects) in place.
// Run by .github/workflows/update-readme.yml on a schedule.

import { readFileSync, writeFileSync } from "node:fs";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

const USERNAME = process.env.GH_USERNAME || "KanwalAi";
const TOKEN = process.env.GH_TOKEN;
const README_PATH = new URL("../README.md", import.meta.url);

if (!TOKEN) {
  console.error("Missing GH_TOKEN env var — cannot call the GitHub API.");
  process.exit(1);
}

const gql = graphql.defaults({ headers: { authorization: `token ${TOKEN}` } });
const octokit = new Octokit({ auth: TOKEN });

// Maps a GitHub "language" name to a skillicons.dev icon slug.
// Extend this as new languages show up in your repos.
const LANGUAGE_TO_SKILLICON = {
  Python: "py",
  "C++": "cpp",
  "C#": "cs",
  JavaScript: "js",
  TypeScript: "ts",
  HTML: "html",
  CSS: "css",
  PHP: "php",
  Java: "java",
  Go: "go",
  Rust: "rust",
  Dart: "flutter",
  Shell: "bash",
  C: "c",
  Jupyter: "py",
};

// package manifest -> extra skillicons to surface (frameworks/tools that
// don't show up as a GitHub "language").
const MANIFEST_HINTS = [
  { file: "package.json", pattern: /"react"/, icon: "react" },
  { file: "package.json", pattern: /"next"/, icon: "next" },
  { file: "requirements.txt", pattern: /tensorflow/i, icon: "tensorflow" },
  { file: "requirements.txt", pattern: /opencv/i, icon: "opencv" },
  { file: "requirements.txt", pattern: /torch/i, icon: "pytorch" },
  { file: "package.xml", pattern: /ros/i, icon: "ros" },
  { file: "CMakeLists.txt", pattern: /catkin|ament_cmake/i, icon: "ros" },
];

async function fetchPinnedRepos() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: [REPOSITORY]) {
          nodes {
            ... on Repository {
              name
              description
              url
              stargazerCount
              updatedAt
              primaryLanguage { name }
            }
          }
        }
      }
    }
  `;
  const data = await gql(query, { login: USERNAME });
  return data.user.pinnedItems.nodes;
}

async function fetchAllRepos() {
  const repos = await octokit.paginate(octokit.repos.listForUser, {
    username: USERNAME,
    per_page: 100,
    type: "owner",
  });
  return repos.filter((r) => !r.fork && !r.archived);
}

async function detectManifestIcons(repos) {
  const found = new Set();
  for (const repo of repos.slice(0, 20)) {
    for (const hint of MANIFEST_HINTS) {
      try {
        const { data } = await octokit.repos.getContent({
          owner: USERNAME,
          repo: repo.name,
          path: hint.file,
        });
        const content = Buffer.from(data.content, "base64").toString("utf8");
        if (hint.pattern.test(content)) found.add(hint.icon);
      } catch {
        // file doesn't exist in this repo — that's fine, skip it
      }
    }
  }
  return found;
}

function buildTechStackBlock(languageIcons, manifestIcons) {
  const icons = [...new Set([...languageIcons, ...manifestIcons])];
  return [
    '<p align="center">',
    `  <img src="https://skillicons.dev/icons?i=${icons.join(",")}" />`,
    "</p>",
    "<sub>Auto-detected from public repositories via GitHub Linguist &amp; manifest scanning — see <code>scripts/update-readme.mjs</code>. Last refresh handled by the scheduled workflow.</sub>",
  ].join("\n");
}

function buildProjectsBlock(pinned) {
  const cards = pinned.map((repo) => {
    const updated = new Date(repo.updatedAt).toISOString().slice(0, 10);
    return [
      "<table><tr><td>",
      `<h3>${repo.name}</h3>`,
      `<p>${repo.description || "No description provided."}</p>`,
      `<img src="https://img.shields.io/badge/${encodeURIComponent(repo.primaryLanguage?.name || "N/A")}-4F46E5?style=flat-square" /> `,
      `<img src="https://img.shields.io/badge/⭐-${repo.stargazerCount}-FACC15?style=flat-square" /> `,
      `<img src="https://img.shields.io/badge/updated-${updated}-7C3AED?style=flat-square" />`,
      `<br/><a href="${repo.url}"><b>View Repository →</b></a>`,
      "</td></tr></table>",
    ].join("\n");
  });
  return cards.join("\n\n");
}

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1) {
    throw new Error(`Markers ${startMarker} / ${endMarker} not found in README.md`);
  }
  const before = source.slice(0, start + startMarker.length);
  const after = source.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

async function main() {
  console.log(`Fetching live GitHub data for ${USERNAME}...`);
  const [pinned, repos] = await Promise.all([fetchPinnedRepos(), fetchAllRepos()]);

  const languageIcons = new Set(
    repos
      .map((r) => LANGUAGE_TO_SKILLICON[r.language])
      .filter(Boolean)
  );
  const manifestIcons = await detectManifestIcons(repos);

  let readme = readFileSync(README_PATH, "utf8");
  readme = replaceBetween(
    readme,
    "<!--START_TECH_STACK-->",
    "<!--END_TECH_STACK-->",
    buildTechStackBlock(languageIcons, manifestIcons)
  );
  readme = replaceBetween(
    readme,
    "<!--START_PROJECTS-->",
    "<!--END_PROJECTS-->",
    buildProjectsBlock(pinned)
  );

  writeFileSync(README_PATH, readme);
  console.log("README.md updated with live tech stack + featured projects.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
