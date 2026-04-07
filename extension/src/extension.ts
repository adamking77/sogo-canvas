import * as vscode from "vscode";
import * as path from "path";

type SogoBackground = "plain" | "dots" | "grid";
type SogoShape = "rounded" | "rect" | "diamond" | "parallelogram" | "circle";
type SogoBorder = "none" | "subtle" | "strong";
type SogoTextAlign = "left" | "center" | "right";
type EdgeLineStyle = "solid" | "dashed";

type CanvasNodeType = "text" | "group" | "file" | "image";
type CanvasSide = "top" | "right" | "bottom" | "left";

interface SogoNodeMeta {
  shape?: SogoShape;
  border?: SogoBorder;
  textAlign?: SogoTextAlign;
}

interface SogoCanvasMeta {
  background?: SogoBackground;
  snapToGrid?: boolean;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
}

interface CanvasNodeData {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
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

interface WebviewMessage {
  type:
    | "ready"
    | "save"
    | "reopenAsText"
    | "requestFilePath"
    | "requestAssetUri"
    | "requestFilePreview";
  content?: string;
  requestId?: string;
  accept?: string;
  path?: string;
}

interface ExtensionResponseMessage {
  type:
    | "loadDocument"
    | "filePathResponse"
    | "assetUriResponse"
    | "filePreviewResponse";
  content?: string;
  error?: string;
  requestId?: string;
  value?: string;
}

const previewableTextExtensions = new Set([
  "md",
  "mdx",
  "txt",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "scss",
  "html",
  "xml",
  "py",
  "go",
  "rs",
  "java",
  "sh",
  "sql"
]);

function defaultCanvas(): CanvasDocumentData {
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

function parseCanvasDocument(raw: string): CanvasDocumentData {
  if (!raw.trim()) {
    return defaultCanvas();
  }

  const parsed = JSON.parse(raw) as Partial<CanvasDocumentData>;

  return {
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
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

class SogoCanvasEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "sogo.canvasEditor";

  constructor(private readonly extensionUri: vscode.Uri) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const documentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const documentDirectory = documentDirectoryUri(document.uri);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
        documentDirectory,
        ...(documentWorkspaceFolder ? [documentWorkspaceFolder.uri] : [])
      ]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const updateWebview = () => {
      const message: ExtensionResponseMessage = {
        type: "loadDocument",
        content: document.getText()
      };

      try {
        message.content = normalizeCanvasText(document.getText());
      } catch (error) {
        message.error = errorMessage(error);
      }

      void webviewPanel.webview.postMessage(message);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() === document.uri.toString()) {
          updateWebview();
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.type) {
          case "ready":
            updateWebview();
            break;
          case "save":
            if (typeof message.content === "string") {
              await saveDocument(document, message.content);
            }
            break;
          case "reopenAsText":
            await vscode.commands.executeCommand("workbench.action.reopenTextEditor");
            break;
          case "requestFilePath":
            await respondWithFilePath(webviewPanel.webview, document.uri, message);
            break;
          case "requestAssetUri":
            await respondWithAssetUri(webviewPanel.webview, document.uri, message);
            break;
          case "requestFilePreview":
            await respondWithFilePreview(webviewPanel.webview, document.uri, message);
            break;
        }
      }
    );
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "index.css")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sogo Canvas</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

async function respondWithFilePath(
  webview: vscode.Webview,
  documentUri: vscode.Uri,
  message: WebviewMessage
): Promise<void> {
  const pick = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: message.accept === "image"
      ? {
          Images: ["png", "jpg", "jpeg", "gif", "webp", "svg"]
        }
      : undefined
  });

  const value = pick?.[0]
    ? await resolveSelectedPath(documentUri, pick[0], message.accept)
    : undefined;

  if (pick?.[0] && !value) {
    const scope = vscode.workspace.getWorkspaceFolder(documentUri)
      ? "the current workspace"
      : "the canvas folder";
    void vscode.window.showErrorMessage(
      `Sogo Canvas can only reference files inside ${scope}.`
    );
  }

  const response: ExtensionResponseMessage = {
    type: "filePathResponse",
    requestId: message.requestId,
    value
  };

  await webview.postMessage(response);
}

async function resolveSelectedPath(
  documentUri: vscode.Uri,
  selectedUri: vscode.Uri,
  accept?: string
): Promise<string | undefined> {
  const relativePath = relativeCanvasPath(documentUri, selectedUri);
  if (relativePath) {
    return relativePath;
  }

  if (accept === "image") {
    return importExternalImage(documentUri, selectedUri);
  }

  return undefined;
}

async function respondWithAssetUri(
  webview: vscode.Webview,
  documentUri: vscode.Uri,
  message: WebviewMessage
): Promise<void> {
  if (!message.path) {
    await webview.postMessage({
      type: "assetUriResponse",
      requestId: message.requestId
    } satisfies ExtensionResponseMessage);
    return;
  }

  const fileUri = resolveCanvasRelativeUri(documentUri, message.path);

  const value = fileUri ? webview.asWebviewUri(fileUri).toString() : undefined;

  await webview.postMessage({
    type: "assetUriResponse",
    requestId: message.requestId,
    value
  } satisfies ExtensionResponseMessage);
}

async function respondWithFilePreview(
  webview: vscode.Webview,
  documentUri: vscode.Uri,
  message: WebviewMessage
): Promise<void> {
  const fileUri = message.path
    ? resolveCanvasRelativeUri(documentUri, message.path)
    : undefined;
  const content = fileUri ? await readFilePreview(fileUri) : undefined;

  await webview.postMessage({
    type: "filePreviewResponse",
    requestId: message.requestId,
    value: content
  } satisfies ExtensionResponseMessage);
}

function resolveRelativeUri(
  baseUri: vscode.Uri,
  requestedPath: string
): vscode.Uri | undefined {
  if (!requestedPath.trim()) {
    return undefined;
  }

  const normalized = path.posix.normalize(requestedPath.replaceAll("\\", "/"));

  if (
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.startsWith("../") ||
    normalized === ".."
  ) {
    return undefined;
  }

  return vscode.Uri.joinPath(baseUri, normalized);
}

function documentDirectoryUri(documentUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(documentUri, "..");
}

function relativeCanvasPath(
  documentUri: vscode.Uri,
  selectedUri: vscode.Uri
): string | undefined {
  if (
    documentUri.scheme !== selectedUri.scheme ||
    documentUri.authority !== selectedUri.authority
  ) {
    return undefined;
  }

  const documentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  const selectedWorkspaceFolder = vscode.workspace.getWorkspaceFolder(selectedUri);

  if (
    documentWorkspaceFolder &&
    selectedWorkspaceFolder?.uri.toString() !== documentWorkspaceFolder.uri.toString()
  ) {
    return undefined;
  }

  const baseUri = documentWorkspaceFolder?.uri ?? documentDirectoryUri(documentUri);
  const relativePath = path.posix.relative(baseUri.path, selectedUri.path);
  const normalized = path.posix.normalize(relativePath);

  if (
    !normalized ||
    normalized === "." ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith("../") ||
    normalized === ".."
  ) {
    return undefined;
  }

  return normalized;
}

async function importExternalImage(
  documentUri: vscode.Uri,
  selectedUri: vscode.Uri
): Promise<string | undefined> {
  const canvasDirectory = documentDirectoryUri(documentUri);
  const canvasName = uriBasename(documentUri, path.posix.extname(documentUri.path));
  const assetDirectory = vscode.Uri.joinPath(
    canvasDirectory,
    `${canvasName}.assets`
  );

  await vscode.workspace.fs.createDirectory(assetDirectory);

  const importedName = await nextAvailableImportName(
    assetDirectory,
    uriBasename(selectedUri)
  );
  const targetUri = vscode.Uri.joinPath(assetDirectory, importedName);

  await vscode.workspace.fs.copy(selectedUri, targetUri, {
    overwrite: false
  });

  return relativeCanvasPath(documentUri, targetUri);
}

async function nextAvailableImportName(
  directoryUri: vscode.Uri,
  filename: string
): Promise<string> {
  const parsed = path.parse(filename);
  let attempt = 0;

  while (attempt < 500) {
    const candidate =
      attempt === 0
        ? `${parsed.name}${parsed.ext}`
        : `${parsed.name}-${attempt + 1}${parsed.ext}`;
    const candidateUri = vscode.Uri.joinPath(directoryUri, candidate);

    try {
      await vscode.workspace.fs.stat(candidateUri);
      attempt += 1;
    } catch {
      return candidate;
    }
  }

  return `${parsed.name}-${Date.now()}${parsed.ext}`;
}

function resolveCanvasRelativeUri(
  documentUri: vscode.Uri,
  requestedPath: string
): vscode.Uri | undefined {
  const documentWorkspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  const baseUri = documentWorkspaceFolder?.uri ?? documentDirectoryUri(documentUri);
  return resolveRelativeUri(baseUri, requestedPath);
}

async function readFilePreview(fileUri: vscode.Uri): Promise<string | undefined> {
  if (!isPreviewableTextFile(fileUri)) {
    return undefined;
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const previewBytes = bytes.slice(0, 8192);

    if (previewBytes.includes(0)) {
      return undefined;
    }

    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(previewBytes);
    const normalized = decoded
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .replaceAll("\t", "  ")
      .trim();

    if (!normalized) {
      return undefined;
    }

    const excerpt = normalized
      .split("\n")
      .slice(0, 8)
      .join("\n")
      .slice(0, 420)
      .trim();

    if (!excerpt) {
      return undefined;
    }

    return excerpt.length < normalized.length ? `${excerpt}…` : excerpt;
  } catch {
    return undefined;
  }
}

function isPreviewableTextFile(fileUri: vscode.Uri): boolean {
  const extension = path.posix.extname(fileUri.path).toLowerCase().replace(".", "");
  return previewableTextExtensions.has(extension);
}

async function saveDocument(
  document: vscode.TextDocument,
  content: string
): Promise<void> {
  const normalized = normalizeCanvasText(content);
  const current = document.getText();

  if (current === normalized) {
    return;
  }

  const edit = new vscode.WorkspaceEdit();

  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    normalized
  );

  await vscode.workspace.applyEdit(edit);
  await document.save();
}

function normalizeCanvasText(raw: string): string {
  const parsed = parseCanvasDocument(raw);
  return JSON.stringify(parsed, null, 2);
}

function getNonce(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let i = 0; i < 16; i += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return value;
}

function uriBasename(uri: vscode.Uri, suffixToTrim?: string): string {
  const basename = path.posix.basename(uri.path);
  if (suffixToTrim && basename.endsWith(suffixToTrim)) {
    return basename.slice(0, -suffixToTrim.length);
  }
  return basename;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function createNewCanvas(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    void vscode.window.showErrorMessage(
      "Open a workspace folder before creating a canvas."
    );
    return;
  }

  const filename = await vscode.window.showInputBox({
    prompt: "Enter a new canvas file name",
    value: "untitled.canvas",
    validateInput(value) {
      return value.endsWith(".canvas")
        ? null
        : "Canvas files must use the .canvas extension.";
    }
  });

  if (!filename) {
    return;
  }

  const uri = vscode.Uri.joinPath(workspaceFolder.uri, filename);
  const initialContent = JSON.stringify(defaultCanvas(), null, 2);

  await vscode.workspace.fs.writeFile(uri, Buffer.from(initialContent, "utf8"));
  await vscode.commands.executeCommand(
    "vscode.openWith",
    uri,
    SogoCanvasEditorProvider.viewType
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SogoCanvasEditorProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SogoCanvasEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: true
      }
    ),
    vscode.commands.registerCommand("sogo-canvas.newCanvas", createNewCanvas)
  );
}

export function deactivate(): void {}
