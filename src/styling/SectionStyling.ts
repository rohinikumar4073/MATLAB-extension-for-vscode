import * as vscode from 'vscode';
import RangeTree from './RangeTree';
let previousEditorSections: any, cachedCursorPosition: vscode.Position;
// Create a decorator type for highlighted section
const blueBorder = {
    borderColor: 'rgb(38,140,221)',
    borderStyle: 'solid',
    overviewRulerColor: 'blue',
    isWholeLine: true,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        borderColor: 'rgb(38,140,221)'
    },
    dark: {
        borderColor: 'rgb(38,140,221)'
    }
};
const blueBorderTopDecoration = vscode.window.createTextEditorDecorationType(Object.assign(blueBorder, { borderWidth: '1px 0 0 0', fontWeight: 'bold' }));
const blueBorderBottomDecoration = vscode.window.createTextEditorDecorationType(Object.assign(blueBorder, { borderWidth: '0 0 1px 0' }));

const greyBorder = {
    borderColor: 'rgb(38,140,221)',
    borderStyle: 'solid',
    overviewRulerColor: 'blue',
    isWholeLine: true,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
        borderColor: 'rgb(136,136,136)'
    },
    dark: {
        borderColor: 'rgb(166,166,166)'
    }
}

const greyBorderTopDecoration = vscode.window.createTextEditorDecorationType(Object.assign(greyBorder, { borderWidth: '1px 0 0 0', fontWeight: 'bold' }));
const greyBorderBottomDecoration = vscode.window.createTextEditorDecorationType(Object.assign(greyBorder, { borderWidth: '0 0 1px 0' }));

// Create a decorator type for all sectoin

function handleSelectionChange (event: any): void {
    const selections = event.selections;
    selections.forEach((selection: { isEmpty: boolean, active: any }, index: any) => {
        if (selection.isEmpty) {
            cachedCursorPosition = selection.active;
        }
    });
    addSectionDecoration(previousEditorSections);
}

function addSectionDecoration (sections: any): void {
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor == null) {
        return;
    }
    previousEditorSections = sections;

    const { ranges, startLines, endLines } = convertSectionsToRanges(sections)
    const focusedSectionRange: vscode.Range | undefined = findActiveSection(ranges);
    const { blueRanges, greyRanges } = getSectionDecorationRanges(startLines, endLines, focusedSectionRange);

    activeEditor.setDecorations(blueBorderTopDecoration, blueRanges.top);
    // activeEditor.setDecorations(blueBorderBottomDecoration, blueRanges.bottom);
    activeEditor.setDecorations(greyBorderTopDecoration, greyRanges.top);
    // activeEditor.setDecorations(greyBorderBottomDecoration, greyRanges.bottom);
}
function clearBlueDecorations (editor: vscode.TextEditor): void {
    editor.setDecorations(blueBorderTopDecoration, []);
    editor.setDecorations(blueBorderBottomDecoration, []);
}
function getSectionDecorationRanges (startLines: Set<number>,
    endLines: Set<number>, focusedSectionRange: vscode.Range | undefined): {
        blueRanges: { top: vscode.Range[], bottom: vscode.Range[] }
        greyRanges: { top: vscode.Range[], bottom: vscode.Range[] }
    } {
    const blueRanges = { top: [] as vscode.Range[], bottom: [] as vscode.Range[] };
    const greyRanges = { top: [] as vscode.Range[], bottom: [] as vscode.Range[] };
    const focusedStartLine = focusedSectionRange?.start?.line;
    const focusedEndLine = focusedSectionRange?.end?.line;

    // Most of the times the end of the section is the start of the node
    // So add them accordingly
    const startLinesFiltered = Array.from(startLines).filter((startLine) => {
        if (focusedStartLine !== undefined) {
            return startLine !== focusedStartLine
        }
        if (focusedEndLine !== undefined) {
            return startLine !== (focusedEndLine + 1)
        }
        return true;
    });
    greyRanges.top = startLinesFiltered.map((sectionLine: number) => {
        return (
            new vscode.Range(new vscode.Position(sectionLine, 0),
                new vscode.Position(sectionLine, Infinity))
        );
    });
    const endLinesFiltered = Array.from(endLines).filter((endLine) => {
        if (focusedStartLine !== undefined) {
            return (endLine) !== (focusedStartLine - 1)
        }
        if (focusedEndLine !== undefined) {
            return endLine !== focusedEndLine
        }
        return true;
    });
    greyRanges.bottom = endLinesFiltered.map((sectionLine: number) => {
        return (
            new vscode.Range(new vscode.Position(sectionLine, 0),
                new vscode.Position(sectionLine, Infinity))
        );
    });
    if (focusedStartLine !== undefined) {
        blueRanges.top = [
            new vscode.Range(
                new vscode.Position(focusedStartLine, 0),
                new vscode.Position(focusedStartLine, Infinity))
        ];
    }
    if (focusedEndLine !== undefined) {
        blueRanges.bottom = [
            new vscode.Range(
                new vscode.Position(focusedEndLine, 0),
                new vscode.Position(focusedEndLine, Infinity))
        ];
    }
    return { blueRanges, greyRanges };
}

function findActiveSection (ranges: vscode.Range[]): vscode.Range | undefined {
    const rangeTree = new RangeTree(ranges);
    let activeSection: vscode.Range | undefined;
    if (cachedCursorPosition !== undefined) {
        activeSection = rangeTree.find(cachedCursorPosition.line);
    }
    return activeSection;
}

interface SectionDetails {
    startLines: Set<number>
    endLines: Set<number>
    ranges: vscode.Range []
}
function convertSectionsToRanges (sections: any): SectionDetails {
    const startLines = new Set<number>();
    const endLines = new Set<number>();

    const ranges = sections.map((section: any) => {
        const startingIndex = section.start.line
        const endingIndex = section.end.line
        console.log('Section', startingIndex, endingIndex);
        startLines.add(startingIndex)
        endLines.add(endingIndex)
        const sectionStartPosition = new vscode.Position(startingIndex, 0)
        const sectionEndPosition = new vscode.Position(endingIndex, 0);
        return new vscode.Range(sectionStartPosition, sectionEndPosition);
    })
    return { ranges, startLines, endLines };
}

export { addSectionDecoration, handleSelectionChange, clearBlueDecorations };
