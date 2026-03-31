# Sogo Canvas

Sogo Canvas is a VS Code custom editor for `.canvas` files. It gives you a theme-native infinite canvas inside the editor, backed by a readable JSON document you can keep in your repo.

The current build is intentionally focused: a clean canvas surface, a small set of useful node types, and a file format that stays easy to diff, inspect, and generate.

## What it does

- Opens `.canvas` files in a custom editor inside VS Code.
- Creates new canvases with the `Sogo Canvas: New Canvas` command.
- Supports text cards, groups, file references, and image references.
- Supports connectors with color, dashed/solid state, and optional arrowheads.
- Persists canvas background, snap-to-grid, and viewport state in the document.
- Auto-saves back to JSON as you edit.
- Uses VS Code theme tokens so the canvas feels native in light and dark themes.

## Current interaction model

- Double-click empty space to insert a text card.
- Use the bottom toolbar to insert cards, groups, file references, and image references.
- Double-click or press `Enter` on a text card or group to edit inline.
- Drag from node handles to connect nodes.
- Select multiple nodes with marquee selection to wrap them in a group.
- Use `Delete` or `Backspace` to remove the selected node or connector.
- Use the background tray to switch between plain, dot, and grid canvas modes, and to toggle snap-to-grid.

## File format

Canvas documents are JSON with three top-level sections:

```json
{
  "nodes": [],
  "edges": [],
  "sogo": {
    "background": "dots",
    "snapToGrid": false,
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    }
  }
}
```

Node types currently supported:

- `text`
- `group`
- `file`
- `image`

Each node stores position, size, styling metadata, and optional text or file-path data. Each edge stores source and target node ids, handle sides, color, line style, and arrowhead state.

The repo includes [`test.canvas`](/Users/adamking/projects/sogo-work/sogo-canvas/test.canvas) as a larger example document you can open in the editor.

## Repository layout

- [`extension`](/Users/adamking/projects/sogo-work/sogo-canvas/extension): VS Code extension host code and packaged webview assets.
- [`webview`](/Users/adamking/projects/sogo-work/sogo-canvas/webview): React-based canvas UI built with Vite.
- [`logo-bauhaus-s-dark-primary.svg`](/Users/adamking/projects/sogo-work/sogo-canvas/logo-bauhaus-s-dark-primary.svg): source artwork for the extension icon.

## Development

Requirements:

- Node.js 20+ is the safe baseline for current tooling.
- npm workspaces enabled via the default npm client.
- VS Code 1.89+ to match the extension engine range.

Install dependencies:

```bash
npm install
```

Build everything:

```bash
npm run build
```

Type-check everything:

```bash
npm run typecheck
```

Run in development:

1. Open the repository in VS Code.
2. Run `npm install` once.
3. Run `npm run build` or `npm run watch`.
4. Start the extension host from VS Code's Run and Debug panel.

## Packaging and publishing

The publishable extension lives in [`extension`](/Users/adamking/projects/sogo-work/sogo-canvas/extension).

Package a VSIX:

```bash
cd extension
npx @vscode/vsce package
```

Publish to Marketplace:

```bash
cd extension
npx @vscode/vsce publish
```

Notes:

- VS Code Marketplace does not allow SVG extension icons. The packaged icon is [`extension/icon.png`](/Users/adamking/projects/sogo-work/sogo-canvas/extension/icon.png), generated from the source SVG.
- If you add images to the marketplace README later, keep them as HTTPS-hosted PNG or JPG assets. Marketplace publishing rejects user-provided SVG images in README content.

## Screenshots

Screenshots are not required for GitHub or for VS Code Marketplace publication, but this extension is highly visual, so they are strongly recommended before a wider release. Two or three focused shots would do most of the work:

- an empty themed canvas
- a realistic canvas with grouped nodes and connectors
- the contextual toolbar and background controls

## Status and gaps

- Early version: `0.0.1`
- No automated test suite is wired up yet.
- License is currently marked `UNLICENSED`.
- The editor currently prioritizes a clean core interaction model over advanced canvas features like rich node types, collaboration, or export flows.
