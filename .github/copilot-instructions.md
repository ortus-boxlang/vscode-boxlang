# BoxLang VS Code Extension - AI Agent Instructions

## Architecture Overview

This is a VS Code extension for BoxLang (a CFML-like language) that provides language support, debugging, server management, and AI chat integration. The extension follows a modular architecture with clear separation of concerns.

### Core Components

- **Language Server Protocol (LSP)** - Provides syntax highlighting, hover, completion, and diagnostics via a separate BoxLang LSP server process
- **Debug Adapter** - Implements VS Code's debug protocol for BoxLang runtime debugging
- **Chat Integration** - Custom AI participant with documentation lookup tools
- **Server Management** - MiniServer management for local development
- **Version Management** - Downloads and manages BoxLang runtime versions from AWS S3

## Key Architectural Patterns

### Dual Language Support
The extension supports both `cfml` and `boxlang` language IDs with shared features:
```typescript
const DOCUMENT_SELECTOR: DocumentSelector = [
    { language: "cfml", scheme: "file" },
    { language: "boxlang", scheme: "file" }
];
```

### Language Server Lifecycle
LSP management follows a specific pattern in `src/utils/LanguageServer.ts`:
1. **Module Resolution** - Downloads LSP modules to `globalStorage/lspVersions/`
2. **BoxLang Home Setup** - Creates isolated LSP environment
3. **Version Coordination** - Matches LSP module with compatible BoxLang runtime
4. **Socket Communication** - Uses TCP sockets for LSP communication

### Configuration Hierarchy
Settings are layered via `src/utils/Configuration.ts`:
1. `.bvmrc` file (workspace-specific version)
2. User configuration (`boxlang.*`)
3. Bundled defaults (extension resources)

### Extension Context Patterns
Use the global context accessor: `getExtensionContext()` from `src/context.ts` instead of passing context through function parameters.

## Critical Developer Workflows

### Build & Development
```bash
# Primary development build (uses TypeScript compiler)
npm run build

# Watch mode for active development
npm run watch

# Web extension build (uses Webpack)
npm run compile-web
npm run watch-web

# Testing
npm test
```

### Extension Packaging
```bash
npm run pack  # Creates .vsix file for installation
```

### LSP Debug Mode
Set `BOXLANG_LSP_PORT` environment variable to connect to external LSP server instead of spawning internal process.

## Project-Specific Conventions

### File Organization
- `src/main.ts` - Extension activation entry point
- `src/utils/` - Core utilities (LSP, configuration, version management)
- `src/commands/` - VS Code command implementations
- `src/features/` - Language features (hover, completion, etc.)
- `src/chat/` - AI chat participant and tools
- `src/debug/` - Debug adapter implementation
- `boxlang.tmbundle/` - TextMate grammar and syntax definitions

### Error Handling Patterns
Use `boxlangOutputChannel.appendLine()` for logging instead of console methods:
```typescript
import { boxlangOutputChannel } from "./utils/OutputChannels";
boxlangOutputChannel.appendLine("Operation completed successfully");
```

### Async Setup Pattern
Extension setup follows async initialization in `runSetup()`:
```typescript
await setupLocalJavaInstall(context);
await setupWorkspace(context);
setupConfiguration(context);
// ... other setup tasks
```

### Version Management Integration
BoxLang versions are downloaded from S3 and cached in `globalStorage/boxlang_versions/`. The `.bvmrc` file support allows per-workspace version selection.

## Integration Points

### VS Code APIs
- **Language Client** - `vscode-languageclient/node` for LSP communication
- **Debug Protocol** - Custom `BoxLangDebugAdapter` implementing VS Code debug API
- **Chat API** - `@vscode/chat-extension-utils` for AI participant integration
- **Tree Views** - Server and home management via custom tree data providers

### External Dependencies
- **CommandBox** integration for BoxLang module management
- **AWS S3** for BoxLang version downloads (no auth required)
- **Java Runtime** requirement (auto-downloads Java 21 if needed)

### Cross-Component Communication
- **Settings Changes** trigger LSP restart and process cleanup
- **File Watchers** monitor `.bvmrc` changes and component files
- **Process Tracking** via `utils/ProcessTracker.ts` for cleanup on deactivation

## Language Features Implementation

### CFML vs BoxLang Feature Targeting
Some features are CFML-specific (legacy compatibility):
```typescript
// Use CF_DOCUMENT_SELECTOR for CFML-only features
const CF_DOCUMENT_SELECTOR: DocumentSelector = [
    { language: "cfml", scheme: "file" }
];
```

### Component Caching
Extension maintains cached component definitions for workspace symbols and completion. Cache invalidation happens on file save/delete via FileSystemWatcher.

### Auto-closing Tags
Integrates with `formulahendry.auto-close-tag` extension, with fallback manual implementation if extension not installed.

## Testing Patterns
Tests use Mocha framework in `src/test/suite/`. Current test coverage focuses on:
- Status bar functionality (`statusBar.test.ts`)
- Run tests via `npm test` after building

Follow existing patterns for unit testing VS Code extension components and language features.