import * as vscode from "vscode";

type SogoBackground = "plain" | "dots" | "grid";
type SogoShape = "rounded" | "pill" | "rect" | "diamond" | "circle";
type SogoBorder = "none" | "subtle" | "strong";
type SogoTextAlign = "left" | "center" | "right";

type CanvasNodeType = "text" | "group" | "file" | "image";
type CanvasSide = "top" | "right" | "bottom" | "left";

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

interface WebviewMessage {
  type: "ready" | "save" | "requestFilePath" | "requestAssetUri";
  content?: string;
  requestId?: string;
  accept?: string;
  path?: string;
}

interface ExtensionResponseMessage {
  type: "loadDocument" | "filePathResponse" | "assetUriResponse";
  content?: string;
  requestId?: string;
  value?: string;
}

function defaultCanvas(): CanvasDocumentData {
  return {
    nodes: [],
    edges: [],
    sogo: {
      background: "dots"
    }
  };
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
      background: parsed.sogo?.background ?? "dots"
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
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
        ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [])
      ]
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const updateWebview = () => {
      const content = normalizeCanvasText(document.getText());
      const message: ExtensionResponseMessage = {
        type: "loadDocument",
        content
      };
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
          case "requestFilePath":
            await respondWithFilePath(webviewPanel.webview, message);
            break;
          case "requestAssetUri":
            await respondWithAssetUri(webviewPanel.webview, message);
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
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
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
    ? vscode.workspace.asRelativePath(pick[0], false)
    : undefined;

  const response: ExtensionResponseMessage = {
    type: "filePathResponse",
    requestId: message.requestId,
    value
  };

  await webview.postMessage(response);
}

async function respondWithAssetUri(
  webview: vscode.Webview,
  message: WebviewMessage
): Promise<void> {
  if (!message.path) {
    await webview.postMessage({
      type: "assetUriResponse",
      requestId: message.requestId
    } satisfies ExtensionResponseMessage);
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const fileUri = workspaceFolder
    ? vscode.Uri.joinPath(workspaceFolder.uri, message.path)
    : undefined;

  const value = fileUri ? webview.asWebviewUri(fileUri).toString() : undefined;

  await webview.postMessage({
    type: "assetUriResponse",
    requestId: message.requestId,
    value
  } satisfies ExtensionResponseMessage);
}

async function saveDocument(
  document: vscode.TextDocument,
  content: string
): Promise<void> {
  const normalized = normalizeCanvasText(content);
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
      provider
    ),
    vscode.commands.registerCommand("sogo-canvas.newCanvas", createNewCanvas)
  );
}

export function deactivate(): void {}
