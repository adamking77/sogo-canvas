# Sogo Canvas V1 Spec

## Product Position

Sogo Canvas is a refined VS Code-native infinite canvas for planning, architecture mapping, note clustering, and decision visualization.

V1 is intentionally narrow:

- better design than Charkoal
- calmer interaction than typical whiteboards
- JSON Canvas-compatible file format
- bottom-toolbar-first UX

## File Format

V1 uses standard `.canvas` JSON files and stays compatible with JSON Canvas wherever possible.

Standard fields are used for core data:

- `nodes`
- `edges`
- node `type`
- node `x`, `y`, `width`, `height`
- node `color`
- file/image/link node path fields

Sogo-specific presentation details are stored in namespaced metadata so other tools can ignore them safely:

```json
{
  "nodes": [
    {
      "id": "node-1",
      "type": "text",
      "x": 100,
      "y": 120,
      "width": 320,
      "height": 120,
      "text": "Architecture note",
      "color": "default",
      "sogo": {
        "shape": "rounded",
        "border": "subtle",
        "textAlign": "left"
      }
    }
  ],
  "edges": [],
  "sogo": {
    "background": "dots"
  }
}
```

## V1 Canvas Controls

Global controls live in a persistent bottom toolbar.

Bottom toolbar sections:

- create text node
- create group node
- create file node
- create image node
- switch background mode: plain, dots, grid

When a single node is selected, the same bottom toolbar exposes node formatting:

- color preset
- shape preset
- border preset
- text alignment

There is no permanent side inspector in v1.

## V1 Node Types

### Text Node

- plain text first
- inline editing
- default shape: rounded

### Group Node

- titled container
- visually light
- used for clustering

### File Node

- references a workspace-relative file path
- label-first presentation in v1

### Image Node

- references an image path
- label-first in the initial scaffold
- thumbnail preview is the first upgrade after baseline interaction polish

## V1 Interaction Model

- infinite canvas
- double-click empty space creates a text node
- drag canvas to pan
- mouse wheel or trackpad to zoom
- drag handles to create edges
- Enter edits selected text node
- Escape exits editing
- Delete removes current selection
- background mode is stored per canvas file

## Visual Direction

Reference direction is Obsidian Canvas:

- sparse chrome
- dark, quiet surface
- crisp dotted/grid backgrounds
- soft contrast
- restrained outlines
- prominent but not loud selection states

Sogo should feel slightly more native to VS Code and less like a standalone web app.

## V1 Visual Tokens

### Color Presets

Based on the Obsidian-style reference palette:

- `default`
- `pink`
- `orange`
- `yellow`
- `green`
- `cyan`
- `lavender`
- `rainbow`

In v1, the selected color drives both node surface tint and border accent.

### Shape Presets

V1 keeps the shape set small:

- `rect`
- `rounded`
- `pill`
- `diamond`
- `circle`

## Explicit V1 Non-Goals

- multiplayer
- AI generation
- auto-layout
- markdown-rich text editing
- advanced shape libraries
- large inspector panels
- heavy formatting UI
