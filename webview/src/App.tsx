import {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
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

interface PendingFileRequest {
  resolve: (value?: string) => void;
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
    height: type === "group" ? 220 : type === "image" ? 220 : 120,
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

function nodeToFlowNode(node: CanvasNodeData): Node {
  return {
    id: node.id,
    type: "canvasNode",
    position: {
      x: node.x,
      y: node.y
    },
    data: node as unknown as Record<string, unknown>,
    width: node.width,
    height: node.height,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
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
    markerEnd: {
      type: MarkerType.ArrowClosed
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
      const nodeData = node.data as unknown as CanvasNodeData;
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

function requestPath(accept?: "image"): Promise<string | undefined> {
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

const pendingRequests = new Map<string, PendingFileRequest>();

function CanvasNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as CanvasNodeData;
  const shape = nodeData.sogo?.shape ?? "rounded";
  const border = nodeData.sogo?.border ?? "subtle";
  const align = nodeData.sogo?.textAlign ?? "left";
  const color = nodeData.color ?? "default";

  return (
    <div
      className={[
        "canvas-node",
        `shape-${shape}`,
        `border-${border}`,
        `tone-${color}`,
        selected ? "is-selected" : ""
      ].join(" ")}
      style={{
        textAlign: align
      }}
    >
      <Handle
        id="top"
        className="node-handle node-handle-top"
        type="source"
        position={Position.Top}
      />
      <Handle
        id="right"
        className="node-handle node-handle-right"
        type="source"
        position={Position.Right}
      />
      <Handle
        id="bottom"
        className="node-handle node-handle-bottom"
        type="source"
        position={Position.Bottom}
      />
      <Handle
        id="left"
        className="node-handle node-handle-left"
        type="target"
        position={Position.Left}
      />
      <div className="node-type-label">{nodeData.type}</div>
      <div className="node-content">
        {nodeData.type === "text" ? nodeData.text : nodeData.label}
      </div>
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
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  const selectedNode = useMemo(
    () => documentState.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [documentState.nodes, selectedNodeId]
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
        message.type === "filePathResponse" &&
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

  function syncDocument(next: CanvasDocumentData): void {
    setDocumentState(next);
    setNodes(next.nodes.map(nodeToFlowNode));
    setEdges(next.edges.map(edgeToFlowEdge));
  }

  function updateSelectedNode(
    updater: (node: CanvasNodeData) => CanvasNodeData
  ): void {
    if (!selectedNode) {
      return;
    }

    const next = {
      ...documentState,
      nodes: documentState.nodes.map((node) =>
        node.id === selectedNode.id ? updater(node) : node
      )
    };

    syncDocument(next);
  }

  function addNodeOfType(type: CanvasNodeType, partial?: Partial<CanvasNodeData>) {
    const offset = documentState.nodes.length * 24;
    const node = createNode(type, { x: 180 + offset, y: 140 + offset }, partial);
    const next = {
      ...documentState,
      nodes: [...documentState.nodes, node]
    };

    syncDocument(next);
    setSelectedNodeId(node.id);
  }

  async function addFileNode(): Promise<void> {
    const file = await requestPath();
    if (!file) {
      return;
    }
    addNodeOfType("file", { file, label: file });
  }

  async function addImageNode(): Promise<void> {
    const file = await requestPath("image");
    if (!file) {
      return;
    }
    addNodeOfType("image", { file, label: file });
  }

  function handleDoubleClick(
    _event: React.MouseEvent<Element, MouseEvent>
  ): void {
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
          markerEnd: {
            type: MarkerType.ArrowClosed
          }
        },
        current
      )
    );
  }

  function handleDeleteSelection(): void {
    if (!selectedNodeId) {
      return;
    }

    const next = {
      ...documentState,
      nodes: documentState.nodes.filter((node) => node.id !== selectedNodeId),
      edges: documentState.edges.filter(
        (edge) =>
          edge.fromNode !== selectedNodeId && edge.toNode !== selectedNodeId
      )
    };

    syncDocument(next);
    setSelectedNodeId(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        handleDeleteSelection();
      }

      if (event.key === "Enter" && selectedNode?.type === "text") {
        const next = window.prompt("Edit card text", selectedNode.text ?? "");
        if (typeof next === "string") {
          updateSelectedNode((node) => ({ ...node, text: next }));
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode, documentState]);

  return (
    <div
      className={`app-shell background-${documentState.sogo?.background ?? "dots"}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2.5}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={(changes) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={handleConnect}
        onDoubleClick={handleDoubleClick}
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
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--canvas-minimap-node)"
          maskColor="rgba(4, 7, 15, 0.56)"
        />
        <Controls position="top-left" showInteractive={false} />
      </ReactFlow>

      <div className="toolbar-stack">
        <div className="toolbar-tray">
          {activePanel === "insert" ? (
            <div className="toolbar-group">
              <button className="tray-button" onClick={() => addNodeOfType("text")}>
                <span className="tray-glyph">T</span>
                <span>Text</span>
              </button>
              <button className="tray-button" onClick={() => addNodeOfType("group")}>
                <span className="tray-glyph">G</span>
                <span>Group</span>
              </button>
              <button className="tray-button" onClick={addFileNode}>
                <span className="tray-glyph">F</span>
                <span>File</span>
              </button>
              <button className="tray-button" onClick={addImageNode}>
                <span className="tray-glyph">I</span>
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
              className={activePanel === "insert" ? "is-active" : ""}
              onClick={() => setActivePanel("insert")}
            >
              Add
            </button>
            <button
              className={activePanel === "background" ? "is-active" : ""}
              onClick={() => setActivePanel("background")}
            >
              Background
            </button>
          </div>

          {selectedNode ? (
            <>
              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <button
                  className={activePanel === "color" ? "is-active" : ""}
                  onClick={() => setActivePanel("color")}
                >
                  Color
                </button>
                <button
                  className={activePanel === "shape" ? "is-active" : ""}
                  onClick={() => setActivePanel("shape")}
                >
                  Shape
                </button>
                <button
                  className={activePanel === "align" ? "is-active" : ""}
                  onClick={() => setActivePanel("align")}
                >
                  Align
                </button>
                <button
                  className={activePanel === "border" ? "is-active" : ""}
                  onClick={() => setActivePanel("border")}
                >
                  Border
                </button>
              </div>

              <div className="toolbar-divider" />
              <div className="toolbar-group">
                <button onClick={handleDeleteSelection}>Delete</button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
