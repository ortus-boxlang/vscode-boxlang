# Change Log

## [Unreleased]

## [1.20.1] - 2026-05-31

## [1.20.0] - 2026-05-30

## [1.19.12] - 2026-05-30

- Improve language server startup coordination to prevent duplicate `startLSP()` calls and keep the VS Code client state aligned during reconnects and restarts

## [1.19.11] - 2026-05-29

- Refresh the changelog to align release notes with the repository's tagged versions

## [1.19.10] - 2026-05-29

- Adopt repository-wide AI agent convention files by adding `AGENTS.md` and `CLAUDE.md` and refreshing the shared assistant instructions
- Add `skills-lock.json` and related repository updates for AI-assisted development workflows

## [1.19.9] - 2026-05-29

- Improve language server lifecycle handling

## [1.19.8] - 2026-05-27

- Fix: update vsce publish command to use scoped package

## [1.19.7] - 2026-05-26

- Switch CI to use `npm ci` for reproducible builds

## [1.19.6] - 2026-05-22

- BLIDE-289 add command palette workflows to create `.bxlint.json`, create `.bxformat.json`, and convert existing CFFormat configs with workspace selection and overwrite prompts
- BLIDE-289 improve externally managed LSP connections by avoiding update-driven restarts, suppressing duplicate command registration, and adding better startup diagnostics

## [1.19.5] - 2026-05-19

## [1.19.4] - 2026-05-19

- Refactor LSP version handling to use async update method; update related tests

## [1.19.3] - 2026-05-15

- Improve error messages for Java executable and LSP version validation; enhance `.bvmrc` version format checks
- Add buffer cap for stdout in LSP process to handle large output
- Add timeout handling to LSP process startup; reject promise if process is silent
- Add validation for Java executable in LSP process; reject promise if not configured
- Refactor LSP process event handling; add cleanup function to remove listeners
- Enhance error handling in LanguageServer with dedicated InvalidLSPInstallationError for unconfigured LSP version
- Add unit tests for BoxLang, LanguageServer, and versionManager; enhance LSP error handling

## [1.19.2] - 2026-05-05

- Fix: Add missing properties to `.bxformat.json` schema

## [1.19.1] - 2026-04-29

- Update mapping setting location and migration strategy

## [1.19.0] - 2026-04-29

- Add project mapping configuration and migrate legacy mapping settings to `boxlang.mappings`
- Update release workflow

## [1.18.0] - 2026-04-27

- BLIDE-278 improve LSP workspace setting configuration
- BLIDE-276 improve auto update of main components
- BLIDE-275 update LSP, debugger, and MiniServer install commands
- BLIDE-274 merge install and select BoxLang version commands
- Add dump context menu item

## [1.17.4] - 2026-04-29

- Fix tests and add project mapping config

## [1.17.3] - 2026-04-27

- Add dump context menu item

## [1.17.2] - 2026-04-07

- BLIDE-278 improve LSP updating and workspace setting

## [1.17.1] - 2026-04-02

- BLIDE-276 improve auto update of main components
- BLIDE-275 update LSP, debugger, and MiniServer install commands

## [1.17.0] - 2026-04-01

- BLIDE-274 merge install and select BoxLang version commands

## [1.16.1] - 2026-03-20

- Update release workflows for improved version management and synchronization

## [1.16.0] - 2026-03-19

- Add JSON schema for `.bxformat.json`

## [1.15.3] - 2026-03-17

- Enhance LSP and Debugger version management with configuration options and automatic updates

## [1.15.2] - 2026-02-28

- Add debugger management commands and configuration options

## [1.15.1] - 2026-02-28

- Add commands to install LSP and MiniServer versions; enhance version info output
- Implement ModuleManager with unit tests and download manager

## [1.15.0] - 2026-01-26

## [1.14.0] - 2026-01-24

- Add Feature Audit tool UI
- Bump internal BoxLang version to 1.9
- Bump versions and update schemas

## [1.13.10] - 2026-01-26

- Update schemas

## [1.13.9] - 2026-01-21

- Bump BoxLang version in package.json

## [1.13.8] - 2026-01-20

- Bump runtime versions (BoxLang and LSP)

## [1.13.7] - 2025-11-26

- Bump GitHub Actions dependencies (setup-node, upload-artifact, download-artifact, checkout)

## [1.13.6] - 2025-11-03

- Fix build

## [1.13.5] - 2025-11-03

- Fix build

## [1.13.4] - 2025-11-03

- Fix TypeScript errors

## [1.13.3] - 2025-11-02

- BLIDE-255 Add UI for feature audit tool

## [1.13.2] - 2025-10-31

## [1.13.1] - 2025-10-31

- BLIDE-254 enhance version checking with new version check functionality
- BLIDE-253 Fix REPL not opening when the default shell is PowerShell

## [1.13.0] - 2025-10-16

- Hotfix LSP version

## [1.12.1] - 2025-10-16

- BLIDE-253 Fix REPL not opening when the default shell is PowerShell
- BLIDE-254 add workspace setting to control BoxLang version

## [1.12.0] - 2025-10-16

- BLIDE-155 disable showing the output channel on startup
- BLIDE-157 Fix LSP install on Mac
- BLIDE-165 More mac LSP issues
- BLIDE-144 De-emphasize unused variables
- BLIDE-145 Detect unscoped variables in CFML
- BLIDE-164 Add diagnostic rule configuration

## [1.11.12] - 2025-10-16

- Update changelog

## [1.11.11] - 2025-10-16

- Bump LSP and BoxLang versions

## [1.11.10] - 2025-10-14

- BLIDE-165 fix CommandBox on Mac

## [1.11.9] - 2025-10-03

- BLIDE-155 disable output channel on startup
- BLIDE-157 implement defensive programming for LSP startup and fix Mac LSP install
- Add .bvmrc support with status bar integration and BoxLang version override
- Add CommandBox detection and installation
- Add LSP modules configuration
- Add automated testing infrastructure
- Bump GitHub Actions dependencies (checkout, download-artifact, setup-node)

## [1.10.0] - 2025-09-16

- Bump BoxLang version to 1.5.0
- Bump LSP version to 1.1.0
- Add unused variable check
- Add var scoping check
- BLIDE-125 refactor caching progress message
- BLIDE-86 Remove duplicate entries in the outline view
- BLIDE-147 Rewrite handling of lsp configuration

## [1.7.3] - 2025-07-09

## [1.7.2] - 2025-07-09

## [1.7.1] - 2025-05-28

## [1.7.0] - 2025-05-27

- BLIDE-112 Stop syncing certain settings
- Bump BoxLang to 1.1.0
- Add pre-release to VSCode Marketplace
- BLIDE-119 add BoxLang chat participant

## [1.3.24] - 2025-05-15

## [1.3.24] - 2025-05-07

## [1.3.21] - 2025-04-30

## [1.3.21] - 2025-04-30

- Improve changelog
- Update documentation links

## [1.3.20] - 2025-04-30

- Fixed BoxLang java version filter
- BLIDE-94 Add BoxLang task provider
- BLIDE-95 Add rewrites flag for miniserver
- BLIDE-96 Add LSP version info
- BLIDE-97 Fix LSP host binding issues
- Bump BoxLang to 1.0.0

## [1.3.18] - 2025-04-08

## [1.3.17] - 2025-03-26

- BLIDE-83 Fix incorrect function return diagnostic
- BLIDE-84 Fix heap space errors

## [1.3.16] - 2025-03-05

- BLIDE-72 Add welcome views

## [1.3.15] - 2025-03-05

- Bump included BoxLang version to RC.2
- Update BoxLang language server
- Add run codeaction to executable classes
- Add BoxLang REPL

## [1.3.13] - 2025-02-27

- BLIDE-65 Add ability to install and manage BoxLang versions

## [1.3.12] - 2025-02-02

- Bump included BoxLang version to Beta26

## [1.3.11] - 2025-02-02

## [1.3.10] - 2024-12-19

## [1.3.9] - 2024-11-17

## [1.3.8] - 2024-10-03

- BLIDE-48 Add debugMode and configFile properties to MiniServer config
- Added ability to configure external MiniServer JAR path
- Added ability to configure external LSP JAR path

## [1.3.7] - 2024-09-28

## [1.3.5] - 2024-09-28

- Bumped BoxLang release version to Beta 16. Now with 100% more websockets!

## [1.3.5] - 2024-09-25

## [1.3.4] - 2024-09-06

## [1.3.3] - 2024-08-23

- Bumped BoxLang release version to Beta 11

## [1.3.2] - 2024-08-12

- Bumped BoxLang release version to Beta 9

## [1.3.1] - 2024-08-05

- Bumped BoxLang release version to Beta 8
- Added acknowledgements for prior work from @ghedwards and @KamasamaK - thanks guys!

## [1.0.0] - 2024-06-25

- Going 1.0!
- Added BoxLang language support
- BoxLang runtime debugger
- BoxLang LSP
- Added BoxLang Server panel
- Added experimental support for diagnostics
- Added experimental support for file formatting
- JSON schema for boxlang.json

[unreleased]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.20.1...HEAD
[1.20.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.20.0...v1.20.1
[1.20.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.12...v1.20.0
[1.19.12]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.11...v1.19.12
[1.19.11]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.10...v1.19.11
[1.19.10]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.9...v1.19.10
[1.19.9]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.8...v1.19.9
[1.19.8]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.7...v1.19.8
[1.19.7]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.6...v1.19.7
[1.19.6]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.5...v1.19.6
[1.19.5]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.4...v1.19.5
[1.19.4]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.3...v1.19.4
[1.19.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.2...v1.19.3
[1.19.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.1...v1.19.2
[1.19.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.19.0...v1.19.1
[1.19.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.17.3...v1.18.0
[1.17.4]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.17.3...v1.17.4
[1.17.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.17.2...v1.17.3
[1.17.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.17.1...v1.17.2
[1.17.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.16.1...v1.17.0
[1.16.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.16.0...v1.16.1
[1.16.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.15.3...v1.16.0
[1.15.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.15.2...v1.15.3
[1.15.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.15.1...v1.15.2
[1.15.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.15.0...v1.15.1
[1.15.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.10...v1.14.0
[1.13.10]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.9...v1.13.10
[1.13.9]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.8...v1.13.9
[1.13.8]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.7...v1.13.8
[1.13.7]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.6...v1.13.7
[1.13.6]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.5...v1.13.6
[1.13.5]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.4...v1.13.5
[1.13.4]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.3...v1.13.4
[1.13.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.2...v1.13.3
[1.13.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.1...v1.13.2
[1.13.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.12.1...v1.13.0
[1.12.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.12.0...v1.12.1
[1.12.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.11.12...v1.12.0
[1.11.12]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.11.11...v1.11.12
[1.11.11]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.11.10...v1.11.11
[1.11.10]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.11.9...v1.11.10
[1.11.9]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.10.0...v1.11.9
[1.10.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.7.3...v1.10.0
[1.7.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.24...v1.7.0
[1.3.24]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.24...v1.3.24
[1.3.21]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.21...v1.3.21
[1.3.20]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.18...v1.3.20
[1.3.18]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.17...v1.3.18
[1.3.17]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.16...v1.3.17
[1.3.16]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.15...v1.3.16
[1.3.15]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.13...v1.3.15
[1.3.13]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.12...v1.3.13
[1.3.12]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.11...v1.3.12
[1.3.11]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.10...v1.3.11
[1.3.10]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.9...v1.3.10
[1.3.9]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.8...v1.3.9
[1.3.8]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.7...v1.3.8
[1.3.7]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.5...v1.3.7
[1.3.5]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.5...v1.3.5
[1.3.4]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/ortus-boxlang/vscode-boxlang/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/ortus-boxlang/vscode-boxlang/compare/df91d9ff46061157e7b5fd1a55a6af9db645c681...v1.3.1
