/* Runtime-supplied text is rendered with textContent, never HTML. */
const vscode = acquireVsCodeApi();
const code = document.getElementById('code');
const history = document.getElementById('history');
const entries = new Map();
const resultTargets = new Map();
let inspectionSequence = 0;
let commands = [];
let historyIndex = 0;
let draft = '';
code.value = vscode.getState()?.draft || '';

function text(parent, tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
}
function button(parent, label, action) {
    const element = text(parent, 'button', label, 'secondary');
    element.addEventListener('click', action);
    return element;
}
function saveDraft() { vscode.setState({ draft: code.value }); }
function useCode(value) { code.value = value; saveDraft(); code.focus(); }
function run() {
    if (!code.value.trim()) return;
    vscode.postMessage({ kind: 'execute', code: code.value });
    useCode('');
    historyIndex = commands.length;
}
document.getElementById('run').addEventListener('click', run);
code.addEventListener('input', () => { saveDraft(); historyIndex = commands.length; });
code.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); }
    else if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        code.setRangeText('    ', code.selectionStart, code.selectionEnd, 'end');
        saveDraft();
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        if (historyIndex === commands.length) draft = code.value;
        historyIndex = Math.max(0, Math.min(commands.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
        useCode(historyIndex === commands.length ? draft : commands[historyIndex]);
        code.setSelectionRange(code.value.length, code.value.length);
    }
});
for (const action of ['stop', 'reset', 'clear', 'variables']) {
    document.getElementById(action).addEventListener('click', () => vscode.postMessage({ kind: action }));
}

function inspectChildren(container, path, executionId) {
    const id = String(++inspectionSequence);
    resultTargets.set(id, { container, path, executionId });
    text(container, 'span', 'Loading…', 'result-label');
    vscode.postMessage({ kind: 'inspectResult', id, executionId, path });
}
function expandableValue(parent, variable, path, executionId) {
    const details = document.createElement('details');
    details.className = 'result-tree';
    text(details, 'summary', `${variable.name}: ${variable.type} = ${variable.value}`);
    const children = text(details, 'div', '', 'result-children');
    let loaded = false;
    details.addEventListener('toggle', () => {
        if (!details.open || loaded) return;
        loaded = true;
        inspectChildren(children, path, executionId);
    });
    parent.appendChild(details);
}

function updateExecution(execution) {
    const follow = history.scrollHeight - history.scrollTop - history.clientHeight < 60;
    document.getElementById('empty')?.remove();
    let entry = entries.get(execution.id);
    if (!entry) {
        const article = document.createElement('article');
        const header = text(article, 'div', '', 'execution-header');
        text(header, 'span', `In [${execution.id}]`, 'execution-number');
        const state = text(header, 'span', '', 'execution-state');
        const duration = text(header, 'span', '', 'duration');
        const actions = text(header, 'div', '', 'execution-actions');
        button(actions, 'Use code', () => { useCode(execution.code); historyIndex = commands.length; });
        button(actions, 'Run again', () => vscode.postMessage({ kind: 'rerun', id: execution.id }));
        if (execution.source) {
            const source = text(article, 'p', execution.source.split(/[\\/]/).pop(), 'source');
            source.title = execution.source;
        }
        text(article, 'pre', execution.code, 'executed-code');
        const output = text(article, 'div', '', 'execution-output');
        history.appendChild(article);
        entry = { article, state, duration, output, execution };
        entries.set(execution.id, entry);
    }
    entry.execution = execution;
    entry.article.dataset.state = execution.state;
    entry.state.textContent = execution.state;
    entry.duration.textContent = execution.durationMs === undefined ? '' : `${(execution.durationMs / 1000).toFixed(2)}s`;
    if (execution.response) {
        entry.output.replaceChildren();
        if (execution.response.output) text(entry.output, 'pre', execution.response.output, 'stdout');
        if (execution.response.result && execution.response.result.type !== 'null') {
            text(entry.output, 'span', `Out [${execution.id}] · ${execution.response.result.type}`, 'result-label');
            if (execution.response.result.expandable) expandableValue(entry.output, execution.response.result, [], execution.id);
            else text(entry.output, 'pre', execution.response.result.value, 'result');
        }
        if (execution.response.error) text(entry.output, 'pre', execution.response.error, 'error');
        document.getElementById('announcement').textContent = `Execution ${execution.id} ${execution.state.toLowerCase()}`;
    }
    while (entries.size > 100) {
        const oldest = entries.keys().next().value;
        entries.get(oldest).article.remove();
        entries.delete(oldest);
    }
    const atEnd = historyIndex === commands.length;
    commands = Array.from(entries.values()).map(item => item.execution.code);
    historyIndex = atEnd ? commands.length : Math.min(historyIndex, commands.length);
    if (follow) history.scrollTop = history.scrollHeight;
}

window.addEventListener('message', ({ data }) => {
    if (data.kind === 'status') {
        const status = document.getElementById('status');
        status.textContent = data.status;
        status.dataset.state = data.status;
        document.getElementById('environment').textContent = data.environment;
        document.getElementById('stop').disabled = data.status === 'Stopped' || data.status === 'Failed';
    } else if (data.kind === 'resultChildren') {
        const target = resultTargets.get(data.id);
        resultTargets.delete(data.id);
        if (!target?.container.isConnected) return;
        target.container.replaceChildren();
        if (!data.ok) text(target.container, 'pre', data.error, 'error');
        else if (!data.variables?.length) text(target.container, 'span', '(empty)', 'result-label');
        else for (const variable of data.variables) {
            const path = [...target.path, variable.name];
            if (variable.expandable && path.length < 20) expandableValue(target.container, variable, path, target.executionId);
            else text(target.container, 'pre', `${variable.name}: ${variable.type} = ${variable.value}`);
        }
    } else if (data.kind === 'execution') updateExecution(data);
    else if (data.kind === 'history') {
        history.replaceChildren();
        entries.clear();
        resultTargets.clear();
        commands = [];
        for (const execution of data.executions) updateExecution(execution);
        if (!data.executions.length) text(history, 'p', 'Run BoxLang code here or send a selection from the editor. Inspect state in REPL Variables.', 'empty').id = 'empty';
        historyIndex = commands.length;
    } else if (data.kind === 'error') text(history, 'pre', data.error, 'error');
});
vscode.postMessage({ kind: 'ready' });
