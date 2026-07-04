# SiYuan Bazaar Submission Checklist

This plugin is prepared for SiYuan Bazaar submission, but the final Bazaar PR is intentionally not opened yet.

## Current Local Status

- Plugin name: `siyuan-ai-mcp-bridge`
- Package command: `npm run package`
- Release artifact: `package.zip`
- Expected GitHub repository: `https://github.com/appdev/siyuan-ai-mcp-bridge`

Before publishing, confirm the GitHub owner/repository above is correct.

## Step 1. Create Or Update The Plugin Repository

Create a GitHub repository named:

```text
siyuan-ai-mcp-bridge
```

Push this plugin directory to that repository.

## Step 2. Publish A GitHub Release

Build the package:

```bash
npm test
npm run package
```

Create a GitHub Release using the version in `plugin.json`, for example:

```text
v0.1.1
```

Upload `package.zip` to the release assets.

## Step 3. Prepare The Bazaar Change

Fork `siyuan-note/bazaar`, then add this line to `plugins.txt`:

```text
appdev/siyuan-ai-mcp-bridge
```

Stop here unless you are ready to submit the official PR.

## Step 4. Final PR, Not Done Yet

Open a PR from your Bazaar fork to `siyuan-note/bazaar`.

This stage is intentionally left undone for now.
