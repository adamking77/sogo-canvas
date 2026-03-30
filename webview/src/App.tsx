import {
  addEdge,
  Background,
  BackgroundVariant,
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
type ToolbarPanel =
  | "insert"
  | "background"
  | "color"
  | "shape"
  | "border"
  | "align";

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
    width: type === "group" ? 420 : 320,
    height: type === "group" ? 220 : type === "image" ? 240 : 120,
    color: "default",
    sogo: {
      shape: type === "group" ? "rect" : "rounded",
      border: "subtle",
      textAlign: "left"
    }
  };

  if (type === "text") {
    base.text = "New card";
  }

  if (type === "group") {
    base.label = "New group";
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
    width: node.width,
    height: node.height,
    selectable: true,
    draggable: true
  };
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
        width: node.width ?? prev.width,
        height: node.height ?? prev.height
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

function backgroundVariant(mode: SogoBackground): BackgroundVariant | undefined {
  switch (mode) {
    case "dots":
      return BackgroundVariant.Dots;
    case "grid":
      return BackgroundVariant.Lines;
    default:
      return undefined;
  }
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

function CanvasNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CanvasNodeViewData;
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
        selected ? "is-selected" : "",
        nodeData.isEditing ? "is-editing" : ""
      ].join(" ")}
      style={{
        textAlign: align
      }}
    >
      <NodeResizer
        isVisible={selected && !nodeData.isEditing}
        minWidth={nodeData.type === "group" ? 240 : 180}
        minHeight={nodeData.type === "image" ? 180 : 88}
        lineClassName="node-resizer-line"
        handleClassName="node-resizer-handle"
      />
      <Handle
        id="target-left"
        className="node-handle node-handle-left"
        type="target"
        position={Position.Left}
      />
      <Handle
        id="source-right"
        className="node-handle node-handle-right"
        type="source"
        position={Position.Right}
      />
      <div className="node-type-label">{nodeData.type}</div>

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
    </div>
  );
}

const nodeTypes = {
  canvasNode: CanvasNodeComponent
};

export default function App() {
  const [documentState, setDocumentState] = useState<CanvasDocumentData>(
    createEmptyDocument()
  );
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<ToolbarPanel>("insert");
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [assetUris, setAssetUris] = useState<Record<string, string>>({});
  const pendingAssetPathsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

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
    if (selectedNode) {
      if (activePanel === "insert" || activePanel === "background") {
        setActivePanel("color");
      }
      return;
    }

    if (activePanel !== "insert" && activePanel !== "background") {
      setActivePanel("insert");
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
      className={`app-shell background-${documentState.sogo?.background ?? "dots"}`}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2.5}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={editingNodeId === null}
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
        }}
        onNodeDoubleClick={(_, node) => {
          const persisted = persistNodeData(node.data);
          if (canInlineEdit(persisted.type)) {
            startEditingNode(node.id);
          }
        }}
        onNodesChange={(changes) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={handleConnect}
        onSelectionChange={(selection) => {
          setSelectedNodeId(selection.nodes[0]?.id ?? null);
        }}
      >
        {documentState.sogo?.background !== "plain" ? (
          <Background
            variant={backgroundVariant(documentState.sogo?.background ?? "dots")}
            gap={documentState.sogo?.background === "dots" ? 34 : 32}
            size={documentState.sogo?.background === "dots" ? 1.5 : 1}
            color="var(--canvas-grid-color)"
          />
        ) : null}
      </ReactFlow>

      <div className="toolbar-stack">
        <div className="toolbar-tray">
          {activePanel === "insert" ? (
            <div className="toolbar-group">
              <button className="tray-button" onClick={() => addNodeOfType("text")}>
                <span className="tray-glyph tray-glyph-text" />
                <span>Text</span>
              </button>
              <button className="tray-button" onClick={() => addNodeOfType("group")}>
                <span className="tray-glyph tray-glyph-group" />
                <span>Group</span>
              </button>
              <button className="tray-button" onClick={addFileNode}>
                <span className="tray-glyph tray-glyph-file" />
                <span>File</span>
              </button>
              <button className="tray-button" onClick={addImageNode}>
                <span className="tray-glyph tray-glyph-image" />
                <span>Image</span>
              </button>
            </div>
          ) : null}

          {activePanel === "background" ? (
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
          ) : null}

          {activePanel === "color" && selectedNode ? (
            <div className="toolbar-group">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  className={[
                    "swatch-button",
                    selectedNode.color === color ? "is-active" : ""
                  ].join(" ")}
                  onClick={() => updateSelectedNode((node) => ({ ...node, color }))}
                  title={color}
                >
                  <span className={`color-swatch color-swatch-${color}`} />
                </button>
              ))}
            </div>
          ) : null}

          {activePanel === "shape" && selectedNode ? (
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

          {activePanel === "border" && selectedNode ? (
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

          {activePanel === "align" && selectedNode ? (
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

        <div className="bottom-toolbar">
          <div className="toolbar-group">
            <button
              title="Add nodes"
              aria-label="Add nodes"
              className={[
                "toolbar-command",
                "toolbar-command-add",
                activePanel === "insert" ? "is-active" : ""
              ].join(" ")}
              onClick={() => setActivePanel("insert")}
            >
              <span className="toolbar-command-icon" />
            </button>
            <button
              title="Canvas background"
              aria-label="Canvas background"
              className={[
                "toolbar-command",
                "toolbar-command-background",
                activePanel === "background" ? "is-active" : ""
              ].join(" ")}
              onClick={() => setActivePanel("background")}
            >
              <span className="toolbar-command-icon" />
            </button>
          </div>

          {showSelectionTools ? (
            <>
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <button
                  title="Color"
                  aria-label="Color"
                  className={[
                    "toolbar-command",
                    "toolbar-command-color",
                    activePanel === "color" ? "is-active" : ""
                  ].join(" ")}
                  onClick={() => setActivePanel("color")}
                >
                  <span className="toolbar-command-icon" />
                </button>
                <button
                  title="Shape"
                  aria-label="Shape"
                  className={[
                    "toolbar-command",
                    "toolbar-command-shape",
                    activePanel === "shape" ? "is-active" : ""
                  ].join(" ")}
                  onClick={() => setActivePanel("shape")}
                >
                  <span className="toolbar-command-icon" />
                </button>
                <button
                  title="Align"
                  aria-label="Align"
                  className={[
                    "toolbar-command",
                    "toolbar-command-align",
                    activePanel === "align" ? "is-active" : ""
                  ].join(" ")}
                  onClick={() => setActivePanel("align")}
                >
                  <span className="toolbar-command-icon" />
                </button>
                <button
                  title="Border"
                  aria-label="Border"
                  className={[
                    "toolbar-command",
                    "toolbar-command-border",
                    activePanel === "border" ? "is-active" : ""
                  ].join(" ")}
                  onClick={() => setActivePanel("border")}
                >
                  <span className="toolbar-command-icon" />
                </button>
              </div>

              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <button
                  title="Delete"
                  aria-label="Delete"
                  className="toolbar-command toolbar-command-delete"
                  onClick={handleDeleteSelection}
                >
                  <span className="toolbar-command-icon" />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
