import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  reposGetMock,
  reposUpdateMock,
  reposCreateForAuthenticatedUserMock,
  gitGetRefMock,
  gitGetCommitMock,
  gitCreateTreeMock,
  gitCreateCommitMock,
  gitUpdateRefMock,
  gitCreateRefMock,
} = vi.hoisted(() => ({
  reposGetMock: vi.fn(),
  reposUpdateMock: vi.fn(),
  reposCreateForAuthenticatedUserMock: vi.fn(),
  gitGetRefMock: vi.fn(),
  gitGetCommitMock: vi.fn(),
  gitCreateTreeMock: vi.fn(),
  gitCreateCommitMock: vi.fn(),
  gitUpdateRefMock: vi.fn(),
  gitCreateRefMock: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      get: reposGetMock,
      update: reposUpdateMock,
      createForAuthenticatedUser: reposCreateForAuthenticatedUserMock,
    },
    git: {
      getRef: gitGetRefMock,
      getCommit: gitGetCommitMock,
      createTree: gitCreateTreeMock,
      createCommit: gitCreateCommitMock,
      updateRef: gitUpdateRefMock,
      createRef: gitCreateRefMock,
    },
  })),
}));

const { pushToGithubRepository } = await import('./githubDeployService');

function notFoundError() {
  return Object.assign(new Error('Not Found'), { status: 404 });
}

describe('pushToGithubRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a brand-new repository, pushes files, and returns the result', async () => {
    reposGetMock
      .mockRejectedValueOnce(notFoundError()) // existence check
      .mockResolvedValueOnce({ data: { default_branch: 'main' } }); // post-create repo info lookup

    reposCreateForAuthenticatedUserMock.mockResolvedValue({
      data: { html_url: 'https://github.com/acme/my-app' },
    });

    gitGetRefMock
      .mockRejectedValueOnce(new Error('no ref yet')) // base tree lookup — brand new repo
      .mockResolvedValueOnce({ data: { object: { sha: 'parent-sha' } } }); // parent commit lookup

    gitCreateTreeMock.mockResolvedValue({ data: { sha: 'tree-sha' } });
    gitCreateCommitMock.mockResolvedValue({ data: { sha: 'commit-sha' } });
    gitUpdateRefMock.mockResolvedValue({ data: {} });

    const outcome = await pushToGithubRepository({
      token: 'tok',
      owner: 'acme',
      repoName: 'my-app',
      isPrivate: false,
      files: { 'src/index.ts': 'console.log(1)' },
    });

    expect(outcome.status).toBe('success');

    if (outcome.status !== 'success') {
      throw new Error('expected success');
    }

    expect(reposCreateForAuthenticatedUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-app', private: false, auto_init: true }),
    );
    expect(gitCreateCommitMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Initial commit from Builders', parents: ['parent-sha'] }),
    );
    expect(gitUpdateRefMock).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/main', sha: 'commit-sha', force: true }),
    );
    expect(outcome.result).toMatchObject({
      repoOwner: 'acme',
      repoName: 'my-app',
      repoFullName: 'acme/my-app',
      repoUrl: 'https://github.com/acme/my-app',
      defaultBranch: 'main',
      visibility: 'public',
      wasExisting: false,
      commitSha: 'commit-sha',
    });
    expect(outcome.result.filesPushed).toEqual([{ path: 'src/index.ts', size: expect.any(Number) }]);
  }, 10000);

  it('confirms overwrite for an existing repo and cancels the push when the caller declines', async () => {
    reposGetMock.mockResolvedValue({ data: { private: false, html_url: 'https://github.com/acme/my-app' } });

    const confirmOverwrite = vi.fn().mockReturnValue(false);

    const outcome = await pushToGithubRepository({
      token: 'tok',
      owner: 'acme',
      repoName: 'my-app',
      isPrivate: false,
      files: { 'src/index.ts': 'console.log(1)' },
      confirmOverwrite,
    });

    expect(outcome.status).toBe('cancelled');
    expect(confirmOverwrite).toHaveBeenCalledWith({ private: false, htmlUrl: 'https://github.com/acme/my-app' });
    expect(reposCreateForAuthenticatedUserMock).not.toHaveBeenCalled();
    expect(gitCreateCommitMock).not.toHaveBeenCalled();
  });

  it('updates visibility and pushes onto an existing repo when the caller confirms', async () => {
    reposGetMock.mockResolvedValue({
      data: { private: false, html_url: 'https://github.com/acme/my-app', default_branch: 'main' },
    });

    gitGetRefMock.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    gitGetCommitMock.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } });
    gitCreateTreeMock.mockResolvedValue({ data: { sha: 'tree-sha-2' } });
    gitCreateCommitMock.mockResolvedValue({ data: { sha: 'commit-sha-2' } });
    gitUpdateRefMock.mockResolvedValue({ data: {} });

    const outcome = await pushToGithubRepository({
      token: 'tok',
      owner: 'acme',
      repoName: 'my-app',
      isPrivate: true,
      files: { 'README.md': '# hi' },
      confirmOverwrite: () => true,
    });

    expect(outcome.status).toBe('success');
    expect(reposUpdateMock).toHaveBeenCalledWith({ owner: 'acme', repo: 'my-app', private: true });
    expect(reposCreateForAuthenticatedUserMock).not.toHaveBeenCalled();

    if (outcome.status === 'success') {
      expect(outcome.result.wasExisting).toBe(true);
      expect(outcome.result.visibility).toBe('private');
    }
  });

  it('falls back to createRef when updateRef fails (brand-new ref never seen before)', async () => {
    reposGetMock.mockRejectedValueOnce(notFoundError()).mockResolvedValueOnce({ data: { default_branch: 'main' } });

    reposCreateForAuthenticatedUserMock.mockResolvedValue({ data: { html_url: 'https://github.com/acme/new-repo' } });

    gitGetRefMock.mockRejectedValue(new Error('no ref'));
    gitCreateTreeMock.mockResolvedValue({ data: { sha: 'tree-sha' } });
    gitCreateCommitMock.mockResolvedValue({ data: { sha: 'commit-sha' } });
    gitUpdateRefMock.mockRejectedValue(new Error('ref does not exist'));
    gitCreateRefMock.mockResolvedValue({ data: {} });

    const outcome = await pushToGithubRepository({
      token: 'tok',
      owner: 'acme',
      repoName: 'new-repo',
      isPrivate: false,
      files: { 'a.txt': 'hi' },
    });

    expect(outcome.status).toBe('success');
    expect(gitCreateRefMock).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/main', sha: 'commit-sha' }),
    );
  }, 10000);
});
