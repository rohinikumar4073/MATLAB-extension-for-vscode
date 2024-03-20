// Copyright 2022 - 2024 The MathWorks, Inc.

import * as path from 'path'
import * as vscode from 'vscode'
import {
    LanguageClient, LanguageClientOptions, ServerOptions, TransportKind
} from 'vscode-languageclient/node'
import NotificationConstants from './NotificationConstants'
import TelemetryLogger, { TelemetryEvent } from './telemetry/TelemetryLogger'
import MVM from './commandwindow/MVM'
import { Notifier } from './commandwindow/Utilities'
import TerminalService from './commandwindow/TerminalService'
import Notification from './Notifications'
import ExecutionCommandProvider from './commandwindow/ExecutionCommandProvider'

let client: LanguageClient

const OPEN_SETTINGS_ACTION = 'workbench.action.openSettings'
const MATLAB_INSTALL_PATH_SETTING = 'matlab.installPath'

export const CONNECTION_STATUS_LABELS = {
    CONNECTED: 'MATLAB: Connected',
    NOT_CONNECTED: 'MATLAB: Not Connected',
    CONNECTING: 'MATLAB: Establishing Connection'
}
const CONNECTION_STATUS_COMMAND = 'matlab.changeMatlabConnection'
export let connectionStatusNotification: vscode.StatusBarItem

let telemetryLogger: TelemetryLogger


export async function activate (context: vscode.ExtensionContext): Promise<void> {
    let timeout: NodeJS.Timer | undefined

    // Initialize telemetry logger
    telemetryLogger = new TelemetryLogger(context.extension.packageJSON.version)
    telemetryLogger.logEvent({
        eventKey: 'ML_VS_CODE_ENVIRONMENT',
        data: {
            machine_hash: vscode.env.machineId,
            locale: vscode.env.language,
            os_platform: process.platform,
            vs_code_version: vscode.version
        }
    })
    function triggerUpdateDecorations (throttle = false): void {
        if (timeout != null) {
            clearTimeout(timeout)
            timeout = undefined
        }
        if (throttle) {
            timeout = setTimeout(updateDecorations, 500)
        } else {
            updateDecorations()
        }
    }
    // create a decorator type that we use to decorate small numbers
    const sectionDecorationType = vscode.window.createTextEditorDecorationType({
        borderWidth: '0 0 2px 0', // Top, right, bottom, left border widths
        borderColor: 'rgba(179, 222, 255)', // Red color with 50% opacity
        borderStyle: 'solid', // Solid border style
        overviewRulerColor: 'blue',
        isWholeLine: true,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: {
            // this color will be used in light color themes
            borderColor: 'rgba(179, 222, 255)'
        },
        dark: {
            // this color will be used in dark color themes
            borderColor: 'rgba(255, 0, 0)'
        }
    })
    let activeEditor = vscode.window.activeTextEditor
    function updateDecorations (): void {
        if (activeEditor == null) {
            return
        }
        const text = activeEditor.document.getText()
        const textLines = text.split('\n')

        const filteredIndexes: number[] = []
        textLines.forEach((line, index) => {
            if (findLineWithPercent(line)) {
                filteredIndexes.push(index)
            }
        })

        function findLineWithPercent (line: any): boolean {
            const regex = /^\s*%%\s.*/ // Regular expression for "%%" with optional spaces
            if (regex.test(line)) {
                return true
            }
            return false
        }
        const sectionDecorations: vscode.DecorationOptions[] = []
        filteredIndexes.forEach((index) => {
            const start = new vscode.Position(index - 1, 0)
            const end = new vscode.Position(index - 1, Number.MAX_VALUE)
            const decoration = { range: new vscode.Range(start, end), hoverMessage: 'Section' }
            sectionDecorations.push(decoration)
        })

        activeEditor.setDecorations(sectionDecorationType, sectionDecorations)
    }
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor
        if (editor != null) {
            triggerUpdateDecorations()
        }
    }, null, context.subscriptions)

    vscode.workspace.onDidChangeTextDocument(event => {
        if ((activeEditor != null) && event.document === activeEditor.document) {
            triggerUpdateDecorations(true)
        }
    }, null, context.subscriptions)

    // Set up status bar indicator
    connectionStatusNotification = vscode.window.createStatusBarItem()
    connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
    connectionStatusNotification.command = CONNECTION_STATUS_COMMAND
    connectionStatusNotification.show()
    context.subscriptions.push(connectionStatusNotification)

    context.subscriptions.push(vscode.commands.registerCommand(CONNECTION_STATUS_COMMAND, () => handleChangeMatlabConnection()))

    // Set up langauge server
    const serverModule: string = context.asAbsolutePath(
        path.join('server', 'out', 'index.js')
    )

    const args = getServerArgs(context)

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
            args
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: {
                // --inspect=6009: runs the server in Node's Inspector mode so
                // Visual Studio® Code can attach to the server for debugging
                execArgv: ['--nolazy', '--inspect=6009']
            },
            args
        }
    }

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: ['matlab']
    }

    // Create and start the language client
    client = new LanguageClient(
        'matlabls',
        'MATLAB Language Server',
        serverOptions,
        clientOptions
    )

    // Set up notification listeners
    client.onNotification(Notification.MatlabConnectionServerUpdate, (data: { connectionStatus: string }) => handleConnectionStatusChange(data))
    client.onNotification(Notification.MatlabLaunchFailed, () => handleMatlabLaunchFailed())
    client.onNotification(Notification.MatlabFeatureUnavailable, () => handleFeatureUnavailable())
    client.onNotification(Notification.MatlabFeatureUnavailableNoMatlab, () => handleFeatureUnavailableWithNoMatlab())
    client.onNotification(Notification.LogTelemetryData, (data: TelemetryEvent) => handleTelemetryReceived(data))

    mvm = new MVM(client as Notifier);
    terminalService = new TerminalService(client as Notifier, mvm);
    executionCommandProvider = new ExecutionCommandProvider(mvm, terminalService, telemetryLogger);

    context.subscriptions.push(vscode.commands.registerCommand('matlab.runFile', async () => await executionCommandProvider.handleRunFile()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.runSelection', async () => await executionCommandProvider.handleRunSelection()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.interrupt', () => executionCommandProvider.handleInterrupt()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.openCommandWindow', async () => await terminalService.openTerminalOrBringToFront()))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.addToPath', async (uri: vscode.Uri) => await executionCommandProvider.handleAddToPath(uri)))
    context.subscriptions.push(vscode.commands.registerCommand('matlab.changeDirectory', async (uri: vscode.Uri) => await executionCommandProvider.handleChangeDirectory(uri)))

    await client.start()
}

/**
 * Handles user input about whether to connect or disconnect from MATLAB®
 */
function handleChangeMatlabConnection (): void {
    void vscode.window.showQuickPick(['Connect to MATLAB', 'Disconnect from MATLAB'], {
        placeHolder: 'Change MATLAB Connection'
    }).then(choice => {
        if (choice == null) {
            return
        }

        if (choice === 'Connect to MATLAB') {
            sendConnectionActionNotification('connect')
        } else if (choice === 'Disconnect from MATLAB') {
            sendConnectionActionNotification('disconnect')
            terminalService.closeTerminal();
        }
    })
}

/**
 * Handles the notifiaction that the connection to MATLAB has changed (either has connected,
 * disconnected, or is in the process of connecting)
 *
 * @param data The notification data
 */
function handleConnectionStatusChange (data: { connectionStatus: string }): void {
    if (data.connectionStatus === 'connected') {
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTED
    } else if (data.connectionStatus === 'disconnected') {
        terminalService.closeTerminal();
        if (connectionStatusNotification.text === CONNECTION_STATUS_LABELS.CONNECTED) {
            const message = NotificationConstants.MATLAB_CLOSED.message
            const options = NotificationConstants.MATLAB_CLOSED.options
            vscode.window.showWarningMessage(message, ...options
            ).then(choice => {
                if (choice != null) {
                    // Selected to restart MATLAB
                    telemetryLogger.logEvent({
                        eventKey: 'ML_VS_CODE_ACTIONS',
                        data: {
                            action_type: 'restartMATLAB',
                            result: ''
                        }
                    })
                    sendConnectionActionNotification('connect')
                }
            }, reject => console.error(reject))
        }
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.NOT_CONNECTED
    } else if (data.connectionStatus === 'connecting') {
        connectionStatusNotification.text = CONNECTION_STATUS_LABELS.CONNECTING
    }
}

/**
 * Handles the notification that MATLAB failed to launch successfully. This most likely indicates that
 * either MATLAB is not installed or the installPath setting is not configured correctly.
 */
function handleMatlabLaunchFailed (): void {
    const message = NotificationConstants.MATLAB_LAUNCH_FAILED.message
    const options = NotificationConstants.MATLAB_LAUNCH_FAILED.options
    const url = 'https://www.mathworks.com/products/get-matlab.html'

    terminalService.closeTerminal();
    vscode.window.showErrorMessage(message, ...options).then(choice => {
        switch (choice) {
            case options[0]: // Get MATLAB
                void vscode.env.openExternal(vscode.Uri.parse(url))
                break
            case options[1]: // Open Settings
                void vscode.commands.executeCommand(OPEN_SETTINGS_ACTION, MATLAB_INSTALL_PATH_SETTING)
                break
        }
    }, reject => console.error(reject))
}

/**
 * Handles the notification that a triggered feature is unavailable without MATLAB running
 */
function handleFeatureUnavailable (): void {
    const message = NotificationConstants.FEATURE_UNAVAILABLE.message
    const options = NotificationConstants.FEATURE_UNAVAILABLE.options

    terminalService.closeTerminal();
    vscode.window.showErrorMessage(
        message,
        ...options
    ).then(choice => {
        if (choice != null) {
            // Selected to start MATLAB
            sendConnectionActionNotification('connect')
        }
    }, reject => console.error(reject))
}

/**
 * Handles the notification that a triggered feature is unavailable without MATLAB running,
 * and MATLAB is also unavailable on the system.
 */
function handleFeatureUnavailableWithNoMatlab (): void {
    const message = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.message
    const options = NotificationConstants.FEATURE_UNAVAILABLE_NO_MATLAB.options
    const url = 'https://www.mathworks.com/products/get-matlab.html'

    terminalService.closeTerminal();
    vscode.window.showErrorMessage(message, ...options).then(choice => {
        switch (choice) {
            case options[0]: // Get MATLAB
                void vscode.env.openExternal(vscode.Uri.parse(url))
                break
            case options[1]: // Open Settings
                void vscode.commands.executeCommand(OPEN_SETTINGS_ACTION, MATLAB_INSTALL_PATH_SETTING)
                break
        }
    }, reject => console.error(reject))
}

function handleTelemetryReceived (event: TelemetryEvent): void {
    event.eventKey = `ML_VS_CODE_${event.eventKey}`
    telemetryLogger.logEvent(event)
}

/**
 * Gets the arguments with which to launch the language server
 *
 * @param context The extension context
 * @returns An array of arguments
 */
function getServerArgs (context: vscode.ExtensionContext): string[] {
    const configuration = vscode.workspace.getConfiguration('MATLAB')
    const args = [
        `--matlabInstallPath=${configuration.get<string>('installPath') ?? ''}`,
        `--matlabConnectionTiming=${configuration.get<string>('launchMatlab') ?? 'onStart'}`
    ]

    if (configuration.get<boolean>('indexWorkspace') ?? false) {
        args.push('--indexWorkspace')
    }

    return args
}

/**
 * Sends notification to language server to instruct it to either connect to or disconnect from MATLAB.
 * @param connectionAction The action - either 'connect' or 'disconnect'
 */
export function sendConnectionActionNotification (connectionAction: 'connect' | 'disconnect'): void {
    void client.sendNotification(Notification.MatlabConnectionClientUpdate, {
        connectionAction
    })
}

// this method is called when your extension is deactivated
export async function deactivate (): Promise<void> {
    await client.stop()
    void client.dispose()
}
