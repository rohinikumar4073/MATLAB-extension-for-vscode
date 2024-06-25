
// Copyright 2019-2022 The MathWorks, Inc.
import * as vscode from 'vscode';

/**
     * A node used in the LineRangeTree.
     * @class TreeNode
     */
class TreeNode {
    range: vscode.Range | undefined;
    children: TreeNode[];
    parent: TreeNode | undefined;
    _startLine: number | undefined;
    _endLine: number | undefined;
    constructor (range: vscode.Range | undefined) {
        this.range = range;
        this.children = [];
        this.parent = undefined;

        if (range == null) {
            this._startLine = 0;
            this._endLine = Infinity;
        }
    }

    add (treeNode: TreeNode): void {
        this.children.push(treeNode);
        treeNode.parent = this;
    }

    getStartLine (): number {
        if (this._startLine === undefined && this.range !== undefined) {
            this._startLine = this.range.start.line;
        }

        return this._startLine ?? 0;
    }

    getEndLine (): number {
        if (this._endLine === undefined && this.range !== undefined) {
            this._endLine = this.range.end.line;
        }

        return this._endLine ?? 0;
    }
}

/**
     * LineRangeTree is a line-based hierarchical data structure that allows fast, log time look up.
     * It accepts a list of objects that implement getStartLine and getEndLine methods (zero-based).
     * These line numbers define the range of the object. A line number that's within the range is
     * *contained* in the object. The caller can query the corresponding object by using a line
     * number, and the tree will return the object that has the smallest range containing the line.
     *
     * In the tree, an input object mentioned above is wrapped by a TreeNode. The position of a
     * node is based on its line range. Some other rules:
     * * A parent node's range always contains a child node's range
     * * Ranges are always not overlapped among a parent's immediate child nodes.
     * * The line number is zero-based.

     * As an example, there are 4 nodes in the tree:
     * (1) line 1 to 10
     * (2) line 3 to 6
     * (3) line 4 to 5
     * (4) line 7 to 9
     *
     *   /-------- 1
     *   |         2
     *   | /------ 3
     *   | | /---- 4
     *   | | \---- 5
     *   | \------ 6
     *   | /------ 7
     *   | |       8
     *   | \------ 9
     *   \-------- 10
     *
     * The query results given various input line number:
     * * line 1, 2, 10 correspond to node (1)
     * * line 3, 6 correspond to node (2)
     * * line 4, 5 correspond to node (3)
     * * line 7, 8, 9 correspond to node (4)
     *
     * @class LineRangeTree
     */
export default class RangeTree {
    _root: TreeNode | undefined;

    constructor (sections: vscode.Range[]) {
        this.set(sections);
    }

    /**
         * Configures the tree. This will reset the internal data structure.
         *
         * @param {array} objects An array of objects that implement getStartLine and getEndLine,
         *     both returning zero-based line numbers that define the range.
         */
    set (sections: vscode.Range[]): void {
        this._root = new TreeNode(undefined);
        sections = this._sortByStartLine(sections);

        const objectLength = sections.length;
        let currentNode: TreeNode | undefined;
        currentNode = this._root;

        for (let i = 0; i < objectLength; i++) {
            const nodeToAdd = new TreeNode(sections[i]);

            while (currentNode != null) {
                if (nodeToAdd.getStartLine() >= currentNode.getStartLine() &&
                        nodeToAdd.getEndLine() <= currentNode.getEndLine()) {
                    currentNode.add(nodeToAdd);
                    currentNode = nodeToAdd;
                    break;
                } else {
                    currentNode = currentNode.parent;
                }
            }
        }
    }

    /**
         * Gets an array of the top level ranges of the tree
         * @returns {Array} array of the the top level nodes
         */
    getTopLevelRanges (): TreeNode[] | undefined {
        return this._root?.children;
    }

    /**
         * Finds the object with smallest range (dfs) containing the given line number unless
         * topLevel is set as true which means we search with the widest range.
         *
         * @param {number} line
         * @param topLevel true if you want to search for the widest range (bfs)
         * @returns {*}
         */
    find (line: number): vscode.Range | undefined {
        let currentNode: TreeNode | undefined;

        currentNode = this._root;
        let lastNode = currentNode;

        while (currentNode != null) {
            currentNode = this._searchByLine(line, currentNode);
            lastNode = currentNode ?? lastNode;
        }
        return (lastNode != null) ? lastNode.range : undefined;
    }

    /**
         * For the give line number, the findAll method gives a list of all the range nodes
         * which has the line number in it.
         * In other words, it gives the DFS results with a list to all the nodes in the path.
         * @param line
         * @returns {*}
         */
    findAll (line: any): Set<vscode.Range | undefined> {
        const setOfObjects = new Set<vscode.Range | undefined>();
        let currentNode = this._root;

        while (currentNode != null) {
            currentNode = this._searchByLine(line, currentNode);
            if (currentNode !== undefined) {
                // This property helps to determine if the given node is a leafNode or not
                setOfObjects.add(currentNode.range);
            }
        }

        return setOfObjects;
    }

    _searchByLine (line: number, parentNode: TreeNode): TreeNode | undefined {
        const length = parentNode.children.length;
        if (length === 0) {
            return undefined;
        }

        let result: TreeNode | undefined;
        let start = 0;
        let end = length - 1;

        while (start <= end) {
            const mid = Math.floor((start + end) / 2);
            const midNode = parentNode.children[mid];
            const midNodeStartLine = midNode.getStartLine() ?? 0;
            if (line >= midNodeStartLine &&
                    line <= midNode.getEndLine()) {
                result = midNode;
                break;
            } else if (line < midNodeStartLine) {
                end = mid - 1;
            } else {
                start = mid + 1;
            }
        }

        return result;
    }

    _sortByStartLine (treeNodes: vscode.Range[]): vscode.Range[] {
        treeNodes = treeNodes.slice().sort(function (a: vscode.Range, b: vscode.Range) {
            const firstStartLine = a.start.line ?? 0;
            const secondStartLine = b.start.line ?? 0;
            return firstStartLine - secondStartLine;
        });
        return treeNodes;
    }
}
