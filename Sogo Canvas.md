# Sogo Canvas

Date: 2026-03-24

## Objective

Define the direction for a future Sogo-native canvas extension for VS Code.

The goal is not to out-feature every whiteboard tool. The goal is to build a canvas surface that feels native to VS Code, looks materially better than Charkoal, and improves visual quality without increasing complexity.

## Why This Exists

Charkoal is functionally good enough.

The problem is not that it fails to work. The problem is that it looks and feels underdesigned:

- visually coarse
- weak theme integration
- limited refinement in typography, spacing, and interaction polish
- does not feel like a premium native part of the workspace

For Sogo, the canvas should not feel like a tolerated utility. It should feel like a serious thinking surface inside the business workspace.

## Core Product Thesis

Build a canvas extension like Charkoal in function, but with:

- stronger visual design
- deeper alignment with VS Code theme tokens
- more refined node and edge styling
- cleaner interaction model
- no meaningful increase in cognitive load

The standard is:

- more sophisticated UI
- simpler-feeling UX

## What It Is

A theme-native canvas extension for VS Code that supports spatial thinking, planning, and architecture mapping inside the workspace.

It should feel appropriate for:

- product thinking
- architecture diagrams
- planning boards
- strategy mapping
- note clusters
- decision visualization

## What It Is Not

It is not a general-purpose whiteboard trying to beat Miro.

It is not a highly complex diagramming platform trying to beat Lucidchart.

It is not an excuse to add layers of controls, inspectors, settings, and builder chrome.

It is not a feature race.

## Design Principles

### 1. Native to VS Code

Use VS Code theme variables and platform conventions wherever possible.

The extension should look good in:

- dark themes
- light themes
- high-contrast themes
- custom user themes

The user should not need a special Sogo theme for the canvas to feel integrated.

### 2. Sophisticated, Not Decorative

The visual system should be restrained and intentional:

- better spacing
- better hierarchy
- better typography
- cleaner color use
- stronger node proportions
- more polished connector lines and selection states

The goal is refinement, not visual noise.

### 3. Lower Friction Than Existing Tools

The extension should not require users to learn more just because it looks better.

That means:

- fewer visible controls
- clear default behaviors
- command palette support
- predictable keyboard flow
- minimal mode switching

### 4. Readability First

Most canvas tools fail by making thinking artifacts hard to read.

Sogo Canvas should bias toward:

- legible node sizing
- strong text wrapping defaults
- good spacing between clusters
- clean group containers
- easy scanning on large canvases

### 5. Calm Interaction Model

Interactions should feel steady and deliberate:

- smooth pan/zoom
- clear selection feedback
- clean drag behavior
- edges that are easy to create and edit
- no jittery or noisy motion

## Functional Scope

### MVP

The first version should stay narrow.

Core capabilities:

- text nodes
- group nodes
- image nodes
- link/file reference nodes
- edges/connectors
- canvas pan/zoom
- keyboard shortcuts for core actions
- theme-native styling
- save/load canvas files

### Likely Later

- templates
- quick layout helpers
- markdown-backed rich text nodes
- better alignment/distribution tools
- embedded previews for local files
- AI-assisted node generation from notes or docs

### Explicitly Not Early Priorities

- real-time collaboration
- multiplayer cursors
- advanced shape libraries
- presentation mode
- giant formatting toolbars
- enterprise diagramming features

## UX Standard

The extension should feel:

- lighter than a whiteboard app
- more elegant than Charkoal
- more native than a web app stuffed into VS Code

The ideal reaction is:

"This feels like VS Code grew a beautiful canvas mode."

Not:

"This is another canvas app living inside VS Code."

## Visual Direction

The canvas should adapt to the active theme automatically.

Important visual elements:

- node surface colors derived from theme tokens
- borders and shadows subtle enough to match editor chrome
- selection states that are visible without being loud
- connector lines that feel crisp, not clumsy
- typography that respects editor-scale reading
- groups that create structure without looking heavy

The visual language should be premium but quiet.

## Product Positioning

If Sogo dashboards become the analytical surface, Sogo Canvas becomes the spatial thinking surface.

That gives the workspace three strong modes:

- structured data
- written knowledge
- spatial thinking

This makes the extension ecosystem feel cohesive rather than fragmented.

## Strategic Reason To Build It

There is room for a VS Code-native canvas extension that prioritizes quality of experience instead of just minimum viable utility.

That matters because:

- builders increasingly live inside VS Code all day
- canvases are useful for architecture and planning
- current options often work but feel visually weak
- Sogo benefits from owning more of the workspace experience over time

If the dashboard work gives Sogo an operational surface, the canvas work gives it a strategy and architecture surface.

## Suggested Build Philosophy

Build this as a focused product with strict restraint.

Rules:

- do not add controls unless they materially reduce friction
- do not add complexity in the name of flexibility
- do not overfit to power-user edge cases in v1
- polish defaults before adding options
- make the canvas feel calm and premium before making it broad

## Naming

Working name:

- `Sogo Canvas`

Possible alternatives later if needed:

- `GenZen Canvas`
- `Sogo Boards`
- `Sogo Spatial`

`Sogo Canvas` is the clearest name for now.

## First Deliverable

The first serious next step should be a product brief or UX spec covering:

- file format direction
- node types
- edge behavior
- selection model
- theme token strategy
- keyboard model
- what to keep simpler than Charkoal

## Summary

Sogo Canvas should be built as a refined, theme-native, low-complexity canvas extension for VS Code.

The value is not "more features than Charkoal."

The value is:

- better design
- better theme integration
- better readability
- better interaction polish
- no unnecessary increase in complexity

That is a credible and worthwhile product direction.
