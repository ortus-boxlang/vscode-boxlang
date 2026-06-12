# BoxLang for VS Code 1.20.0 and BoxLang LSP 1.11.0

The latest BoxLang for VS Code release is about making the editor feel steadier while the language tooling around it becomes far more capable. On the extension side, version 1.20.0 improves how the language server starts and reconnects so the editor is less likely to get stuck in an inconsistent state during rapid restarts or externally managed sessions.

Most of the visible gains in this release cycle come from the BoxLang language server itself. BoxLang LSP 1.11.0 is a substantial step forward in day-to-day development: smarter navigation, better completions, stronger diagnostics, easier configuration, and a more reliable editing loop.

## A More Reliable Extension Layer

BoxLang for VS Code 1.20.0 tightens the language server lifecycle inside the extension. The startup path now does a better job preventing duplicate `startLSP()` attempts and keeping the VS Code client state aligned with the actual server state.

For developers, that translates into a more predictable experience when the language server restarts, reconnects, or is managed outside the extension. It is not a flashy feature, but it removes a class of editor friction that tends to show up at the worst possible time.

## BoxLang LSP 1.11.0: A Much Smarter Daily Driver

BoxLang IDE tooling has moved well beyond basic language support. With LSP 1.11.0, the experience is starting to feel much closer to a complete everyday development environment for real-world BoxLang applications.

### Richer Navigation and Code Intelligence

The biggest leap is in language intelligence and code navigation. Developers now get richer hover details, find references, go to definition, go to type definition, and go to implementation. Workspace-wide symbol search and improved document symbols also make it easier to move through larger projects and keep the outline view useful instead of noisy.

Semantic tokens round that out with better highlighting for declarations, calls, member access, and properties. In practice, this makes larger files easier to scan and helps important code structure stand out faster.

### Better Completions in Real Editing Scenarios

Auto-completion has improved across nearly every common editing path. The language server now provides more context-aware completions for variables, functions, class names, imports, named arguments, and member access after dot notation.

BXM tag completion has also been expanded with rich Markdown documentation, and the tooling now does a better job with snippets and auto-import behavior. That means BoxLang code feels more discoverable while you write it, especially when you are working with unfamiliar APIs, moving between modules, or building out new files quickly.

### Stronger Project Awareness and Guided Fixes

Another major improvement is project and workspace awareness. The language server has a much better understanding of real application structure, including ColdBox detection, implicit mappings, user-defined mappings, and workspace mapping reindexing.

That broader project model pays off when something is misconfigured. When an `extends` target cannot be resolved, the tooling can now surface likely mapping matches and offer quick fixes to add the missing mapping in `Application.bx`, `boxlang.json`, or `.bxlint.json`. Instead of just reporting an error, the editor can help repair the setup.

### Better Formatting, Linting, and Diagnostics

Formatting and linting have both taken meaningful steps forward. BoxLang formatting is now available through the language server behind a feature flag, and the IDE can help bootstrap the surrounding configuration with commands to create a starter `.bxlint.json`, create a `.bxformat.json`, or convert existing `.cfformat.json` and `.cfconfig.json` files into BoxLang formatter settings.

Linting support is also deeper. The platform now includes richer configuration support, generated schema and configuration docs, completions for `.bxlint` rule IDs, annotation-based suppression, and comment-based `bxlint:disable` and `bxlint:enable` directives with class- and function-scoped control.

Diagnostics around query safety have improved as well, including checks for unescaped query interpolations and missing `cfsqltype` attributes on `<cfqueryparam>`, along with quick fixes and refactor actions to help clean them up.

### Faster, Cleaner, and More Reliable

The latest LSP work also improves the feel of the editor by reducing friction that accumulates over time. Recent changes improve initial parse behavior, reduce false positives, refresh mappings and diagnostics when `.bxlint.json` changes without requiring a restart, and fix cases such as unused imports being incorrectly flagged when they are only referenced through static method calls.

Taken together, these changes make BoxLang tooling feel far more mature. Navigation is deeper, completions are smarter, diagnostics are more actionable, configuration is easier, and the overall feedback loop is smoother.

## Why This Release Matters

The combination of BoxLang for VS Code 1.20.0 and BoxLang LSP 1.11.0 pushes the platform closer to a full-time BoxLang editing experience instead of a promising early toolchain. The extension layer is more stable, and the language server delivers the kind of navigation, completion, diagnostics, and guided repair that developers expect in a modern IDE.

If you have not tried the latest BoxLang tooling in a while, this is a good release to revisit. The improvements are not isolated to one command or one feature. They show up throughout the entire edit, navigate, diagnose, and refactor cycle.
