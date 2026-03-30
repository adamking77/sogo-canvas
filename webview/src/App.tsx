import {
  addEdge,
  Connection,
  ConnectionMode,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

type SogoBackground = "plain" | "dots" | "grid";
type SogoShape = "rounded" | "pill" | "rect" | "diamond" | "circle";
type SogoBorder = "none" | "subtle" | "strong";
type SogoTextAlign = "left" | "center" | "right";
type CanvasNodeType = "text" | "group" | "file" | "image";
type CanvasSide = "top" | "right" | "bottom" | "left";
type BottomPanel = "background" | null;
type SelectionPanel = "color" | "shape" | "border" | "align" | null;

interface SogoNodeMeta {
  shape?: SogoShape;
  border?: SogoBorder;
  textAlign?: SogoTextAlign;
}

interface SogoCanvasMeta {
  background?: SogoBackground;
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
  isSelected?: boolean;
  onSelect?: () => void;
  onResizeStart?: (event: React.MouseEvent<HTMLButtonElement>) => void;
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

const shapeOptions: SogoShape[] = [
  "rect",
  "rounded",
  "pill",
  "diamond",
  "circle"
];
const borderOptions: SogoBorder[] = ["none", "subtle", "strong"];
const alignOptions: SogoTextAlign[] = ["left", "center", "right"];
const backgroundOptions: SogoBackground[] = ["plain", "dots", "grid"];

const pendingRequests = new Map<string, PendingRequest>();

function createEmptyDocument(): CanvasDocumentData {
  return {
    nodes: [],
    edges: [],
    sogo: {
      background: "dots"
    }
  };
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
  return {
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
  };
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
      height: node.height
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

function edgeToFlowEdge(edge: CanvasEdgeData): Edge {
  return {
    id: edge.id,
    source: edge.fromNode,
    target: edge.toNode,
    type: "bezier",
    style: {
      stroke: "var(--canvas-edge)",
      strokeWidth: 2
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "var(--canvas-edge)"
    }
  };
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
        fromSide: prev?.fromSide ?? "right",
        toSide: prev?.toSide ?? "left",
        color: prev?.color ?? "default"
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
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    sogo: {
      background: parsed.sogo?.background ?? "dots"
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
          <path d="M6 7h12" />
          <path d="M9.5 7v10" />
          <path d="M14.5 7v10" />
          <path d="M7 17h10" />
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
          <rect x="5" y="7" width="14" height="10" rx="3" />
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
    default:
      return null;
  }
}

function CanvasNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CanvasNodeViewData;
  const isSelected = Boolean(nodeData.isSelected || selected);
  const shape = nodeData.sogo?.shape ?? "rounded";
  const border = nodeData.sogo?.border ?? "subtle";
  const align = nodeData.sogo?.textAlign ?? "left";
  const color = nodeData.color ?? "default";
  const ext = fileExtension(nodeData.file).toUpperCase();

  return (
    <div
      className={[
        "canvas-node",
        `node-kind-${nodeData.type}`,
        `shape-${shape}`,
        `border-${border}`,
        `tone-${color}`,
        isSelected ? "is-selected" : "",
        nodeData.isEditing ? "is-editing" : ""
      ].join(" ")}
      style={{
        textAlign: align
      }}
      onClick={(event) => {
        event.stopPropagation();
        nodeData.onSelect?.();
      }}
    >
      <Handle
        id="connect-top"
        className="node-handle node-handle-top"
        type="source"
        position={Position.Top}
        isConnectableStart
        isConnectableEnd
        isConnectable
      />
      <Handle
        id="connect-right"
        className="node-handle node-handle-right"
        type="source"
        position={Position.Right}
        isConnectableStart
        isConnectableEnd
        isConnectable
      />
      <Handle
        id="connect-bottom"
        className="node-handle node-handle-bottom"
        type="source"
        position={Position.Bottom}
        isConnectableStart
        isConnectableEnd
        isConnectable
      />
      <Handle
        id="connect-left"
        className="node-handle node-handle-left"
        type="source"
        position={Position.Left}
        isConnectableStart
        isConnectableEnd
        isConnectable
      />

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

      {nodeData.isEditing ? (
        <textarea
          autoFocus
          className="node-editor"
          value={nodeData.draftText ?? ""}
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
      ) : (
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
      )}

      {nodeData.file ? <div className="node-meta">{nodeData.file}</div> : null}

      {isSelected && !nodeData.isEditing ? (
        <button
          type="button"
          className="node-resize-grip nodrag nopan"
          aria-label="Resize node"
          onMouseDown={nodeData.onResizeStart}
          onClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </div>
  );
}

const nodeTypes = {
  canvasNode: CanvasNodeComponent
};

export default function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const resizeSessionRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    minWidth: number;
    minHeight: number;
  } | null>(null);
  const [documentState, setDocumentState] = useState<CanvasDocumentData>(
    createEmptyDocument()
  );
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null);
  const [selectionPanel, setSelectionPanel] = useState<SelectionPanel>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [assetUris, setAssetUris] = useState<Record<string, string>>({});
  const pendingAssetPathsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const selectedNode = useMemo(() => {
    const selected = nodes.find((node) => node.id === selectedNodeId);
    return selected ? persistNodeData(selected.data) : null;
  }, [nodes, selectedNodeId]);

  const showSelectionTools = Boolean(selectedNode);

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => {
        const base = persistNodeData(node.data);
        const viewData: CanvasNodeViewData = {
          ...base,
          assetUri: base.file ? assetUris[base.file] : undefined,
          draftText,
          isEditing: editingNodeId === node.id,
          isSelected: selectedNodeId === node.id,
          onSelect: () => setSelectedNodeId(node.id),
          onResizeStart: (event) => beginResize(node.id, event),
          onStartEdit: () => startEditingNode(node.id),
          onDraftChange: setDraftText,
          onCommitEdit: commitEdit,
          onCancelEdit: cancelEdit
        };

        return {
          ...node,
          draggable: editingNodeId === null || editingNodeId !== node.id,
          data: viewData as unknown as Record<string, unknown>
        };
      }),
    [nodes, assetUris, editingNodeId, draftText]
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
        const next = parseDocument(message.content);
        loadedRef.current = true;
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
    setDocumentState(nextDocument);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      vscode?.postMessage({
        type: "save",
        content: serializeDocument(nextDocument)
      });
    }, 180);
  }, [nodes, edges]);

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

  function syncDocument(next: CanvasDocumentData): void {
    setDocumentState(next);
    setNodes(next.nodes.map(nodeToFlowNode));
    setEdges(next.edges.map(edgeToFlowEdge));
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
    setBottomPanel(null);
    if (canInlineEdit(type)) {
      setEditingNodeId(node.id);
      setDraftText(displayTitle(node));
    }
  }

  function toggleSelectionPanel(panel: Exclude<SelectionPanel, null>): void {
    setSelectionPanel((current) => (current === panel ? null : panel));
  }

  function beginResize(
    nodeId: string,
    event: React.MouseEvent<HTMLButtonElement>
  ): void {
    event.preventDefault();
    event.stopPropagation();

    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    const persisted = persistNodeData(node.data);
    resizeSessionRef.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: persisted.width,
      startHeight: persisted.height,
      minWidth: persisted.type === "group" ? 240 : 180,
      minHeight: persisted.type === "image" ? 180 : 88
    };
  }

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const session = resizeSessionRef.current;
      if (!session) {
        return;
      }

      patchNode(session.nodeId, (node) => ({
        ...node,
        width: Math.max(
          session.minWidth,
          session.startWidth + (event.clientX - session.startX)
        ),
        height: Math.max(
          session.minHeight,
          session.startHeight + (event.clientY - session.startY)
        )
      }));
    };

    const onMouseUp = () => {
      resizeSessionRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [nodes]);

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

    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: crypto.randomUUID(),
          type: "bezier",
          style: {
            stroke: "var(--canvas-edge)",
            strokeWidth: 2
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--canvas-edge)"
          }
        },
        current
      )
    );
  }

  function handleDeleteSelection(): void {
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
        edges={edges}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={2.5}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={editingNodeId === null}
        nodesConnectable
        elementsSelectable={false}
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
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".react-flow__node")) {
            return;
          }
          handlePaneDoubleClick();
        }}
        onPaneClick={() => {
          if (editingNodeId) {
            commitEdit();
          }
          setSelectedNodeId(null);
          setSelectionPanel(null);
        }}
        onNodeDoubleClick={(_, node) => {
          const persisted = persistNodeData(node.data);
          if (canInlineEdit(persisted.type)) {
            startEditingNode(node.id);
          }
        }}
        onNodeDragStart={(_, node) => {
          setSelectedNodeId(node.id);
        }}
        onNodesChange={(changes) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={handleConnect}
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
                <ToolbarIcon name="border" />
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
                    syncDocument({
                      ...documentState,
                      sogo: {
                        ...documentState.sogo,
                        background: mode
                      }
                    })
                  }
                >
                  <span className={`background-chip background-chip-${mode}`} />
                  <span>{mode}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="bottom-toolbar">
          <div className="toolbar-group">
            <button
              title="Text"
              aria-label="Text"
              className="insert-button"
              onClick={() => addNodeOfType("text")}
            >
              <ToolbarIcon name="text" />
              <span>Text</span>
            </button>
            <button
              title="Group"
              aria-label="Group"
              className="insert-button"
              onClick={() => addNodeOfType("group")}
            >
              <ToolbarIcon name="group" />
              <span>Group</span>
            </button>
            <button
              title="File"
              aria-label="File"
              className="insert-button"
              onClick={addFileNode}
            >
              <ToolbarIcon name="file" />
              <span>File</span>
            </button>
            <button
              title="Image"
              aria-label="Image"
              className="insert-button"
              onClick={addImageNode}
            >
              <ToolbarIcon name="image" />
              <span>Image</span>
            </button>
          </div>
          <div className="toolbar-divider" />
          <button
            title="Canvas background"
            aria-label="Canvas background"
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
