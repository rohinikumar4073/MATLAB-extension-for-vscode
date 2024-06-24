import * as vscode from 'vscode';

export class MyDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    public provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        // Your logic to find symbols in 'document'
        // Return an array of vscode.SymbolInformation or vscode.DocumentSymbol objects
        debugger;
        return [];
    }
}