# Codeclub Browser Control

Chromium companion for the local Codeclub desktop app.

- [User setup, troubleshooting, and agent tool contracts](../docs/browser-control.md)
- [Development, store packaging, release process, and browser ports](../docs/browser-extension-development.md)
- [Privacy and permissions](../docs/privacy.md)
- [Store listing draft](../docs/listing.md)
- [Verification and known limits](../docs/tool-audit-2026-10-08.md)

For development, load this directory unpacked in the browser's extension manager. Reload the extension after worker or manifest edits; restart Codeclub after native bridge edits. Keep Codeclub running for normal use. Standalone debug scripts require Codeclub closed and control only their own fixture tabs.

The manifest is 1.0.2. The upload package is generated at `release/codeclub-browser-control-1.0.2.zip` with manifest.json at the archive root; it has not been published automatically. Repository edits do not update store installations. Packing a CRX is not required for debugging; never commit private signing keys or release artifacts.

Store upload packages must omit the manifest `key` field. Keep that public key in the unpacked development source to preserve its local extension identity; remove it only from the ZIP manifest. The Edge store assigns its own extension ID.

Generate the store upload with `npm run package:browser-extension` on Windows. The script reads the manifest version, removes `key` only in staging, and produces a ZIP with the runtime files at archive root.
