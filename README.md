# Empyrion Codex

A community-made browser tool for exploring scenario data from [Empyrion - Galactic Survival Survival](https://store.steampowered.com/app/383120/Empyrion__Galactic_Survival/). Look up any item, block, or trader across any scenario — with no installation and no tracking.

Everything runs entirely in your browser. Your files never leave your device.

> **Disclaimer:** Empyrion Codex is an independent, community-made tool and is not affiliated with, endorsed by, or in any way officially connected to Eleon Game Studios or the Empyrion - Galactic Survival Survival game.

---

## Features

- **Browse items & blocks** — search by name or description, filter by category and vessel type, sort by ID, name, or price
- **Browse traders** — see what each NPC sells and buys, with estimated price ranges and stock quantities
- **Trade opportunities** — find items that one trader sells and another buys, sorted by estimated profit
- **Crafting recipes** — view full ingredient lists with optional ingredient flattening and materials cost estimates
- **Localization** — loads display names and descriptions from `Localization.csv`
- **Item icons** — resolved automatically when loading a scenario folder
- **Scenario import/export** — package all loaded data into a single `.empcdx` file for instant reloading without the original ECF files
- **Saved scenarios** — recent scenarios are cached in your browser's IndexedDB automatically
- **No backend, no runtime dependencies** — once built, it's a static web app; open `index.html` in any modern browser and go

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) — needed to build the CSS bundle and to serve the app locally
- A modern browser (Chrome, Edge, or Firefox)

### Running locally

```bash
# Install dev dependencies
npm install

# Build the Tailwind CSS bundle
npm run build

# Serve the app over HTTP (required — file:// won't work)
npm start
```

`npm start` serves the `src/` folder on `http://localhost:3000` using [serve](https://github.com/vercel/serve).

> **Note:** You must serve the app over HTTP — opening `index.html` directly as a `file://` URL will not work. Browsers block ES module imports under `file://` due to CORS restrictions. Any local HTTP server works; `npm start` is the easiest option.

### During development

```bash
# Rebuild CSS automatically on file changes
npm run watch
```

---

## Loading data

### Option A — Import a scenario folder

Click **Import Scenario** on the Scenarios page and select the root folder of any Empyrion scenario. The tool will automatically find and load `ItemsConfig.ecf`, `BlocksConfig.ecf`, `TraderNPCConfig.ecf`, `Templates.ecf`, `TokenConfig.ecf`, and `Localization.csv`.

Vanilla scenarios are usually at:
```
…\Steam\steamapps\common\Empyrion - Galactic Survival\Content\Scenarios
```

Workshop scenarios are usually at:
```
…\Steam\steamapps\workshop\content\383120
```

### Option B — Load individual files

Use the individual upload buttons to load one or more ECF files and/or a Localization CSV at your own pace.

### Option C — Import a `.empcdx` file

If you or someone else previously exported data via the **Export** button, you can load the resulting `.empcdx` file directly to restore all data at once, without needing the original ECF files.

---

## Project structure

```
src/
├── app.js                    # Application entry point — wiring, state, UI orchestration
├── db.js                     # Lightweight IndexedDB wrapper for saved scenarios
├── index.html                # Single-page shell
├── input.css                 # Tailwind CSS entry point
├── parsers/
│   ├── BaseConfigParser.js   # Abstract base with Template Method pattern for ECF parsing
│   ├── BlocksConfigParser.js
│   ├── ItemsConfigParser.js
│   ├── LocalizationParser.js
│   ├── ParserFactory.js
│   ├── TemplatesConfigParser.js
│   ├── TokenConfigParser.js
│   ├── TraderNPCConfigParser.js
│   ├── ecf/
│   │   ├── EcfBlock.js       # Parsed ECF block node
│   │   ├── EcfParser.js      # Low-level ECF tokeniser/parser
│   │   └── EcfProperty.js    # Key/value property on a block
│   └── models/
│       ├── Block.js
│       ├── Item.js
│       ├── Template.js
│       ├── Token.js
│       └── TraderNPC.js
└── ui/
    ├── categoryIcons.js      # SVG icon map by item category
    ├── ItemDetailRenderer.js # Detail drawer for items/blocks
    ├── ItemListRenderer.js   # Items grid
    ├── renderUtils.js        # Shared escaping, formatting, and click-handler utilities
    ├── TraderDetailRenderer.js
    └── TraderRenderer.js
```

---

## Tech stack

| Concern | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules, no framework) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Persistence | Browser IndexedDB |
| Build | Tailwind CLI only |
| Runtime dependencies | None |

---

## Contributing

Contributions are welcome — bug fixes, new features, parser improvements, and general polish are all fair game.

### How to contribute

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes.** Keep commits focused; one logical change per commit is ideal.
3. **Test manually** in at least one browser with a real scenario folder.
4. **Open a pull request** with a clear description of what changed and why.

If you're planning something larger, opening an issue first to discuss the approach is appreciated — it saves everyone time.

### Guidelines

- **Scope** — keep PRs focused. Avoid bundling unrelated changes.
- **Style** — match the existing code style (vanilla JS ES modules, JSDoc for public APIs, Tailwind utility classes, no new runtime dependencies).
- **Security** — always escape user-visible strings via `escapeHtml` before inserting into innerHTML. Avoid `eval` and dynamic `import()` on user-provided data.
- **Comments** — explain *why*, not *what*. Self-evident code doesn't need a comment.
- **No breaking changes to the `.empcdx` format** without a version bump and a migration path.

### Bug reports

Please use the [GitHub issue tracker](https://github.com/DrDarkDK/empyrion-codex/issues). Include:
- What you expected to happen
- What actually happened
- The browser and version you were using
- A sample ECF file or scenario name, if relevant

---

## License

[ISC](https://opensource.org/licenses/ISC)

---

## Acknowledgements

Inspired by [EmpyrionBuddy](https://empyrionbuddy.com) — a great tool in its own right, well worth checking out.