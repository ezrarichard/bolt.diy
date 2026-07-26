import { Octokit } from '@octokit/rest';

/**
 * GitHub Deploy Service — Sprint 88 (GitHub Product Integration).
 *
 * Extracted verbatim from `GitHubDeploymentDialog.tsx`'s `handleSubmit` — the ONLY real push
 * implementation this codebase already had wired to the UI (see the Sprint 88 brief: "reuse the
 * existing implementation, do not build a second one"). Every Octokit call, call order, commit
 * message, and fallback (`updateRef` then `createRef` if that fails) is unchanged; this file only
 * moves that logic out of the React component so it's a plain, testable function the Deployment
 * integration can call and then persist the result through `deploymentRepository.attachGithub`.
 *
 * The "confirm overwrite when a repo already exists" UX stays a caller concern — this function
 * takes an optional `confirmOverwrite` callback (the component still owns `window.confirm`, or a
 * test can stub it) rather than baking a browser dialog into a service module.
 */

export interface PushToGithubParams {
  token: string;
  owner: string;

  /** Already-sanitized repository name (see `GitHubDeploymentDialog`'s `sanitizeRepoName`). */
  repoName: string;
  isPrivate: boolean;
  files: Record<string, string>;

  /** Called only when a repository with this name already exists. Returning `false` cancels the push without writing anything. */
  confirmOverwrite?: (existing: { private: boolean; htmlUrl: string }) => boolean | Promise<boolean>;
}

export interface PushToGithubResult {
  repoOwner: string;
  repoName: string;
  repoFullName: string;
  repoUrl: string;
  defaultBranch: string;
  visibility: 'public' | 'private';

  /** Whether the repository already existed before this call (vs. being created here). */
  wasExisting: boolean;
  commitSha: string;
  filesPushed: { path: string; size: number }[];
}

export type PushToGithubOutcome = { status: 'success'; result: PushToGithubResult } | { status: 'cancelled' };

export async function pushToGithubRepository(params: PushToGithubParams): Promise<PushToGithubOutcome> {
  const octokit = new Octokit({ auth: params.token });
  const { owner, repoName, isPrivate } = params;

  let repoExists = false;
  let createdRepoUrl: string | undefined;

  try {
    const { data: existingRepo } = await octokit.repos.get({ owner, repo: repoName });
    repoExists = true;
    createdRepoUrl = existingRepo.html_url;

    if (params.confirmOverwrite) {
      const proceed = await params.confirmOverwrite({ private: existingRepo.private, htmlUrl: existingRepo.html_url });

      if (!proceed) {
        return { status: 'cancelled' };
      }
    }

    if (existingRepo.private !== isPrivate) {
      await octokit.repos.update({ owner, repo: repoName, private: isPrivate });
    }
  } catch (error: any) {
    // 404 means the repo doesn't exist yet, which is the expected path for a brand-new repo.
    if (error?.status !== 404) {
      throw error;
    }
  }

  if (!repoExists) {
    const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      private: isPrivate,
      auto_init: true,
      gitignore_template: 'Node',
    });
    createdRepoUrl = newRepo.html_url;

    // GitHub needs a moment to finish setting up the auto-init commit before we can push onto it.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const fileEntries = Object.entries(params.files);

  const { data: repo } = await octokit.repos.get({ owner, repo: repoName });
  const defaultBranch = repo.default_branch || 'main';

  let baseTreeSha: string | null = null;

  try {
    const { data: refData } = await octokit.git.getRef({ owner, repo: repoName, ref: `heads/${defaultBranch}` });
    const { data: commitData } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: refData.object.sha });
    baseTreeSha = commitData.tree.sha;
  } catch {
    baseTreeSha = null;
  }

  const tree = fileEntries.map(([filePath, content]) => ({
    path: filePath,
    mode: '100644' as const,
    type: 'blob' as const,
    content,
  }));

  const { data: treeData } = await octokit.git.createTree({
    owner,
    repo: repoName,
    tree,
    base_tree: baseTreeSha || undefined,
  });

  let parentCommitSha: string | null = null;

  try {
    const { data: refData } = await octokit.git.getRef({ owner, repo: repoName, ref: `heads/${defaultBranch}` });
    parentCommitSha = refData.object.sha;
  } catch {
    parentCommitSha = null;
  }

  const { data: commitData } = await octokit.git.createCommit({
    owner,
    repo: repoName,
    message: !repoExists ? 'Initial commit from Builders' : 'Update from Builders',
    tree: treeData.sha,
    parents: parentCommitSha ? [parentCommitSha] : [],
  });

  try {
    await octokit.git.updateRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
      sha: commitData.sha,
      force: true,
    });
  } catch {
    await octokit.git.createRef({ owner, repo: repoName, ref: `refs/heads/${defaultBranch}`, sha: commitData.sha });
  }

  const filesPushed = fileEntries.map(([filePath, content]) => ({
    path: filePath,
    size: new TextEncoder().encode(content).length,
  }));

  return {
    status: 'success',
    result: {
      repoOwner: owner,
      repoName,
      repoFullName: `${owner}/${repoName}`,
      repoUrl: createdRepoUrl || `https://github.com/${owner}/${repoName}`,
      defaultBranch,
      visibility: isPrivate ? 'private' : 'public',
      wasExisting: repoExists,
      commitSha: commitData.sha,
      filesPushed,
    },
  };
}
