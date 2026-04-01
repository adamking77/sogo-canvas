import {
  addEdge,
  Connection,
  ConnectionMode,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeResizer,
  NodeProps,
  Position,
  ReactFlow,
  Viewport,
  PanOnScrollMode,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

type SogoBackground = "plain" | "dots" | "grid";
type SogoShape =
  | "rounded"
  | "rect"
  | "pill"
  | "diamond"
  | "parallelogram"
  | "circle";
type SogoBorder = "none" | "subtle" | "strong";
type SogoTextAlign = "left" | "center" | "right";
type EdgeLineStyle = "solid" | "dashed";
type CanvasNodeType = "text" | "group" | "file" | "image";
type CanvasSide = "top" | "right" | "bottom" | "left";
type BottomPanel = "background" | null;
type SelectionPanel = "color" | "shape" | "border" | "align" | null;
type EdgePanel = "color" | null;

interface SogoNodeMeta {
  shape?: SogoShape;
  border?: SogoBorder;
  textAlign?: SogoTextAlign;
}

interface SogoCanvasMeta {
  background?: SogoBackground;
  snapToGrid?: boolean;
  viewport?: Viewport;
}

interface CanvasNodeData {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  color?: string;
  file?: string;
  url?: string;
  sogo?: SogoNodeMeta;
}

interface CanvasEdgeData {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  color?: string;
  lineStyle?: EdgeLineStyle;
  arrow?: boolean;
}

interface CanvasDocumentData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  sogo?: SogoCanvasMeta;
}

interface VscodeApi {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
}

interface PendingRequest {
  resolve: (value?: string) => void;
}

interface CanvasNodeViewData extends CanvasNodeData {
  assetUri?: string;
  draftText?: string;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeApi;
  }
}

const vscode = window.acquireVsCodeApi?.();

const colorOptions = [
  "default",
  "pink",
  "orange",
  "yellow",
  "green",
  "cyan",
  "lavender",
  "rainbow"
] as const;
type CanvasColor = (typeof colorOptions)[number];

const shapeOptions: SogoShape[] = [
  "rect",
  "rounded",
  "pill",
  "diamond",
  "parallelogram",
  "circle"
];
const borderOptions: SogoBorder[] = ["none", "subtle", "strong"];
const alignOptions: SogoTextAlign[] = ["left", "center", "right"];
const backgroundOptions: SogoBackground[] = ["plain", "dots", "grid"];
const canvasGridSize = 24;

const pendingRequests = new Map<string, PendingRequest>();
const colorOptionSet = new Set<string>(colorOptions);
const shapeOptionSet = new Set<string>(shapeOptions);
const borderOptionSet = new Set<string>(borderOptions);
const alignOptionSet = new Set<string>(alignOptions);

const colorAliases: Record<string, CanvasColor> = {
  "0": "default",
  "1": "pink",
  "2": "orange",
  "3": "yellow",
  "4": "green",
  "5": "cyan",
  "6": "lavender",
  "7": "rainbow",
  gray: "default",
  grey: "default",
  neutral: "default",
  none: "default",
  red: "pink",
  magenta: "pink",
  amber: "orange",
  gold: "yellow",
  lime: "green",
  teal: "cyan",
  aqua: "cyan",
  blue: "cyan",
  purple: "lavender",
  violet: "lavender"
};

const shapeAliases: Record<string, SogoShape> = {
  rectangle: "rect",
  square: "rect",
  box: "rect",
  roundedrect: "rounded",
  "rounded-rect": "rounded",
  "rounded_rect": "rounded",
  pill: "pill",
  capsule: "pill",
  oval: "pill",
  rhombus: "diamond",
  slanted: "parallelogram",
  ellipse: "circle"
};

function normalizeToken(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeColor(value?: string): CanvasColor {
  const normalized = normalizeToken(value);

  if (!normalized) {
    return "default";
  }

  if (normalized in colorAliases) {
    return colorAliases[normalized];
  }

  return colorOptionSet.has(normalized) ? (normalized as CanvasColor) : "default";
}

function normalizeShape(value?: string): SogoShape {
  const normalized = normalizeToken(value);

  if (!normalized) {
    return "rounded";
  }

  if (normalized in shapeAliases) {
    return shapeAliases[normalized];
  }

  return shapeOptionSet.has(normalized) ? (normalized as SogoShape) : "rounded";
}

function normalizeBorder(value?: string): SogoBorder {
  const normalized = normalizeToken(value);
  return borderOptionSet.has(normalized ?? "")
    ? (normalized as SogoBorder)
    : "subtle";
}

function normalizeTextAlign(value?: string): SogoTextAlign {
  const normalized = normalizeToken(value);
  return alignOptionSet.has(normalized ?? "")
    ? (normalized as SogoTextAlign)
    : "left";
}

function normalizeLineStyle(value?: string): EdgeLineStyle {
  const normalized = normalizeToken(value);
  return normalized === "dashed" ? "dashed" : "solid";
}

function normalizeNodeData(input: CanvasNodeData): CanvasNodeData {
  return {
    ...input,
    color: normalizeColor(input.color),
    sogo: {
      ...input.sogo,
      shape: normalizeShape(input.sogo?.shape),
      border: normalizeBorder(input.sogo?.border),
      textAlign: normalizeTextAlign(input.sogo?.textAlign)
    }
  };
}

function normalizeEdgeData(input: CanvasEdgeData): CanvasEdgeData {
  return {
    ...input,
    color: normalizeColor(input.color),
    lineStyle: normalizeLineStyle(input.lineStyle),
    arrow: input.arrow ?? true
  };
}

function createEmptyDocument(): CanvasDocumentData {
  return {
    nodes: [],
    edges: [],
    sogo: {
      background: "dots",
      snapToGrid: false
    }
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function createNode(
  type: CanvasNodeType,
  position = { x: 160, y: 120 },
  partial?: Partial<CanvasNodeData>
): CanvasNodeData {
  const id = crypto.randomUUID();
  const base: CanvasNodeData = {
    id,
    type,
    x: position.x,
    y: position.y,
    width:
      type === "group" ? 360 : type === "image" ? 240 : type === "file" ? 220 : 180,
    height: type === "group" ? 200 : type === "image" ? 200 : 72,
    color: "default",
    sogo: {
      shape: type === "group" ? "rect" : "rounded",
      border: "subtle",
      textAlign: "left"
    }
  };

  if (type === "text") {
    base.text = "";
  }

  if (type === "group") {
    base.label = "";
  }

  if (type === "file") {
    base.label = partial?.file ?? "File reference";
    base.file = partial?.file;
  }

  if (type === "image") {
    base.label = partial?.file ?? "Image reference";
    base.file = partial?.file;
  }

  return { ...base, ...partial };
}

function persistNodeData(input: unknown): CanvasNodeData {
  const node = input as CanvasNodeData;
  return normalizeNodeData({
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: node.text,
    label: node.label,
    color: node.color,
    file: node.file,
    url: node.url,
    sogo: {
      shape: node.sogo?.shape,
      border: node.sogo?.border,
      textAlign: node.sogo?.textAlign
    }
  });
}

function nodeToFlowNode(node: CanvasNodeData): Node {
  return {
    id: node.id,
    type: "canvasNode",
    position: {
      x: node.x,
      y: node.y
    },
    data: persistNodeData(node) as unknown as Record<string, unknown>,
    style: {
      width: node.width,
      height: node.height,
      zIndex: node.type === "group" ? 0 : 2
    },
    selectable: true,
    draggable: true
  };
}

function readDimension(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function edgeStroke(color?: string): string {
  switch (normalizeColor(color)) {
    case "pink":
      return "#f082a8";
    case "orange":
      return "#ffb07a";
    case "yellow":
      return "#f4d99b";
    case "green":
      return "#9fdf93";
    case "cyan":
      return "#7ecbdd";
    case "lavender":
      return "#b1b6f9";
    case "rainbow":
      return "#c491ff";
    default:
      return "var(--canvas-edge)";
  }
}

function edgePresentation(edge: CanvasEdgeData) {
  const normalizedEdge = normalizeEdgeData(edge);
  const stroke = edgeStroke(normalizedEdge.color);

  return {
    style: {
      stroke,
      strokeWidth: 2,
      strokeDasharray: normalizedEdge.lineStyle === "dashed" ? "7 5" : undefined
    },
    markerEnd:
      normalizedEdge.arrow === false
        ? undefined
        : {
            type: MarkerType.ArrowClosed,
            color: stroke
          }
  };
}

function edgeToFlowEdge(edge: CanvasEdgeData): Edge {
  const normalizedEdge = normalizeEdgeData(edge);
  const presentation = edgePresentation(normalizedEdge);
  return {
    id: normalizedEdge.id,
    source: normalizedEdge.fromNode,
    target: normalizedEdge.toNode,
    sourceHandle: normalizedEdge.fromSide,
    targetHandle: normalizedEdge.toSide,
    data: {
      color: normalizedEdge.color,
      lineStyle: normalizedEdge.lineStyle,
      arrow: normalizedEdge.arrow
    },
    type: "bezier",
    style: presentation.style,
    markerEnd: presentation.markerEnd
  };
}

function groupBounds(nodes: CanvasNodeData[]) {
  const paddingX = 28;
  const paddingY = 24;

  const left = Math.min(...nodes.map((node) => node.x)) - paddingX;
  const top = Math.min(...nodes.map((node) => node.y)) - paddingY;
  const right = Math.max(...nodes.map((node) => node.x + node.width)) + paddingX;
  const bottom = Math.max(...nodes.map((node) => node.y + node.height)) + paddingY;

  return {
    x: left,
    y: top,
    width: Math.max(220, right - left),
    height: Math.max(140, bottom - top)
  };
}

function isInsideGroup(node: CanvasNodeData, group: CanvasNodeData): boolean {
  return (
    node.x >= group.x &&
    node.y >= group.y &&
    node.x + node.width <= group.x + group.width &&
    node.y + node.height <= group.y + group.height
  );
}

function flowToDocument(
  nodes: Node[],
  edges: Edge[],
  previous: CanvasDocumentData
): CanvasDocumentData {
  const previousNodeMap = new Map(previous.nodes.map((node) => [node.id, node]));
  const previousEdgeMap = new Map(previous.edges.map((edge) => [edge.id, edge]));

  return {
    nodes: nodes.map((node) => {
      const nodeData = persistNodeData(node.data);
      const prev = previousNodeMap.get(node.id) ?? nodeData;
      return {
        ...prev,
        ...nodeData,
        x: node.position.x,
        y: node.position.y,
        width:
          readDimension(node.measured?.width) ??
          readDimension(node.width) ??
          readDimension(
            (node.style as { width?: unknown } | undefined)?.width
          ) ??
          prev.width,
        height:
          readDimension(node.measured?.height) ??
          readDimension(node.height) ??
          readDimension(
            (node.style as { height?: unknown } | undefined)?.height
          ) ??
          prev.height
      };
    }),
    edges: edges.map((edge) => {
      const prev = previousEdgeMap.get(edge.id);
      return {
        id: edge.id,
        fromNode: edge.source,
        toNode: edge.target,
        fromSide:
          (typeof edge.sourceHandle === "string"
            ? (edge.sourceHandle as CanvasSide)
            : undefined) ??
          prev?.fromSide ??
          "right",
        toSide:
          (typeof edge.targetHandle === "string"
            ? (edge.targetHandle as CanvasSide)
            : undefined) ??
          prev?.toSide ??
          "left",
        color:
          ((edge.data as { color?: string } | undefined)?.color ??
            prev?.color ??
            "default"),
        lineStyle:
          ((edge.data as { lineStyle?: EdgeLineStyle } | undefined)?.lineStyle ??
            prev?.lineStyle ??
            "solid"),
        arrow:
          (edge.data as { arrow?: boolean } | undefined)?.arrow ??
          prev?.arrow ??
          true
      };
    }),
    sogo: previous.sogo
  };
}

function serializeDocument(document: CanvasDocumentData): string {
  return JSON.stringify(document, null, 2);
}

function parseDocument(content: string): CanvasDocumentData {
  if (!content.trim()) {
    return createEmptyDocument();
  }

  const parsed = JSON.parse(content) as Partial<CanvasDocumentData>;

  return {
    nodes: Array.isArray(parsed.nodes)
      ? parsed.nodes.map((node) => normalizeNodeData(node as CanvasNodeData))
      : [],
    edges: Array.isArray(parsed.edges)
      ? parsed.edges.map((edge) => normalizeEdgeData(edge as CanvasEdgeData))
      : [],
    sogo: {
      background: parsed.sogo?.background ?? "dots",
      snapToGrid: parsed.sogo?.snapToGrid ?? false,
      viewport:
        isFiniteNumber(parsed.sogo?.viewport?.x) &&
        isFiniteNumber(parsed.sogo?.viewport?.y) &&
        isFiniteNumber(parsed.sogo?.viewport?.zoom)
          ? {
              x: parsed.sogo.viewport.x,
              y: parsed.sogo.viewport.y,
              zoom: parsed.sogo.viewport.zoom
            }
          : undefined
    }
  };
}

function requestFilePath(accept?: "image"): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!vscode) {
      const fallback = window.prompt(
        accept === "image" ? "Enter image path" : "Enter file path"
      );
      resolve(fallback ?? undefined);
      return;
    }

    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, { resolve });
    vscode.postMessage({
      type: "requestFilePath",
      requestId,
      accept
    });
  });
}

function requestAssetUri(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!vscode) {
      resolve(undefined);
      return;
    }

    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, { resolve });
    vscode.postMessage({
      type: "requestAssetUri",
      requestId,
      path
    });
  });
}

function displayTitle(node: CanvasNodeData): string {
  if (node.type === "text") {
    return node.text ?? "Untitled";
  }
  return node.label ?? "Untitled";
}

function displayGroupTitle(node: CanvasNodeData): string {
  const value = node.label?.trim();
  return value && value.length > 0 ? value : "Untitled group";
}

function fileBasename(path?: string): string {
  if (!path) {
    return "file";
  }
  return path.split("/").pop() ?? path;
}

function fileExtension(path?: string): string {
  const name = fileBasename(path);
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

function canInlineEdit(type: CanvasNodeType): boolean {
  return type === "text" || type === "group";
}

function ToolbarIcon({ name }: { name: string }) {
  switch (name) {
    case "text":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.5" y="6" width="15" height="12" rx="3" />
          <path d="M8 10h8" />
          <path d="M8 14h5.5" />
        </svg>
      );
    case "group":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="7" width="9" height="9" rx="2" />
          <rect x="10" y="10" width="9" height="9" rx="2" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4.5h6l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 19V6A1.5 1.5 0 0 1 8 4.5Z" />
          <path d="M14 4.5V9h4" />
        </svg>
      );
    case "image":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.5" y="6" width="15" height="12" rx="2" />
          <circle cx="10" cy="10" r="1.5" />
          <path d="M7 16l3.5-3.5L13 15l2.5-2.5L17.5 15" />
        </svg>
      );
    case "background":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7" cy="7" r="1.25" />
          <circle cx="12" cy="7" r="1.25" />
          <circle cx="17" cy="7" r="1.25" />
          <circle cx="7" cy="12" r="1.25" />
          <circle cx="12" cy="12" r="1.25" />
          <circle cx="17" cy="12" r="1.25" />
          <circle cx="7" cy="17" r="1.25" />
          <circle cx="12" cy="17" r="1.25" />
          <circle cx="17" cy="17" r="1.25" />
        </svg>
      );
    case "delete":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14" />
          <path d="M9 7V5.5h6V7" />
          <path d="M8 9.5v8" />
          <path d="M12 9.5v8" />
          <path d="M16 9.5v8" />
          <path d="M6.5 7l1 11.5a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l1-11.5" />
        </svg>
      );
    case "color":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5.5a6.5 6.5 0 1 0 0 13c1.2 0 1.9-.6 1.9-1.4 0-.7-.3-1.2-.3-1.8 0-1 1-1.3 1.8-1.3h.8A3.8 3.8 0 0 0 20 10.2 4.7 4.7 0 0 0 15.3 5.5Z" />
          <circle cx="8.5" cy="11" r="1" />
          <circle cx="11.5" cy="8.5" r="1" />
          <circle cx="15" cy="9.5" r="1" />
        </svg>
      );
    case "shape":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h10l-2 10H5l2-10Z" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 18l3.5-.5L18 9l-3-3-8.5 8.5L6 18Z" />
          <path d="M13.5 7.5l3 3" />
        </svg>
      );
    case "align":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 8h12" />
          <path d="M8 12h8" />
          <path d="M6 16h12" />
        </svg>
      );
    case "border":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="6" width="14" height="12" rx="2" />
          <path d="M5 10h14" />
        </svg>
      );
    case "line":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h3" />
          <path d="M10 12h4" />
          <path d="M16 12h3" />
        </svg>
      );
    case "arrow":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h11" />
          <path d="M13.5 8.5 19 12l-5.5 3.5" />
        </svg>
      );
    default:
      return null;
  }
}

function CanvasNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CanvasNodeViewData;
  const isSelected = Boolean(selected);
  const shape = normalizeShape(nodeData.sogo?.shape);
  const border = normalizeBorder(nodeData.sogo?.border);
  const align = normalizeTextAlign(nodeData.sogo?.textAlign);
  const color = normalizeColor(nodeData.color);
  const ext = fileExtension(nodeData.file).toUpperCase();

  return (
    <div className="canvas-node-shell">
      <NodeResizer
        isVisible={isSelected && !nodeData.isEditing}
        minWidth={nodeData.type === "group" ? 220 : 140}
        minHeight={nodeData.type === "image" ? 160 : 64}
        lineClassName="node-resizer-line"
        handleClassName="node-resizer-handle"
      />
      <Handle
        id="top"
        className="node-handle node-handle-top"
        type="source"
        position={Position.Top}
        isConnectable
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        id="right"
        className="node-handle node-handle-right"
        type="source"
        position={Position.Right}
        isConnectable
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        id="bottom"
        className="node-handle node-handle-bottom"
        type="source"
        position={Position.Bottom}
        isConnectable
        isConnectableStart
        isConnectableEnd
      />
      <Handle
        id="left"
        className="node-handle node-handle-left"
        type="source"
        position={Position.Left}
        isConnectable
        isConnectableStart
        isConnectableEnd
      />
      <div
        className={[
          "canvas-node",
          `node-kind-${nodeData.type}`,
          `shape-${shape}`,
          `border-${border}`,
          `align-${align}`,
          `tone-${color}`,
          isSelected ? "is-selected" : "",
          nodeData.isEditing ? "is-editing" : ""
        ].join(" ")}
        style={{
          textAlign: align
        }}
      >
        {nodeData.type === "group" ? (
          <div className="group-title-wrap">
            {nodeData.isEditing ? (
              <textarea
                autoFocus
                className="group-title-editor nodrag nopan"
                value={nodeData.draftText ?? ""}
                rows={1}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => nodeData.onDraftChange?.(event.target.value)}
                onBlur={() => nodeData.onCommitEdit?.()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    nodeData.onCancelEdit?.();
                  }
                  if (event.key === "Enter" && !(event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    nodeData.onCommitEdit?.();
                  }
                }}
              />
            ) : (
              <div
                className="group-title nodrag nopan"
                onMouseDown={(event) => {
                  if (isSelected) {
                    event.stopPropagation();
                  }
                }}
                onPointerDown={(event) => {
                  if (isSelected) {
                    event.stopPropagation();
                  }
                }}
                onClick={() => {
                  if (isSelected) {
                    nodeData.onStartEdit?.();
                  }
                }}
                onDoubleClick={() => nodeData.onStartEdit?.()}
              >
                {displayGroupTitle(nodeData)}
              </div>
            )}
          </div>
        ) : null}

        {nodeData.type === "image" && nodeData.assetUri ? (
          <div className="node-image-preview">
            <img src={nodeData.assetUri} alt={nodeData.label ?? "Image node"} />
          </div>
        ) : null}

        {nodeData.type === "file" ? (
          <div className="node-file-header">
            <div className="node-file-chip">{ext || "FILE"}</div>
            <div className="node-file-title">{fileBasename(nodeData.file)}</div>
          </div>
        ) : null}

        {nodeData.isEditing && nodeData.type !== "group" ? (
          <textarea
            autoFocus
            className="node-editor nodrag nopan"
            value={nodeData.draftText ?? ""}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => nodeData.onDraftChange?.(event.target.value)}
            onBlur={() => nodeData.onCommitEdit?.()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                nodeData.onCancelEdit?.();
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                nodeData.onCommitEdit?.();
              }
            }}
          />
        ) : nodeData.type !== "group" ? (
          <div
            className="node-content"
            onDoubleClick={() => {
              if (canInlineEdit(nodeData.type)) {
                nodeData.onStartEdit?.();
              }
            }}
          >
            {displayTitle(nodeData)}
          </div>
        ) : null}

        {nodeData.file ? <div className="node-meta">{nodeData.file}</div> : null}
      </div>
    </div>
  );
}

const nodeTypes = {
  canvasNode: CanvasNodeComponent
};

type FlowViewportApi = {
  fitView: (options?: unknown) => Promise<boolean>;
  setViewport: (viewport: Viewport, options?: unknown) => Promise<boolean> | void;
  getViewport: () => Viewport;
};

export default function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const reactFlowRef = useRef<FlowViewportApi | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [documentState, setDocumentState] = useState<CanvasDocumentData>(
    createEmptyDocument()
  );
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const isMarqueeSelectingRef = useRef(false);
  const marqueeNodeIdsRef = useRef<string[]>([]);
  const suppressNextPaneClickRef = useRef(false);
  const suppressSelectionChangeRef = useRef(false);
  const groupDragRef = useRef<{
    groupId: string;
    startX: number;
    startY: number;
    memberPositions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null);
  const [selectionPanel, setSelectionPanel] = useState<SelectionPanel>(null);
  const [edgePanel, setEdgePanel] = useState<EdgePanel>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [assetUris, setAssetUris] = useState<Record<string, string>>({});
  const pendingAssetPathsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const currentContentRef = useRef(serializeDocument(createEmptyDocument()));
  const outboundContentRef = useRef<string | null>(null);
  const pendingViewportInitRef = useRef<Viewport | "fit" | null>(
    null
  );
  const suppressViewportSaveRef = useRef(false);
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [edgeToolbarPosition, setEdgeToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const selectedNode = useMemo(() => {
    const selected = nodes.find((node) => node.id === selectedNodeId);
    return selected ? persistNodeData(selected.data) : null;
  }, [nodes, selectedNodeId]);

  const selectedEdge = useMemo(() => {
    const selected = edges.find((edge) => edge.id === selectedEdgeId);
    const data = selected?.data as
      | { color?: string; lineStyle?: EdgeLineStyle; arrow?: boolean }
      | undefined;

    if (!selected) {
      return null;
    }

    return {
      id: selected.id,
      color: data?.color ?? "default",
      lineStyle: data?.lineStyle ?? "solid",
      arrow: data?.arrow ?? true
    };
  }, [edges, selectedEdgeId]);

  const showSelectionTools = Boolean(selectedNode) && selectedNodeIds.length <= 1;
  const selectedNodeIdSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds]
  );

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        selected: edge.id === selectedEdgeId
      })),
    [edges, selectedEdgeId]
  );

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const base = persistNodeData(node.data);
        const viewData: CanvasNodeViewData = {
          ...base,
          assetUri: base.file ? assetUris[base.file] : undefined,
          draftText,
          isEditing: editingNodeId === node.id,
          onStartEdit: () => startEditingNode(node.id),
          onDraftChange: setDraftText,
          onCommitEdit: commitEdit,
          onCancelEdit: cancelEdit
        };

        return {
          ...node,
          selected:
            selectedNodeIdSet.has(node.id) ||
            node.id === selectedNodeId ||
            Boolean(node.selected),
          draggable: editingNodeId === null || editingNodeId !== node.id,
          data: viewData as unknown as Record<string, unknown>
        };
      }),
    [nodes, assetUris, editingNodeId, draftText, selectedNodeId, selectedNodeIdSet]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as {
        type: string;
        content?: string;
        requestId?: string;
        value?: string;
      };

      if (message.type === "loadDocument" && typeof message.content === "string") {
        if (
          message.content === currentContentRef.current ||
          message.content === outboundContentRef.current
        ) {
          outboundContentRef.current = null;
          return;
        }

        const next = parseDocument(message.content);
        loadedRef.current = true;
        outboundContentRef.current = null;
        pendingViewportInitRef.current =
          next.sogo?.viewport ?? (next.nodes.length > 0 ? "fit" : null);
        setDocumentState(next);
        setNodes(next.nodes.map(nodeToFlowNode));
        setEdges(next.edges.map(edgeToFlowEdge));
      }

      if (
        (message.type === "filePathResponse" ||
          message.type === "assetUriResponse") &&
        message.requestId &&
        pendingRequests.has(message.requestId)
      ) {
        const request = pendingRequests.get(message.requestId)!;
        pendingRequests.delete(message.requestId);
        request.resolve(message.value);
      }
    };

    window.addEventListener("message", onMessage);
    vscode?.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      return;
    }

    const nextDocument = flowToDocument(nodes, edges, documentState);
    const serialized = serializeDocument(nextDocument);

    currentContentRef.current = serialized;
    setDocumentState(nextDocument);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      outboundContentRef.current = serialized;
      vscode?.postMessage({
        type: "save",
        content: serialized
      });
    }, 180);
  }, [nodes, edges, documentState.sogo]);

  useEffect(() => {
    currentContentRef.current = serializeDocument(documentState);
  }, [documentState]);

  useEffect(() => {
    const pending = pendingViewportInitRef.current;
    const instance = reactFlowRef.current;

    if (!instance || pending === null || !loadedRef.current || !flowReady) {
      return;
    }

    pendingViewportInitRef.current = null;
    suppressViewportSaveRef.current = true;

    const applyViewport = async () => {
      if (pending === "fit") {
        await instance.fitView({
          padding: 0.18,
          duration: 0,
          minZoom: 0.45,
          maxZoom: 1.1
        });
      } else {
        instance.setViewport(pending, { duration: 0 });
      }

      requestAnimationFrame(() => {
        const viewport = instance.getViewport();
        updateCanvasMeta({
          ...documentState.sogo,
          viewport
        });
        suppressViewportSaveRef.current = false;
      });
    };

    void applyViewport();
  }, [nodes, edges, documentState.sogo, flowReady]);

  useEffect(() => {
    if (!selectedNodeId || !shellRef.current) {
      setToolbarPosition(null);
      return;
    }

    const updatePosition = () => {
      const shellRect = shellRef.current?.getBoundingClientRect();
      const selectedElement = document.querySelector(
        `.react-flow__node[data-id="${selectedNodeId}"]`
      ) as HTMLElement | null;

      if (!shellRect || !selectedElement) {
        setToolbarPosition(null);
        return;
      }

      const rect = selectedElement.getBoundingClientRect();
      setToolbarPosition({
        left: rect.left - shellRect.left + rect.width / 2,
        top: rect.top - shellRect.top - 18
      });
    };

    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
    };
  }, [selectedNodeId, nodes, editingNodeId]);

  useEffect(() => {
    if (!selectedEdgeId || !shellRef.current) {
      setEdgeToolbarPosition(null);
      return;
    }

    const updatePosition = () => {
      const shellRect = shellRef.current?.getBoundingClientRect();
      const selectedPath = document.querySelector(
        `.react-flow__edge[data-id="${selectedEdgeId}"] .react-flow__edge-path`
      ) as SVGPathElement | null;

      if (!shellRect || !selectedPath) {
        setEdgeToolbarPosition(null);
        return;
      }

      const rect = selectedPath.getBoundingClientRect();
      setEdgeToolbarPosition({
        left: rect.left - shellRect.left + rect.width / 2,
        top: rect.top - shellRect.top - 8
      });
    };

    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
    };
  }, [selectedEdgeId, edges]);

  useEffect(() => {
    if (selectedNodeId) {
      setSelectionPanel(null);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    const imagePaths = nodes
      .map((node) => persistNodeData(node.data))
      .filter((node) => node.type === "image" && node.file)
      .map((node) => node.file!) ;

    for (const path of imagePaths) {
      if (assetUris[path] || pendingAssetPathsRef.current.has(path)) {
        continue;
      }

      pendingAssetPathsRef.current.add(path);
      void requestAssetUri(path).then((value) => {
        pendingAssetPathsRef.current.delete(path);
        if (!value) {
          return;
        }
        setAssetUris((current) => ({
          ...current,
          [path]: value
        }));
      });
    }
  }, [nodes, assetUris]);

  function updateCanvasMeta(next: SogoCanvasMeta): void {
    setDocumentState((current) => ({
      ...current,
      sogo: next
    }));
  }

  function patchNode(
    nodeId: string,
    updater: (node: CanvasNodeData) => CanvasNodeData
  ): void {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: updater(persistNodeData(node.data)) as unknown as Record<
                string,
                unknown
              >
            }
          : node
      )
    );
  }

  function updateSelectedNode(
    updater: (node: CanvasNodeData) => CanvasNodeData
  ): void {
    if (!selectedNodeId) {
      return;
    }
    patchNode(selectedNodeId, updater);
  }

  function updateSelectedEdge(
    updater: (edge: CanvasEdgeData) => CanvasEdgeData
  ): void {
    if (!selectedEdgeId) {
      return;
    }

    setEdges((current) =>
      current.map((edge) => {
        if (edge.id !== selectedEdgeId) {
          return edge;
        }

        const base: CanvasEdgeData = {
          id: edge.id,
          fromNode: edge.source,
          toNode: edge.target,
          fromSide:
            typeof edge.sourceHandle === "string"
              ? (edge.sourceHandle as CanvasSide)
              : undefined,
          toSide:
            typeof edge.targetHandle === "string"
              ? (edge.targetHandle as CanvasSide)
              : undefined,
          color:
            (edge.data as { color?: string } | undefined)?.color ?? "default",
          lineStyle:
            (edge.data as { lineStyle?: EdgeLineStyle } | undefined)?.lineStyle ??
            "solid",
          arrow:
            (edge.data as { arrow?: boolean } | undefined)?.arrow ?? true
        };

        const next = updater(base);
        const presentation = edgePresentation(next);

        return {
          ...edge,
          style: presentation.style,
          markerEnd: presentation.markerEnd,
          data: {
            color: next.color ?? "default",
            lineStyle: next.lineStyle ?? "solid",
            arrow: next.arrow ?? true
          }
        };
      })
    );
  }

  function startEditingNode(nodeId: string): void {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    const persisted = persistNodeData(node.data);
    if (!canInlineEdit(persisted.type)) {
      return;
    }
    setEditingNodeId(nodeId);
    setDraftText(displayTitle(persisted));
  }

  function commitEdit(): void {
    if (!editingNodeId) {
      return;
    }

    const node = nodes.find((item) => item.id === editingNodeId);
    if (!node) {
      setEditingNodeId(null);
      return;
    }

    const persisted = persistNodeData(node.data);
    patchNode(editingNodeId, (current) =>
      current.type === "text"
        ? { ...current, text: draftText }
        : { ...current, label: draftText }
    );

    if (selectedNodeId !== persisted.id) {
      setSelectedNodeId(persisted.id);
    }

    setEditingNodeId(null);
    setDraftText("");
  }

  function cancelEdit(): void {
    setEditingNodeId(null);
    setDraftText("");
  }

  function addNodeOfType(type: CanvasNodeType, partial?: Partial<CanvasNodeData>) {
    const offset = nodes.length * 24;
    const node = createNode(type, { x: 180 + offset, y: 140 + offset }, partial);
    setNodes((current) => [...current, nodeToFlowNode(node)]);
    setSelectedNodeId(node.id);
    setSelectedNodeIds([node.id]);
    setBottomPanel(null);
    if (canInlineEdit(type)) {
      setEditingNodeId(node.id);
      setDraftText(displayTitle(node));
    }
  }

  function toggleSelectionPanel(panel: Exclude<SelectionPanel, null>): void {
    setSelectionPanel((current) => (current === panel ? null : panel));
  }

  function createGroupFromSelection(nodeIds: string[]): void {
    const selected = nodes
      .filter((node) => nodeIds.includes(node.id))
      .map((node) => persistNodeData(node.data))
      .filter((node) => node.type !== "group");

    if (selected.length < 2) {
      return;
    }

    const bounds = groupBounds(selected);
    const groupNode = createNode("group", { x: bounds.x, y: bounds.y }, bounds);

    suppressSelectionChangeRef.current = true;
    setNodes((current) => [
      {
        ...nodeToFlowNode(groupNode),
        selected: true
      },
      ...current.map((node) => ({
        ...node,
        selected: false
      }))
    ]);
    setSelectedNodeId(groupNode.id);
    setSelectedNodeIds([groupNode.id]);

    requestAnimationFrame(() => {
      suppressSelectionChangeRef.current = false;
    });
  }

  async function addFileNode(): Promise<void> {
    const file = await requestFilePath();
    if (!file) {
      return;
    }
    addNodeOfType("file", { file, label: file });
  }

  async function addImageNode(): Promise<void> {
    const file = await requestFilePath("image");
    if (!file) {
      return;
    }
    addNodeOfType("image", { file, label: file });
  }

  function handlePaneDoubleClick(): void {
    addNodeOfType("text");
  }

  function handleConnect(connection: Connection): void {
    if (!connection.source || !connection.target) {
      return;
    }

    const edgeData: CanvasEdgeData = {
      id: crypto.randomUUID(),
      fromNode: connection.source,
      toNode: connection.target,
      fromSide:
        typeof connection.sourceHandle === "string"
          ? (connection.sourceHandle as CanvasSide)
          : undefined,
      toSide:
        typeof connection.targetHandle === "string"
          ? (connection.targetHandle as CanvasSide)
          : undefined,
      color: "default",
      lineStyle: "solid",
      arrow: true
    };
    const presentation = edgePresentation(edgeData);

    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: edgeData.id,
          sourceHandle: edgeData.fromSide,
          targetHandle: edgeData.toSide,
          data: {
            color: edgeData.color,
            lineStyle: edgeData.lineStyle,
            arrow: edgeData.arrow
          },
          type: "bezier",
          style: presentation.style,
          markerEnd: presentation.markerEnd
        },
        current
      )
    );
  }

  function handleDeleteSelection(): void {
    if (selectedEdgeId) {
      setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      return;
    }

    if (!selectedNodeId || editingNodeId) {
      return;
    }

    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
  }

  function handleNodeDragStart(_: React.MouseEvent, node: Node): void {
    const persisted = persistNodeData(node.data);
    if (persisted.type !== "group") {
      groupDragRef.current = null;
      return;
    }

    const members = nodes
      .map((item) => persistNodeData(item.data))
      .filter(
        (item) => item.id !== persisted.id && item.type !== "group" && isInsideGroup(item, persisted)
      );

    groupDragRef.current = {
      groupId: persisted.id,
      startX: node.position.x,
      startY: node.position.y,
      memberPositions: new Map(
        members.map((item) => [item.id, { x: item.x, y: item.y }])
      )
    };
  }

  function handleNodeDrag(_: React.MouseEvent, node: Node): void {
    const dragState = groupDragRef.current;
    if (!dragState || dragState.groupId !== node.id) {
      return;
    }

    const deltaX = node.position.x - dragState.startX;
    const deltaY = node.position.y - dragState.startY;

    setNodes((current) =>
      current.map((item) => {
        if (item.id === node.id) {
          return {
            ...item,
            position: node.position
          };
        }

        const start = dragState.memberPositions.get(item.id);
        if (!start) {
          return item;
        }

        return {
          ...item,
          position: {
            x: start.x + deltaX,
            y: start.y + deltaY
          }
        };
      })
    );
  }

  function handleNodeDragStop(): void {
    groupDragRef.current = null;
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        handleDeleteSelection();
      }

      if (event.key === "Enter" && selectedNode && !editingNodeId) {
        if (canInlineEdit(selectedNode.type)) {
          event.preventDefault();
          startEditingNode(selectedNode.id);
        }
      }

      if (event.key === "Escape" && editingNodeId) {
        event.preventDefault();
        cancelEdit();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode, editingNodeId, nodes, selectedNodeId]);

  return (
    <div
      ref={shellRef}
      className={`app-shell background-${documentState.sogo?.background ?? "dots"}`}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onInit={(instance) => {
          reactFlowRef.current = instance as FlowViewportApi;
          setFlowReady(true);
        }}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={2.5}
        connectionMode={ConnectionMode.Loose}
        snapToGrid={documentState.sogo?.snapToGrid ?? false}
        snapGrid={[canvasGridSize, canvasGridSize]}
        selectionOnDrag
        selectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        selectNodesOnDrag={false}
        panOnDrag={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        nodesDraggable={editingNodeId === null}
        nodesConnectable
        elementsSelectable
        defaultEdgeOptions={{
          type: "bezier",
          style: {
            stroke: "var(--canvas-edge)",
            strokeWidth: 2
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--canvas-edge)"
          }
        }}
        connectionLineStyle={{
          stroke: "var(--canvas-accent)",
          strokeWidth: 2.5
        }}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".react-flow__node")) {
            return;
          }
          handlePaneDoubleClick();
        }}
        onPaneClick={() => {
          if (suppressNextPaneClickRef.current) {
            suppressNextPaneClickRef.current = false;
            return;
          }

          if (editingNodeId) {
            commitEdit();
          }
          setSelectedNodeId(null);
          setSelectedNodeIds([]);
          setSelectedEdgeId(null);
          setSelectionPanel(null);
          setEdgePanel(null);
          setBottomPanel(null);
        }}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          setSelectedNodeIds([node.id]);
          setSelectedEdgeId(null);
          setEdgePanel(null);
        }}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          setSelectedNodeId(null);
          setSelectedNodeIds([]);
          setSelectionPanel(null);
          setEdgePanel(null);
        }}
        onNodeDoubleClick={(_, node) => {
          const persisted = persistNodeData(node.data);
          if (canInlineEdit(persisted.type)) {
            startEditingNode(node.id);
          }
        }}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodesChange={(changes) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={handleConnect}
        onMoveEnd={(_, viewport) => {
          if (suppressViewportSaveRef.current) {
            return;
          }

          updateCanvasMeta({
            ...documentState.sogo,
            viewport
          });
        }}
        onSelectionStart={() => {
          isMarqueeSelectingRef.current = true;
          marqueeNodeIdsRef.current = [];
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setSelectionPanel(null);
          setEdgePanel(null);
        }}
        onSelectionChange={({ nodes: nextSelectedNodes }) => {
          if (suppressSelectionChangeRef.current) {
            return;
          }

          const ids = nextSelectedNodes.map((node) => node.id);
          if (isMarqueeSelectingRef.current) {
            marqueeNodeIdsRef.current = ids;
          }
          setSelectedNodeIds(ids);
          if (ids.length <= 1) {
            setSelectedNodeId(ids[0] ?? null);
          } else {
            setSelectedNodeId(null);
          }
        }}
        onSelectionEnd={() => {
          if (!isMarqueeSelectingRef.current) {
            return;
          }

          isMarqueeSelectingRef.current = false;
          const ids = marqueeNodeIdsRef.current;
          marqueeNodeIdsRef.current = [];

          if (ids.length > 1) {
            suppressNextPaneClickRef.current = true;
            createGroupFromSelection(ids);
          }
        }}
      >
      </ReactFlow>

      {showSelectionTools && toolbarPosition ? (
        <div
          className="contextual-toolbar-stack"
          style={{
            left: toolbarPosition.left,
            top: toolbarPosition.top
          }}
        >
          <div className="contextual-toolbar">
            <div className="toolbar-group">
              <button
                title="Delete"
                aria-label="Delete"
                className="toolbar-command"
                onClick={handleDeleteSelection}
              >
                <ToolbarIcon name="delete" />
              </button>
              <button
                title="Color"
                aria-label="Color"
                className={[
                  "toolbar-command",
                  selectionPanel === "color" ? "is-active" : ""
                ].join(" ")}
                onClick={() => toggleSelectionPanel("color")}
              >
                <ToolbarIcon name="color" />
              </button>
              <button
                title="Border"
                aria-label="Border"
                className={[
                  "toolbar-command",
                  selectionPanel === "border" ? "is-active" : ""
                ].join(" ")}
                onClick={() => toggleSelectionPanel("border")}
              >
                <ToolbarIcon name="line" />
              </button>
              <button
                title="Align"
                aria-label="Align"
                className={[
                  "toolbar-command",
                  selectionPanel === "align" ? "is-active" : ""
                ].join(" ")}
                onClick={() => toggleSelectionPanel("align")}
              >
                <ToolbarIcon name="align" />
              </button>
              <button
                title="Shape"
                aria-label="Shape"
                className={[
                  "toolbar-command",
                  selectionPanel === "shape" ? "is-active" : ""
                ].join(" ")}
                onClick={() => toggleSelectionPanel("shape")}
              >
                <ToolbarIcon name="shape" />
              </button>
              {selectedNode && canInlineEdit(selectedNode.type) ? (
                <button
                  title="Edit text"
                  aria-label="Edit text"
                  className="toolbar-command"
                  onClick={() => startEditingNode(selectedNode.id)}
                >
                  <ToolbarIcon name="edit" />
                </button>
              ) : null}
            </div>
          </div>

          {selectedNode && selectionPanel ? (
            <div className="contextual-tray">
              {selectionPanel === "color" ? (
                <div className="toolbar-group">
                  {colorOptions.map((color) => (
                    <button
                      key={color}
                      className={[
                        "swatch-button",
                        selectedNode.color === color ? "is-active" : ""
                      ].join(" ")}
                      onClick={() =>
                        updateSelectedNode((node) => ({ ...node, color }))
                      }
                      title={color}
                    >
                      <span className={`color-swatch color-swatch-${color}`} />
                    </button>
                  ))}
                </div>
              ) : null}

              {selectionPanel === "shape" ? (
                <div className="toolbar-group">
                  {shapeOptions.map((shape) => (
                    <button
                      key={shape}
                      className={[
                        "shape-button",
                        (selectedNode.sogo?.shape ?? "rounded") === shape
                          ? "is-active"
                          : ""
                      ].join(" ")}
                      onClick={() =>
                        updateSelectedNode((node) => ({
                          ...node,
                          width:
                            shape === "circle" || shape === "diamond"
                              ? Math.max(140, Math.min(node.width, node.height))
                              : node.width,
                          height:
                            shape === "circle" || shape === "diamond"
                              ? Math.max(140, Math.min(node.width, node.height))
                              : node.height,
                          sogo: {
                            ...node.sogo,
                            shape
                          }
                        }))
                      }
                      title={shape}
                    >
                      <span className={`shape-preview shape-preview-${shape}`} />
                    </button>
                  ))}
                </div>
              ) : null}

              {selectionPanel === "border" ? (
                <div className="toolbar-group">
                  {borderOptions.map((border) => (
                    <button
                      key={border}
                      className={[
                        "tray-button",
                        "tray-button-compact",
                        (selectedNode.sogo?.border ?? "subtle") === border
                          ? "is-active"
                          : ""
                      ].join(" ")}
                      onClick={() =>
                        updateSelectedNode((node) => ({
                          ...node,
                          sogo: {
                            ...node.sogo,
                            border
                          }
                        }))
                      }
                      title={border}
                    >
                      {border}
                    </button>
                  ))}
                </div>
              ) : null}

              {selectionPanel === "align" ? (
                <div className="toolbar-group">
                  {alignOptions.map((align) => (
                    <button
                      key={align}
                      className={[
                        "align-button",
                        (selectedNode.sogo?.textAlign ?? "left") === align
                          ? "is-active"
                          : ""
                      ].join(" ")}
                      onClick={() =>
                        updateSelectedNode((node) => ({
                          ...node,
                          sogo: {
                            ...node.sogo,
                            textAlign: align
                          }
                        }))
                      }
                      title={align}
                    >
                      <span className={`align-preview align-preview-${align}`}>
                        <span />
                        <span />
                        <span />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedEdge && edgeToolbarPosition ? (
        <div
          className="contextual-toolbar-stack edge-toolbar-stack"
          style={{
            left: edgeToolbarPosition.left,
            top: edgeToolbarPosition.top
          }}
        >
          <div className="contextual-toolbar edge-contextual-toolbar">
            <div className="toolbar-group">
              <button
                title="Delete connector"
                aria-label="Delete connector"
                className="toolbar-command"
                onClick={handleDeleteSelection}
              >
                <ToolbarIcon name="delete" />
              </button>
              <button
                title="Color"
                aria-label="Color"
                className={[
                  "toolbar-command",
                  edgePanel === "color" ? "is-active" : ""
                ].join(" ")}
                onClick={() =>
                  setEdgePanel((current) => (current === "color" ? null : "color"))
                }
              >
                <ToolbarIcon name="color" />
              </button>
              <button
                title="Toggle dashed line"
                aria-label="Toggle dashed line"
                className={[
                  "toolbar-command",
                  selectedEdge.lineStyle === "dashed" ? "is-active" : ""
                ].join(" ")}
                onClick={() =>
                  updateSelectedEdge((edge) => ({
                    ...edge,
                    lineStyle: edge.lineStyle === "dashed" ? "solid" : "dashed"
                  }))
                }
              >
                <ToolbarIcon name="border" />
              </button>
              <button
                title="Toggle arrowhead"
                aria-label="Toggle arrowhead"
                className={[
                  "toolbar-command",
                  selectedEdge.arrow ? "is-active" : ""
                ].join(" ")}
                onClick={() =>
                  updateSelectedEdge((edge) => ({
                    ...edge,
                    arrow: !edge.arrow
                  }))
                }
              >
                <ToolbarIcon name="arrow" />
              </button>
            </div>
          </div>

          {edgePanel === "color" ? (
            <div className="contextual-tray edge-contextual-tray">
              <div className="toolbar-group">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className={[
                      "swatch-button",
                      selectedEdge.color === color ? "is-active" : ""
                    ].join(" ")}
                    onClick={() =>
                      updateSelectedEdge((edge) => ({ ...edge, color }))
                    }
                    title={color}
                  >
                    <span className={`color-swatch color-swatch-${color}`} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="toolbar-stack">
        {bottomPanel === "background" ? (
          <div className="toolbar-tray">
            <div className="toolbar-group">
              {backgroundOptions.map((mode) => (
                <button
                  key={mode}
                  className={[
                    "tray-button",
                    "tray-button-compact",
                    documentState.sogo?.background === mode ? "is-active" : ""
                  ].join(" ")}
                  onClick={() =>
                    updateCanvasMeta({
                      ...documentState.sogo,
                      background: mode
                    })
                  }
                  title={`Canvas background: ${mode}`}
                >
                  <span className={`background-chip background-chip-${mode}`} />
                  <span>{mode}</span>
                </button>
              ))}
              <button
                className={[
                  "tray-button",
                  "tray-button-compact",
                  documentState.sogo?.snapToGrid ? "is-active" : ""
                ].join(" ")}
                onClick={() =>
                  updateCanvasMeta({
                    ...documentState.sogo,
                    snapToGrid: !(documentState.sogo?.snapToGrid ?? false)
                  })
                }
                title="Snap to grid"
                aria-label="Snap to grid"
              >
                <span className="snap-chip" aria-hidden="true" />
                <span>snap</span>
              </button>
            </div>
          </div>
        ) : null}

        <div className="bottom-toolbar">
          <div className="toolbar-group">
            <button
              title="Add card"
              aria-label="Add card"
              className="insert-button"
              onClick={() => addNodeOfType("text")}
            >
              <ToolbarIcon name="text" />
            </button>
            <button
              title="Add group"
              aria-label="Add group"
              className="insert-button"
              onClick={() => addNodeOfType("group")}
            >
              <ToolbarIcon name="group" />
            </button>
            <button
              title="Add file reference"
              aria-label="Add file reference"
              className="insert-button"
              onClick={addFileNode}
            >
              <ToolbarIcon name="file" />
            </button>
            <button
              title="Add image reference"
              aria-label="Add image reference"
              className="insert-button"
              onClick={addImageNode}
            >
              <ToolbarIcon name="image" />
            </button>
          </div>
          <div className="toolbar-divider" />
          <button
            title="Edit canvas background"
            aria-label="Edit canvas background"
            className={[
              "toolbar-command",
              bottomPanel === "background" ? "is-active" : ""
            ].join(" ")}
            onClick={() =>
              setBottomPanel((current) =>
                current === "background" ? null : "background"
              )
            }
          >
            <ToolbarIcon name="background" />
          </button>
        </div>
      </div>
    </div>
  );
}
