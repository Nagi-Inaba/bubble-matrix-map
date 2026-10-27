import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { classifyPullRequest, hasFailingChecks, selectReviewTargets } from '../.github/scripts/select-dependabot-reviews.mjs'

const internalTool = ['Co', 'dex'].join('')

function pullRequest(overrides = {}) {
  return {
    number: 1,
    state: 'OPEN',
    title: 'build(deps): bump example from 1.2.3 to 1.2.4',
    body: 'Bumps example from 1.2.3 to 1.2.4.\n',
    statusCheckRollup: [],
    ...overrides,
  }
}

describe('dependabot review selection', () => {
  it('classifies the repository title shapes', () => {
    expect(classifyPullRequest(pullRequest({ title: 'build(deps): bump actions/setup-node from 7.0.0 to 7.1.0' }))).toBe('minor')
    expect(classifyPullRequest(pullRequest({ title: 'build(deps-dev): bump eslint from 10.8.1 to 10.9.0' }))).toBe('minor')
    expect(classifyPullRequest(pullRequest({ title: 'build(deps-dev): bump @types/node from 22.20.1 to 26.2.0' }))).toBe('major')
    expect(classifyPullRequest(pullRequest({ title: 'build(deps-dev): bump globals from 17.9.0 to 17.11.0' }))).toBe('minor')
    expect(classifyPullRequest(pullRequest({ title: 'build(deps-dev): bump @xmldom/xmldom from 0.9.10 to 0.9.11' }))).toBe('patch')
    expect(classifyPullRequest(pullRequest({ title: 'build(deps-dev): bump typescript-eslint from 8.66.0 to 8.67.0' }))).toBe('minor')
    expect(classifyPullRequest(pullRequest({ title: 'Bump actions/checkout from 3 to 4' }))).toBe('major')
    expect(classifyPullRequest(pullRequest({ title: 'Bump actions/checkout from v4.1.1 to v4.1.2' }))).toBe('patch')
  })

  it('trusts dependabot update-type metadata and ignores changelog ranges', () => {
    expect(classifyPullRequest(pullRequest({
      title: 'build(deps): bump foo from 1.2.3 to 1.2.4',
      body: 'update-type: version-update:semver-major\n',
    }))).toBe('major')
    expect(classifyPullRequest(pullRequest({
      title: 'build(deps): bump foo from 1.2.3 to 1.2.4',
      body: 'Bumps foo from 1.2.3 to 1.2.4.\n\n<details>\nfrom 1.0.0 to 2.0.0\n</details>\n',
    }))).toBe('patch')
  })

  it('uses the opening body line when the title has no version', () => {
    expect(classifyPullRequest(pullRequest({
      title: 'build(deps): bump foo',
      body: 'Bumps [foo](https://example.com/foo) from 1.2.3 to 2.0.0.\n',
    }))).toBe('major')
  })

  it('selects major updates, unclassified updates, and failing checks', () => {
    const selected = selectReviewTargets([
      pullRequest({ number: 7, title: 'build(deps-dev): bump eslint from 10.8.1 to 10.9.0' }),
      pullRequest({
        number: 8,
        title: 'build(deps): bump actions/setup-node from 7.0.0 to 7.1.0',
        statusCheckRollup: [
          { name: 'verify (ubuntu-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
          { name: 'verify (ubuntu-latest)', status: 'COMPLETED', conclusion: 'FAILURE' },
          { name: 'verify (windows-latest)', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ],
      }),
      pullRequest({ number: 6, title: 'build(deps-dev): bump @types/node from 22.20.1 to 26.2.0' }),
      pullRequest({ number: 4, title: 'build(deps-dev): bump @xmldom/xmldom from 0.9.10 to 0.9.11' }),
      pullRequest({ number: 9, title: 'Bump the npm group with 2 updates', body: 'Grouped update.\n' }),
      pullRequest({ number: 10, state: 'CLOSED', title: 'build(deps): bump foo from 1.0.0 to 2.0.0' }),
      pullRequest({
        number: 11,
        title: 'build(deps): bump foo from 1.2.3 to 1.2.4',
        statusCheckRollup: [{ name: 'verify (ubuntu-latest)', status: 'IN_PROGRESS', conclusion: null }],
      }),
    ])

    expect(selected).toEqual([
      { number: 6, updateType: 'major', reasons: 'semver-major' },
      { number: 8, updateType: 'minor', reasons: 'failing-checks' },
      { number: 9, updateType: 'unknown', reasons: 'unclassified' },
    ])
    expect(hasFailingChecks([{ state: 'ERROR' }])).toBe(true)
    expect(hasFailingChecks([{ conclusion: 'CANCELLED' }])).toBe(false)
    expect(hasFailingChecks(null)).toBe(false)
  })

  it('prints only JSON on stdout', () => {
    const result = spawnSync(process.execPath, ['.github/scripts/select-dependabot-reviews.mjs'], {
      input: JSON.stringify([
        pullRequest({ number: 6, title: 'build(deps-dev): bump @types/node from 22.20.1 to 26.2.0' }),
      ]),
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([
      { number: 6, updateType: 'major', reasons: 'semver-major' },
    ])
    expect(result.stderr).toContain('selected 1 pull request(s)')

    const invalid = spawnSync(process.execPath, ['.github/scripts/select-dependabot-reviews.mjs'], {
      input: 'not-json',
      encoding: 'utf8',
    })
    expect(invalid.status).not.toBe(0)
  })
})

describe('dependabot workflows', () => {
  it('auto-merges patch and minor updates without checking out pull request code', async () => {
    const workflow = await readFile('.github/workflows/dependabot-auto-merge.yml', 'utf8')

    expect(workflow).toContain('pull_request_target:')
    expect(workflow).toContain("github.event.pull_request.user.login == 'dependabot[bot]'")
    expect(workflow).toContain('gh pr merge --auto --squash "$PR_URL"')
    expect(workflow).toContain("version-update:semver-patch")
    expect(workflow).toContain("version-update:semver-minor")
    expect(workflow).toContain("version-update:semver-major")
    expect(workflow).toContain('--add-label "needs-review"')
    expect(workflow).toContain('GH_REPO: ${{ github.repository }}')
    expect(workflow).not.toContain('actions/checkout')
    expect(workflow).not.toContain('--approve')
    expect(workflow).not.toContain('github.event.pull_request.head.sha')
    expect(workflow).not.toContain(internalTool)
  })

  it('reviews majors and failures with a comment and skips a missing API key', async () => {
    const workflow = await readFile('.github/workflows/dependabot-weekly-review.yml', 'utf8')
    const prompt = await readFile('.github/prompts/dependabot-review.md', 'utf8')

    expect(workflow).toContain('cron: "0 0 * * 1"')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('OPENAI_API_KEY is not set. Skipping the weekly dependabot review.')
    expect(workflow).toContain('permission-profile: ":read-only"')
    expect(workflow).toContain('safety-strategy: drop-sudo')
    expect(workflow).toContain('allow-bots: true')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toMatch(/uses: openai\/codex-action@[a-f0-9]{40} # v1\.13/)
    expect(workflow).toContain('model: gpt-6.1-sol')
    expect(workflow).toContain('effort: high')
    expect(workflow).toContain('event: "COMMENT"')
    expect(workflow).not.toContain('pr merge')
    expect(workflow).not.toContain('--approve')
    expect(workflow).not.toContain('refs/pull')
    expect(workflow).not.toContain('github.event.pull_request.head.sha')
    expect(workflow).not.toContain(internalTool)
    expect(prompt).not.toContain(internalTool)
    expect(prompt).toContain('comment only')
  })
})
