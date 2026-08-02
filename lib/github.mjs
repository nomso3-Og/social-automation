// Minimal GitHub REST helpers for the issue-based approval flow.
//
// Uses the token GitHub Actions injects automatically, so there's no extra
// secret to configure. Running locally needs a GITHUB_TOKEN with issues
// write access on this repo.

const API = 'https://api.github.com';

export function repoContext() {
  // GITHUB_REPOSITORY is "owner/repo" inside Actions.
  const slug = process.env.GITHUB_REPOSITORY;
  if (!slug || !slug.includes('/')) {
    throw new Error(
      'GITHUB_REPOSITORY is not set (expected "owner/repo"). ' +
        'Set it when running outside GitHub Actions.'
    );
  }
  const [owner, repo] = slug.split('/');
  return { owner, repo };
}

function token() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GITHUB_TOKEN is not set.');
  return t;
}

async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'social-automation',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} on ${method} ${endpoint}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function createIssue({ title, body, labels = [], assignees = [] }) {
  const { owner, repo } = repoContext();
  return api('POST', `/repos/${owner}/${repo}/issues`, { title, body, labels, assignees });
}

export async function listOpenIssues(label) {
  const { owner, repo } = repoContext();
  const params = new URLSearchParams({ state: 'open', per_page: '100' });
  if (label) params.set('labels', label);
  return api('GET', `/repos/${owner}/${repo}/issues?${params}`);
}

export async function listComments(issueNumber) {
  const { owner, repo } = repoContext();
  return api('GET', `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`);
}

export async function commentOnIssue(issueNumber, body) {
  const { owner, repo } = repoContext();
  return api('POST', `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
}

export async function closeIssue(issueNumber) {
  const { owner, repo } = repoContext();
  return api('PATCH', `/repos/${owner}/${repo}/issues/${issueNumber}`, { state: 'closed' });
}
