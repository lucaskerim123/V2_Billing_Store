# Integration package contract (core manager)

Place a package in `src/integrations/<id>/`. Discovery scans folders at build/runtime for a valid `manifest.json`; the scan reads metadata and checks declared entrypoint files only. It does not execute code, package scripts, or SQL.

Optional generic contribution metadata may declare `contributions.adminPages` (label, route, entrypoint key) and `contributions.adminMenu` (label, route, permission). These declarations are metadata only: they do not automatically create routes, inject navigation, or load entrypoint code. Host code must implement and authorize any contribution before it becomes operational. This is deliberate; metadata cannot grant arbitrary route execution.

Install/enable/disable/uninstall state is delegated to the central database RPC. Enable requires declared server environment keys. Disable sets enabled=false. Uninstall sets installed=false and enabled=false. **The current central RPC contract has not been verified to erase package-specific configuration, secrets, or data.** This manager must not claim complete data destruction until the central RPC/schema and cleanup behavior are verified and implemented. Production DB changes and deployment are out of scope.

Mail integration remains a future package and must not be copied into this repository by this change.
