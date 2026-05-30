# BoxLang VS Code Extension — AI Agent Instructions

## Architecture Overview

This is a VS Code extension for **BoxLang** (a modern JVM language) and **CFML** (legacy compatibility). It provides language intelligence, debugging, server management, AI chat integration, and runtime version management. The extension follows a modular architecture with clear separation of concerns. Current version: **1.19.9**.

### Core Components

| Component | Purpose |
|---|---|
| **Language Server Protocol (LSP)** | Diagnostics, hover, completion, code actions, formatting, and workspace symbols via a separate BoxLang LSP server process over TCP sockets |
| **TextMate Grammars** | Syntax highlighting for `.bx`, `.bxs`, `.bxm`, `.cfm`, `.cfc`, `.cfml`, `.cfs` files, plus BoxLang injection into Java files |
| **Debug Adapter** | VS Code debug protocol implementation for BoxLang runtime debugging with launch/attach support |
| **Chat Integration** | Custom `boxlang.chat` participant using `@vscode/chat-extension-utils` plus a registered `lookupBoxLangDocumentation` language model tool |
| **Server Management** | MiniServer and web server lifecycle management via tree views and commands |
| **Version Management** | Downloads and manages BoxLang runtime, LSP, MiniServer, and debugger versions from AWS S3; supports `.bvmrc` per-workspace pinning |
| **Feature Audit Tool** | Webview-based audit tool for analyzing BoxLang feature usage in a workspace |

## Extension Activation

The extension activates on **workspaceContains** patterns (not `onLanguage`), meaning it activates when any workspace folder contains at least one `.bx`, `.bxm`, `.bxs`, `.cfm`, `.cfml`, or `.cfc` file. The activation entry point is `src/main.ts` → `activate()`.

### Startup sequence (`runSetup()`)

```typescript
registerStatusBar(context);
setupLocalJavaInstall(context);   // auto-downloads Java 21 if needed
setupWorkspace(context);          // creates BoxLangWithHome launcher
setupConfiguration(context);      // resolves JAR paths and storage directories
setupVSCodeBoxLangHome(context);  // ensures ~/.boxlang home directory
setupVersionManagement(context);  // initializes version cache in globalStorage
setupCommandBox(context);         // installs CommandBox for module management
setupBvmrcSupport(context);       // reads .bvmrc and pins version
migrateSettings(false);           // migrates from legacy settings format
checkAllUpdates(false);           // background update check (3s delay)
LSP.startLSP();                   // starts the language server process
setupServers(context);            // configures BoxLang servers
```

## Dual Language Support

The extension supports both `cfml` and `boxlang` language IDs with shared features. The actual selectors used throughout the codebase include `scheme: "untitled"` for unsaved files:

```typescript
const DOCUMENT_SELECTOR: DocumentSelector = [
    { language: "cfml", scheme: "file" },
    { language: "cfml", scheme: "untitled" },
    { language: "boxlang", scheme: "file" },
    { language: "boxlang", scheme: "untitled" }
];

// CFML-only features (legacy)
const CF_DOCUMENT_SELECTOR: DocumentSelector = [
    { language: "cfml", scheme: "file" },
    { language: "cfml", scheme: "untitled" }
];
```

### Language ↔ file extension mapping

| Language ID | Extensions | Config file |
|---|---|---|
| `cfml` | `.cfml`, `.cfm`, `.cfc` | `language-configuration.json` |
| `boxlang` | `.bx`, `.bxs`, `.bxm`, `.cfs` | `boxlang-language-configuration.json` |

BoxLang also injects a grammar into `.java` files (via `syntaxes/boxlang-java.tmLanguage.json`) for inline BoxLang in Java source.

## File Organization

```
src/
├── main.ts                  # Extension activation/deactivation, all feature registration
├── context.ts               # Global extension context accessor (getExtensionContext)
├── chat/                    # AI chat participant + language model tools
│   ├── BoxLangParticipant.ts
│   ├── IncludeBoxLangDocumenationTool.ts
│   └── tools.ts
├── commands/                # VS Code command implementations
│   ├── index.ts             # Barrel export of all commands
│   ├── boxlangHome/         # BoxLang Home management (add, remove, clear, install module, etc.)
│   ├── boxlangVersions/     # Runtime version selection/removal
│   ├── debugger/            # Debugger version selection/removal
│   ├── lsp/                 # LSP config creation, version selection, restart
│   ├── miniserver/          # MiniServer version selection
│   └── server/              # Server CRUD, run, debug, stop, open in browser
├── debug/                   # Debug adapter implementation
│   ├── BoxlangDebugDescriptor.ts    # DebugAdapterDescriptorFactory
│   ├── BoxLangDebugAdapterTracker.ts # Debug session lifecycle tracking
│   ├── DumpManager.ts       # Variable dump panel via debug protocol
│   └── debugAdapter.ts
├── entities/                # Type definitions for language constructs
│   ├── component.ts, function.ts, property.ts, parameter.ts
│   ├── tag.ts, attribute.ts, scope.ts, variable.ts, keyword.ts
│   ├── snippet.ts, signature.ts, docblock.ts, dataType.ts
│   ├── query.ts, globals.ts, userFunction.ts, operator.ts
│   ├── catch.ts, cgi.ts
│   ├── css/                 # CSS-related entity definitions
│   └── html/                # HTML-related entity definitions
├── features/                # Language feature providers (non-LSP)
│   ├── autoclose.ts         # Auto-close tag insertion
│   ├── cachedEntities.ts    # In-memory cache of components, functions, scopes, variables
│   ├── colorProvider.ts     # Document color provider
│   ├── commands.ts          # Feature-level commands (cache refresh, foldAllFunctions)
│   ├── comment.ts           # Toggle line/block comment
│   ├── completionItemProvider.ts  # CFML dot-completion (. member access)
│   ├── definitionProvider.ts      # Go to definition
│   ├── docBlocker/          # DocBlock comment completion provider
│   ├── documentLinkProvider.ts    # Clickable links in documents
│   ├── hoverProvider.ts           # Hover information
│   ├── signatureHelpProvider.ts   # Function signature help
│   ├── statusBar.ts         # Status bar item management
│   ├── typeDefinitionProvider.ts  # Go to type definition
│   └── workspaceSymbolProvider.ts # Workspace-wide symbol search
├── settingMigration/        # Migrates legacy settings to new format
│   └── index.ts
├── tasks/                   # Custom task provider
│   ├── BoxLangTaskProvider.ts
│   └── indext.ts
├── test/                    # Test infrastructure and suites
│   ├── mocks/
│   ├── suite/               # 12 test files
│   ├── runTest.ts
│   └── runUnitTests.ts
├── utils/                   # Core utilities
│   ├── BoxLang.ts           # BoxLangWithHome launcher class
│   ├── CommandBox.ts        # CommandBox CLI integration
│   ├── Configuration.ts     # ExtensionConfig singleton, bvmrc support
│   ├── DebuggerManager.ts   # Debugger version management
│   ├── DownloadManager.ts   # S3 download logic with progress
│   ├── FeatureAudit.ts      # Feature usage audit engine
│   ├── ForgeBoxClient.ts    # ForgeBox API client
│   ├── Java.ts              # Java installation detection and download
│   ├── LanguageServer.ts    # LSP lifecycle (start, stop, restart, socket management)
│   ├── ModuleManager.ts     # BoxLang module installation/removal
│   ├── OutputChannels.ts    # Shared output channels
│   ├── ProcessTracker.ts    # Tracks child processes for cleanup on deactivation
│   ├── Server.ts            # BoxLang server configuration and management
│   ├── UpdateManager.ts     # Version update checking
│   ├── bvmrcSupport.ts      # .bvmrc file reading and version pinning
│   ├── cfdocs/              # CFDocs integration (online documentation lookup)
│   ├── collections.ts       # MyMap utility
│   ├── contextUtil.ts       # Document context helpers
│   ├── dateUtil.ts
│   ├── documentUtil.ts      # Document state context
│   ├── fileUtil.ts          # File resolution, mapping paths
│   ├── resourceProvider.ts  # Reads bundled resource files (prompts, schemas)
│   ├── snippetService.ts
│   ├── textUtil.ts
│   ├── versionManager.ts    # Runtime version download/cache management
│   └── workspaceSetup.ts    # BoxLangWithHome launcher factory
├── views/                   # Tree view data providers
│   ├── ServerHomesView.ts   # BoxLang Home management tree
│   └── ServerView.ts        # Server management tree
└── webviews/                # Webview-based UI panels
    └── featureaudit/        # Feature audit tool UI
```

Additional top-level directories:
- `boxlang.tmbundle/` — Legacy TextMate bundle (grammar source)
- `syntaxes/` — Compiled TextMate JSON grammars for both languages
- `snippets/` — Code snippets for BoxLang and CFML
- `resources/` — Bundled JARs, schemas, prompts, ANTLR grammars
- `icons/` — Extension icon assets and webfont

## Key Architectural Patterns

### Extension Context Pattern

Use the global context accessor instead of passing context through function parameters:

```typescript
import { getExtensionContext, setExtensionContext } from "./context";
// Set once during activate():
setExtensionContext(context);
// Access anywhere:
const ctx = getExtensionContext();
```

### Logging Pattern

Use `boxlangOutputChannel.appendLine()` for all logging — never `console.log`:

```typescript
import { boxlangOutputChannel } from "./utils/OutputChannels";
boxlangOutputChannel.appendLine("[LSP] Server started successfully");
```

Timestamps are added inline in the message string where needed.

### Language Server Lifecycle

LSP management in `src/utils/LanguageServer.ts` follows a sophisticated pattern:

1. **Module Resolution** — Downloads LSP modules to `globalStorage/lspVersions/` via `ModuleManager`
2. **Process Management** — Spawns JVM process with configurable heap, tracks via `ProcessTracker`
3. **Socket Communication** — Uses TCP sockets (`net.Socket`) with full lifecycle logging
4. **Restart Handling** — Debounced restart with configurable delay (`LSP_RESTART_DELAY_MS = 5000`)
5. **External LSP Support** — Set `BOXLANG_LSP_PORT` env var to connect to an already-running LSP
6. **Lifecycle Chaining** — Sequential start/stop operations via `lifecycleOperationChain` Promise chain
7. **Command Advertising** — Tracks server-side commands for UI context enablement (e.g., `createBxlintConfig`, `createFormatterConfig`, `convertCFFormatConfig`)

### Configuration Hierarchy

Settings are layered in `src/utils/Configuration.ts`:

1. `.bvmrc` file (workspace-specific version → `setBvmrcVersion()`)
2. `boxlang.boxlangVersion` user/workspace setting
3. `boxlang.java.javaHome` user/workspace setting
4. Bundled defaults (JARs in `resources/lib/`)

### Version Management Integration

BoxLang versions are downloaded from AWS S3 and cached in `globalStorage/boxlang_versions/`. The `DownloadManager` handles S3 downloads with progress reporting. The `.bvmrc` file in workspace root allows per-workspace version pinning. Files are watched via `FileSystemWatcher` for live `.bvmrc` changes.

### Component Caching

Extension maintains cached component definitions (`cachedEntities.ts`) for workspace symbols and completion. Cache invalidation happens on file save/delete via `FileSystemWatcher` monitors watching `COMPONENT_FILE_GLOB`. Application variable tracking (`Application.cfc` / `Application.cfm`) is separate from component caching.

### Auto-closing Tags

Integrates with the `formulahendry.auto-close-tag` extension if installed. When enabled, it registers `cfml` and `boxlang` as activation languages and adds non-closing CFML/BoxLang tags to the exclusion list. Falls back to a manual `insertAutoCloseTag()` implementation if the extension is not installed.

## Commands Reference

All commands are registered in `src/main.ts` → `activate()`. Subfolders in `src/commands/` organize them by domain:

### BoxLang Home Management
| Command ID | File |
|---|---|
| `boxlang.addBoxLangHome` | `commands/boxlangHome/addBoxLangHome.ts` |
| `boxlang.removeBoxLangHome` | `commands/boxlangHome/removeBoxLangHome.ts` |
| `boxlang.hardResetWorkspaceHome` | `commands/boxlangHome/hardResetWorkspaceHome.ts` |
| `boxlang.installModule` | `commands/boxlangHome/installModule.ts` |
| `boxlang.removeModule` | `commands/boxlangHome/removeModule.ts` |
| `boxlang.openBoxLangHome` | `commands/boxlangHome/openBoxLangHome.ts` |
| `boxlang.openBoxLangConfigFile` | `commands/boxlangHome/openBoxLangConfigFile.ts` |
| `boxlang.openModuleHomePage` | `commands/boxlangHome/openModuleHome.ts` |
| `boxlang.openLogFile` | `commands/boxlangHome/openLogFile.ts` |
| `boxlang.clearLogFile` | `commands/boxlangHome/clearLogFile.ts` |
| `boxlang.clearClassFiles` | `commands/boxlangHome/clearClassFiles.ts` |

### Version & Component Management
| Command ID | File |
|---|---|
| `boxlang.selectBoxLangVersion` | `commands/boxlangVersions/selectBoxLangVersion.ts` |
| `boxlang.removeBoxLangVersion` | `commands/boxlangVersions/removeBoxLangVersion.ts` |
| `boxlang.selectLSPVersion` | `commands/lsp/selectLSPVersion.ts` |
| `boxlang.selectDebuggerVersion` | `commands/debugger/selectDebuggerVersion.ts` |
| `boxlang.removeDebuggerVersion` | `commands/debugger/removeDebuggerVersion.ts` |
| `boxlang.selectMiniServerVersion` | `commands/miniserver/selectMiniServerVersion.ts` |
| `boxlang.reinstallBoxLangComponent` | `commands/reinstallBoxLangComponent.ts` |
| `boxlang.checkForUpdates` | `commands/checkForUpdates.ts` |
| `boxlang.downloadJava` | `commands/downloadJava.ts` |
| `boxlang.outputVersionInfo` | `commands/outputVersionInfo.ts` |

### LSP & Formatting
| Command ID | File |
|---|---|
| `boxlang.restartLSP` | `commands/lsp/restartLanguageServer.ts` |
| `boxlang.ui.createBxlintConfig` | `commands/lsp/createConfigFiles.ts` |
| `boxlang.ui.createFormatterConfig` | `commands/lsp/createConfigFiles.ts` |
| `boxlang.ui.convertCFFormatConfig` | `commands/lsp/createConfigFiles.ts` |

### Server Management
| Command ID | File |
|---|---|
| `boxlang.addServer` | `commands/server/addServer.ts` |
| `boxlang.deleteServer` | `commands/server/deleteServer.ts` |
| `boxlang.editServerProperty` | `commands/server/editServerProperty.ts` |
| `boxlang.runConfiguredServer` | `commands/server/runConfiguredServer.ts` |
| `boxlang.runServerFromLocation` | `commands/server/runServerFromLocation.ts` |
| `boxlang.debugServer` | `commands/server/debugServer.ts` |
| `boxlang.stopServer` | `commands/server/stopServer.ts` |
| `boxlang.openServerInBrowser` | `commands/server/openServerInBrowser.ts` |

### Execution & Tooling
| Command ID | File |
|---|---|
| `boxlang.runFile` | `commands/runBoxLangFile.ts` |
| `boxlang.runBoxLangREPL` | `commands/runBoxLangREPL.ts` |
| `boxlang.runWebServer` | `commands/runBoxLangWebServer.ts` |
| `boxlang.showStatusBarCommandPicker` | `commands/showStatusBarCommandPicker.ts` |
| `boxlang.openFeatureAuditTool` | `commands/openFeatureAuditTool.ts` |
| `boxlang.dumpVariable` | `commands/dumpVariable.ts` |
| `boxlang.dumpVariableFromPanel` | `commands/dumpVariable.ts` |
| `boxlang.migrateVSCodeSettings` | `commands/migrateVSCodeSettings.ts` |

### Deprecated (commented out in `activate()`)
| Command ID | Reason |
|---|---|
| `boxlang.transpileToJava` | Broke; planned move to `bx-language-tools` |
| `boxlang.showANTLRGraph` | Broke; planned move to `bx-language-tools` |
| `boxlang.showBoxLangASTGraph` | Broke; planned move to `bx-language-tools` |

## Chat Integration

### BoxLang Chat Participant (`boxlang.chat`)

- **Handler**: `src/chat/BoxLangParticipant.ts` — uses `@vscode/chat-extension-utils` (`sendChatParticipantRequest`) to delegate to a subagent
- **Prompt**: Loaded from `resources/BoxLangParticipantPrompt.md` via `resourceProvider.ts`
- **Tools**: Filters to tools tagged `'boxlang'` plus tools with `'fetch'` in their name
- **Commands**: Supports `docs` slash command for documentation links
- **Registration**: `vscode.chat.createChatParticipant("boxlang.chat", boxLangParticipantHandler)`

### Language Model Tool

- **Tool ID**: `boxlang-tools_lookupBoxLangDocumenation`
- **Reference name**: `lookupBoxLangDocumentation`
- **Class**: `src/chat/IncludeBoxLangDocumenationTool.ts`
- **Registration**: `vscode.lm.registerTool(...)` in `src/chat/tools.ts`
- **Input schema**: Single `text` string parameter describing the problem

## Debug Adapter

- **Factory**: `BoxLangDebugAdapter` in `src/debug/BoxlangDebugDescriptor.ts` — implements `DebugAdapterDescriptorFactory`
- **Communication**: `DebugAdapterServer` on a dynamically allocated port (`boxLangLauncher.startDebugger()`)
- **Tracker**: `BoxLangDebugAdapterTrackerFactory` in `src/debug/BoxLangDebugAdapterTracker.ts`
- **Dump Manager**: `DumpManager` in `src/debug/DumpManager.ts` — handles variable dump requests via the debug protocol
- **Configuration**: Supports `launch` and `attach` request types with `program` and `serverPort` properties

## Tree Views

| View ID | Provider | Purpose |
|---|---|---|
| `boxlang-servers` | `boxlangServerTreeDataProvider` (`src/views/ServerView.ts`) | Manage configured BoxLang servers |
| `boxlang-server-homes` | `boxlangServerHomeTreeDataProvider` (`src/views/ServerHomesView.ts`) | Manage BoxLang Home installations |

## Custom Task Provider

`BoxLangTaskProvider` in `src/tasks/BoxLangTaskProvider.ts` implements `vscode.TaskProvider` for `"boxlang"` task type. Tasks define a `command` (string) and optional `args` (string array).

## JSON Schema Validation

The extension contributes JSON validation schemas in `package.json`:

| File pattern | Schema |
|---|---|
| `*boxlang.json`, `**/*boxlang.json` | `resources/schemas/boxlang_schema.json` |
| `*bxformat.json`, `**/*bxformat.json` | `resources/schemas/bxformat.schema.json` |

## Configuration Properties

Key `boxlang.*` settings defined in `package.json` → `contributes.configuration`:

| Setting | Scope | Description |
|---|---|---|
| `boxlang.settings.ignoreOldSettings` | application | Suppress legacy settings migration prompts |
| `boxlang.java.javaHome` | machine | Path to JDK 21+ installation |
| `boxlang.jarpath` | machine | Path to BoxLang runtime JAR |
| `boxlang.boxlangVersion` | resource | BoxLang version to use (default: `1.13.0`) |
| `boxlang.miniserverjarpath` | machine | Path to MiniServer JAR |
| `boxlang.boxLangHome` | — | Custom BoxLang home directory path |

### Configuration Change Handling

`src/main.ts` watches for configuration changes and automatically:
- Restarts all processes when `boxlang.java.javaHome`, `boxlang.lsp.maxHeapSize`, `boxlang.lsp.lspVersion`, or `boxlang.boxLangHome` change
- Notifies the LSP when any `boxlang` setting changes
- Refreshes global definitions when `boxlang.cfml.*` settings change

## External Dependencies

- **CommandBox** — CLI tool for BoxLang module management (installed via `setupCommandBox()`)
- **AWS S3** — BoxLang version downloads (no authentication required)
- **Java 21+** — Required runtime; auto-downloads if not found via `downloadJava` command
- **ForgeBox** — Module registry accessed via `ForgeBoxClient.ts`
- **CFDocs** — Online CFML/BoxLang documentation lookup via `cfdocs/`

## Cross-Component Communication

- **Settings Changes** trigger LSP restart, process cleanup, and workspace refresh
- **File Watchers** monitor `.bvmrc` changes, component file creation/deletion, and `Application.cfm` changes
- **Process Tracking** via `utils/ProcessTracker.ts` for cleanup on deactivation (`cleanupTrackedProcesses()`)
- **Output Channels** — `boxlangOutputChannel` is the primary log sink; `CFDocsService` has a dedicated channel

## Testing

Tests use **Mocha** framework in `src/test/suite/`. The test suite has **12 test files**:

| Test file | Coverage |
|---|---|
| `statusBar.test.ts` | Status bar functionality |
| `BoxLang.test.ts` | BoxLang launcher |
| `Configuration.test.ts` | Configuration resolution |
| `DownloadManager.test.ts` | S3 download logic |
| `ForgeBoxClient.test.ts` | ForgeBox API client |
| `LanguageServer.test.ts` | LSP lifecycle |
| `MainLifecycle.test.ts` | Extension activation/deactivation |
| `ModuleManager.test.ts` | Module management |
| `SettingMigration.test.ts` | Settings migration |
| `UpdateManager.test.ts` | Update checking |
| `versionManager.test.ts` | Version management |

Run tests:
```bash
npm test
```

## Build & Development

```bash
# Primary development build (TypeScript compiler → out/)
npm run build

# Watch mode for active development
npm run watch

# Web extension build (Webpack → dist/web/)
npm run compile-web
npm run watch-web

# Lint
npm run lint

# Package extension for distribution
npm run pack     # Uses @vscode/vsce to create .vsix
```

### TypeScript Configuration

- **Target**: ES2021
- **Module**: CommonJS
- **Output**: `out/` directory
- **Source maps**: Enabled
- **Strict options**: `alwaysStrict`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noImplicitThis`, `noUnusedLocals`

### Web Extension

The web extension build (`compile-web`) uses **Webpack** (`webpack.config.js`) targeting `webworker` with polyfills for Node.js modules (`path`, `net`, `tls`, `http`, `child_process`). Output goes to `dist/web/main.js`.

## LSP Debug Mode

Set `BOXLANG_LSP_PORT` environment variable to connect to an external LSP server instead of spawning an internal process. The external LSP flag (`isUsingExternalLSP`) is checked in `src/utils/LanguageServer.ts`.

## Error Handling Patterns

Always use `boxlangOutputChannel.appendLine()` for logging. Errors should include context:

```typescript
logLanguageServer(`stopExtensionServices() failed reason=${reason}: ${error.message}`);
```

For async operations, use `try/catch` with the output channel:

```typescript
try {
    await someAsyncOperation();
} catch (e) {
    boxlangOutputChannel.appendLine(`BoxLang: Operation failed: ${e.message}`);
}
```
