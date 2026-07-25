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

const MANIFEST_HINTS = [
  { file: "package.json", pattern: /"react"/, icon: "react" },
  { file: "package.json", pattern: /"next"/, icon: "next" },
  { file: "requirements.txt", pattern: /tensorflow/i, icon: "tensorflow" },
  { file: "requirements.txt", pattern: /opencv/i, icon: "opencv" },
  { file: "requirements.txt", pattern: /torch/i, icon: "pytorch" },
  { file: "package.xml", pattern: /ros/i, icon: "ros" },
  { file: "CMakeLists.txt", pattern: /catkin|ament_cmake/i, icon: "ros" },
  { file: "package.json", pattern: /"tailwindcss"/, icon: "tailwind" },
  { file: "package.json", pattern: /"fastapi"/, icon: "fastapi" },
  { file: "package.json", pattern: /"express"/, icon: "nodejs" },
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
              homepageUrl
              stargazerCount
              updatedAt
              primaryLanguage { name }
              repositoryTopics(first: 6) {
                nodes {
                  topic {
                    name
                  }
                }
              }
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
  
  // Map technologies to names and categories
  const techMap = {
    py: { name: "Python", category: "Languages" },
    js: { name: "JavaScript", category: "Languages" },
    ts: { name: "TypeScript", category: "Languages" },
    cpp: { name: "C++", category: "Languages" },
    cs: { name: "C#", category: "Languages" },
    c: { name: "C", category: "Languages" },
    php: { name: "PHP", category: "Languages" },
    java: { name: "Java", category: "Languages" },
    go: { name: "Go", category: "Languages" },
    rust: { name: "Rust", category: "Languages" },
    html: { name: "HTML", category: "Languages" },
    css: { name: "CSS", category: "Languages" },
    bash: { name: "Bash", category: "Languages" },
    react: { name: "React", category: "Frontend" },
    next: { name: "Next.js", category: "Frontend" },
    tailwind: { name: "Tailwind", category: "Frontend" },
    vue: { name: "Vue", category: "Frontend" },
    nodejs: { name: "Node.js", category: "Backend" },
    fastapi: { name: "FastAPI", category: "Backend" },
    tensorflow: { name: "TensorFlow", category: "AI / ML" },
    opencv: { name: "OpenCV", category: "AI / ML" },
    pytorch: { name: "PyTorch", category: "AI / ML" },
    ros: { name: "ROS", category: "Embedded & Robotics" },
    arduino: { name: "Arduino", category: "Embedded & Robotics" },
    git: { name: "Git", category: "Tools & DevOps" },
    docker: { name: "Docker", category: "Tools & DevOps" },
    cmake: { name: "CMake", category: "Tools & DevOps" },
  };

  // Group icons by category
  const groups = {};
  icons.forEach((icon) => {
    const tech = techMap[icon];
    if (tech) {
      if (!groups[tech.category]) groups[tech.category] = [];
      groups[tech.category].push({ icon, name: tech.name });
    }
  });

  // Define order of categories
  const categoryOrder = ["Languages", "Frontend", "Backend", "AI / ML", "Embedded & Robotics", "Tools & DevOps"];
  
  const sections = categoryOrder
    .map((category) => {
      if (!groups[category] || groups[category].length === 0) return null;
      
      const techs = groups[category];
      const cols = techs.length;
      const cols_header = Array(cols).fill(0).map(() => "|").join(" ");
      const cols_sep = Array(cols).fill(0).map(() => "|---|").join("");
      const icons_row = techs.map((t) => `<img src="https://skillicons.dev/icons?i=${t.icon}" />`).join(" | ");
      const names_row = techs.map((t) => t.name).join(" | ");
      
      return `**${category}**\n\n| ${cols_header}\n${cols_sep}|\n| ${icons_row} |\n| ${names_row} |`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `<div align="center">\n\n${sections}\n\n</div>`;
}

function buildProjectsBlock(pinned) {
  const cards = pinned.map((repo) => {
    const updated = new Date(repo.updatedAt).toISOString().slice(0, 10);
    const languageBadge = `<img src="https://img.shields.io/badge/${encodeURIComponent(repo.primaryLanguage?.name || "N/A")}-4F46E5?style=flat-square" />`;
    const starsBadge = `<img src="https://img.shields.io/badge/⭐-${repo.stargazerCount}-FACC15?style=flat-square" />`;
    const updatedBadge = `<img src="https://img.shields.io/badge/updated-${updated}-7C3AED?style=flat-square" />`;
    const topics = (repo.repositoryTopics?.nodes || [])
      .map((node) => node.topic?.name)
      .filter(Boolean)
      .slice(0, 4);
    const topicBadges = topics.length
      ? topics
          .map((topic) => `<img src="https://img.shields.io/badge/${encodeURIComponent(topic)}-8B5CF6?style=flat-square" />`)
          .join(" ")
      : "";
    const links = [
      `<a href="${repo.url}">Repository ↗</a>`,
      repo.homepageUrl ? `<a href="${repo.homepageUrl}">Demo ↗</a>` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return [
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">',
      '  <tr>',
      '    <td style="background:linear-gradient(135deg,rgba(37,99,235,0.16),rgba(124,58,237,0.14)); border-radius:20px; padding:18px;">',
      `      <h3 style="margin:0 0 8px; color:#F8FAFC;">${repo.name}</h3>`,
      `      <p style="margin:0 0 10px; color:#DDEBFF;">${repo.description || "No description provided."}</p>`,
      `      <p style="margin:0 0 10px;">${languageBadge} ${starsBadge} ${updatedBadge}</p>`,
      topicBadges ? `      <p style="margin:0 0 10px;">${topicBadges}</p>` : "",
      `      <p style="margin:0;">${links}</p>`,
      "    </td>",
      "  </tr>",
      "</table>",
    ].filter(Boolean).join("\n");
  });
  return cards.join("\n");
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
