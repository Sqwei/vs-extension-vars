import * as vscode from 'vscode';
import { get } from 'https';

let valueMap: Record<string, string> = {};
let nameMap: Record<string, string> = {};
let tokenList: string[][] = [];
let iconList: string[][] = [];

/**
 * 下载teamix的颜色变量
 * @param url
 */
export async function httpGet(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    get(url, response => {
      let body = '';
      response.on('data', chunk => {
          body += chunk;
      });
      response.on('end', () => {
          resolve(body);
      });
      response.on('error', () => {
          reject(`Could not read token: "${url}"`);
      });
    });
  });
}

async function getTokenMap() {
	const response = await httpGet('ddd');
	const { brandColor, grayColor, functionalColor } = JSON.parse(response).data.data['yunxiao-v5'];
	const tokens = [
		...brandColor.content, 
		...grayColor.content, 
		...functionalColor.map((item: any) => item.content).flat()
	];
	tokens.forEach((item) => {
		const variable = item.dataSource?.[0]?.value || item.colorValue;
		nameMap[item.colorName] = variable;
		valueMap[item.colorValue] = variable;
    tokenList.push([item.colorName, item.colorValue, item.dataSource?.[0]?.value]);
	});
}

async function getIconMap() {
  const bizIconProject = 
    await httpGet('ddd');
  const basicIconProject = 
    await httpGet('ddd');

  const icons = JSON.parse(bizIconProject).data.icons.concat(JSON.parse(basicIconProject).data.icons);

  icons.forEach((item: any) => {
    iconList.push([item.font_class, item.show_svg.replace("currentColor", "white")]);
  });
}

/**
 * Command + shift + p 输入颜色名字或者颜色值，自动替换为变量
 */
export async function showQuickPick() {
  const quickPick = vscode.window.createQuickPick();
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = true;
  quickPick.placeholder = '输入名字或值搜索颜色';
  const options: vscode.QuickPickItem[] = tokenList.map(([name, value, variable]) => ({ 
    label: `${name}: ${value}`, 
    description: variable || value,
  }));
  quickPick.items = options;
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();

  quickPick.onDidChangeSelection((i) => {
    quickPick.hide();
    const selected = i[0];
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const text = selected.description || '';
    editor.edit(textEditorEdit => editor.selections.forEach(selection => textEditorEdit.replace(selection, text)));
  });
}

/**
 *  根据颜色值或者颜色名字自动补全
 */
export default class CompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument, 
    position: vscode.Position, 
  ): vscode.ProviderResult<vscode.CompletionList>{
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      return { 
        items: [], 
        isIncomplete: false
      };
    }
    return {
      items: tokenList.map(([name, value, variable]) => {
        const svgCode = `<svg fill="${value}" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10073" width="60" height="60"><path d="M373.328 357.136l-242.656 28.772-1.052 0.136c-33.12 4.752-46.196 46.02-21.4 68.952l179.404 165.904-47.62 239.676-0.188 1c-5.752 32.992 29.472 58.204 58.96 41.7L512 783.916l213.224 119.36 0.896 0.488c29.6 15.664 64.46-10.044 57.876-43.188l-47.624-239.676 179.404-165.904 0.772-0.728c24-23.316 10.32-64.384-23.22-68.36l-242.66-28.772-102.344-221.888c-14.3-31-58.348-31-72.648 0L373.328 357.136z" p-id="10074"></path></svg>`;
        const base64 = Buffer.from(svgCode).toString('base64');
        const documentation = new vscode.MarkdownString(`<b>名称：${name}</b><h5>色值：${variable}</h5><img src="data:image/svg+xml;base64,${base64}" />`);
        documentation.supportHtml = true;
        return ({
          label: value,
          description: name,
          insertText: variable || value,
          documentation,
          kind: vscode.CompletionItemKind.Color,
          filterText: `${name} ${variable}`
        });
      }),
      isIncomplete: true,
    };
  }
}

/**
 * 根据颜色值或者颜色名字替换为变量
 */
class RegexReplacer implements vscode.CodeActionProvider {
	public regex = new RegExp('(#[0-9a-f]{3,8}\\b)|(rgb|hsl)a?[^)]*\\)|(SNOW|B|G|R|GB|O|Y|GP)[0-9]{1,}', 'i');

  public static documentSelectors = [
    { language: "css" },
    { language: "scss" },
    { language: "less" },
    { language: "vue" },
    { language: "jsx" },
    { language: "tsx" },
  ];

  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] | undefined {
    const [matchResult, line] = this.isMatchRegex(document, range);
    if (!matchResult) {
      return;
    }
    const lineRange = line.range;
    const originText = matchResult[0].trim();

    const originRange = new vscode.Range(
      lineRange.start.translate(0, matchResult.index),
      lineRange.start.translate(0, matchResult.index + originText.length)
    );

    const targetTexts = this.getReplaceTargets(originText);

    const fixes = targetTexts.map((targetText) =>
      this.createFix(document, originRange, targetText, originText)
    );

    if (fixes.length) {
      fixes[0].isPreferred = true;
    }
    return fixes;
  }

  public getReplaceTargets(originText: string): string[] {
    const colorStr = originText.toLocaleUpperCase();
    const variable = valueMap[colorStr] || nameMap[colorStr];
    return variable ? [variable] : [];
  }

  private isMatchRegex(
    document: vscode.TextDocument,
    range: vscode.Range
  ): [RegExpExecArray | null, vscode.TextLine] {
    const line = document.lineAt(range.start);
    const matchResult = this.regex.exec(line.text);
    return [matchResult, line];
  }

  private createFix(
    document: vscode.TextDocument,
    range: vscode.Range,
    targetText: string,
    originText: string
  ): vscode.CodeAction {
    const fix = new vscode.CodeAction(
      `Replace [ ${originText} ] with ${targetText}`,
      vscode.CodeActionKind.QuickFix
    );
    fix.edit = new vscode.WorkspaceEdit();
    fix.edit.replace(document.uri, range, targetText);
    return fix;
  }
}

/**
 * icon 联想 预览
 */
class IconCompletionProvider implements vscode.CompletionItemProvider {
  public static documentSelectors = [
    { language: "javascriptreact" },
    { language: "typescriptreact" },
  ];

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionList> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      return {
        items: [],
        isIncomplete: false,
      };
    }
    
    const prefix = document.lineAt(position.line).text.substring(0, position.character);
    // 离当前位置最近的是YunxiaoIcon还是ButtonIcon
    const yunxiaoIconIdx = prefix.lastIndexOf('YunxiaoIcon');
    const buttonIconIdx = prefix.lastIndexOf('ButtonIcon');

    const isButtonIcon = yunxiaoIconIdx < buttonIconIdx;

    if (!(yunxiaoIconIdx > - 1 || buttonIconIdx > -1)) {
      return {
        items: [],
        isIncomplete: false,
      };
    }

    return {
      items: iconList.map(([fontClass, showSvg]) => {
        const base64 = Buffer.from(showSvg).toString("base64");
        const documentation = new vscode.MarkdownString(
          `<b>id: ${fontClass}</b><img src="data:image/svg+xml;base64,${base64}" />`
        );
        documentation.supportHtml = true;
        return {
          label: fontClass,
          documentation,
          kind: vscode.CompletionItemKind.Text,
          filterText: `${fontClass}`,
          insertText: `${isButtonIcon ? 'name' : 'type'}="${fontClass}"`
        };
      }),
      isIncomplete: true,
    };
  }
}

// this method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
	await getTokenMap();
  await getIconMap();

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			RegexReplacer.documentSelectors,
			new RegexReplacer(),
			{
				providedCodeActionKinds: RegexReplacer.providedCodeActionKinds,
			}
		)
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			IconCompletionProvider.documentSelectors,
			new IconCompletionProvider(),
      '*'
		)
	);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
			RegexReplacer.documentSelectors,
			new CompletionProvider(),
      '#','SNOW','B','G','R','GB','O','Y','GP','var', ' ', '(', ')', 'rgb', 'hsl', 'rgba', 'hsla'
		)
  );
  context.subscriptions.push(vscode.commands.registerCommand('yunxiao-css-var.pick', showQuickPick));
}


// This method is called when your extension is deactivated
export function deactivate() {}
