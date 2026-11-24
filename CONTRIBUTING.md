# Contributing

Use Node.js 22 or later and the desktop Orca CLI. Run `npm ci` once, then run these checks before opening a pull request.

```sh
npm run check
npm run build
npm test
orca plugin validate . --json
```

Commit `worker.mjs` with changes to the worker or its bundled dependencies. Keep the editable source in `worker/` and the sidebar files in `panel/`. GitHub Actions checks the worker types, panel syntax, and bundle reproducibility, and runs the Orca catalog validator.

For local testing, run `orca plugin dev load . --json`, review the requested permissions, and reload after each rebuild. Use a TAPD test project when trying write actions. Remove personal tokens and work-item data from issue reports and screenshots.

## Release to the Orca community

1. Update the version in `orca-plugin.json` and `package.json`. Refresh `package-lock.json`, update [CHANGELOG.md](CHANGELOG.md), rebuild the worker, and run the checks above.
2. Commit the release, confirm GitHub Actions passes, and run `orca plugin release-entry . --json` against that commit. Try installing from Git in Orca.
3. When ready for public listing, add the `orca-plugin` topic and push a `vX.Y.Z` Git tag matching the manifest version. Check the directory listing from the [Orca publishing guide](https://api.onorca.dev/plugins/add).

Publish a new version for later changes so an existing tag always points at the same files.
