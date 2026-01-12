import * as vscode from 'vscode';
import { TimerService, TimerState } from '../services/timerService';
import { OdooTimesheet, Project, Task, TimesheetEntry } from '../odoo/timesheet';

export class TimesheetPanel {
	public static currentPanel: TimesheetPanel | undefined;

	public static readonly viewType = 'odooTimesheetPanel';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _timerService: TimerService;
	private readonly _timesheet: OdooTimesheet;
	private readonly _context: vscode.ExtensionContext;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(
		extensionUri: vscode.Uri,
		timerService: TimerService,
		timesheet: OdooTimesheet,
		context: vscode.ExtensionContext
	) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it and refresh state
		if (TimesheetPanel.currentPanel) {
			TimesheetPanel.currentPanel._panel.reveal(column);
			TimesheetPanel.currentPanel.refreshPanelState();
			return;
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel(
			TimesheetPanel.viewType,
			'Timesheets',
			column || vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [extensionUri],
			}
		);

		TimesheetPanel.currentPanel = new TimesheetPanel(
			panel,
			extensionUri,
			timerService,
			timesheet,
			context
		);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		timerService: TimerService,
		timesheet: OdooTimesheet,
		context: vscode.ExtensionContext
	) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._timerService = timerService;
		this._timesheet = timesheet;
		this._context = context;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programmatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.command) {
					case 'getState':
						this._sendState();
						break;
					case 'getProjects':
						this._sendProjects();
						break;
					case 'getTasks':
						if (message.projectId) {
							this._sendTasks(message.projectId);
						}
						break;
					case 'startTimer':
						if (message.description && message.projectId) {
							await this._startTimer(
								message.description,
								message.projectId,
								message.taskId
							);
						}
						break;
					case 'stopTimer':
						await this._stopTimer();
						break;
					case 'getTodayEntries':
						await this._sendTodayEntries();
						break;
					case 'refresh':
						this._update();
						break;
				}
			},
			null,
			this._disposables
		);

		// Subscribe to timer state updates
		this._timerService.onStateUpdate(() => {
			this._sendState();
		});

		// Refresh state initially to ensure sync
		this.refreshPanelState();
	}

	private async _startTimer(
		description: string,
		projectId: number,
		taskId?: number
	): Promise<void> {
		const success = await this._timerService.startTimer(description, projectId, taskId);
		if (success) {
			this._sendState();
			await this._sendTodayEntries();
		}
	}

	private async _stopTimer(): Promise<void> {
		const success = await this._timerService.stopTimer();
		if (success) {
			this._sendState();
			await this._sendTodayEntries();
		}
	}

	private _sendState(): void {
		try {
			const state = this._timerService.getState();
			const elapsed = this._timerService.getElapsedTimeFormatted();
			this._panel.webview.postMessage({
				command: 'updateState',
				state: {
					isRunning: state.isRunning,
					elapsed: elapsed,
					entry: state.entry,
				},
			});
		} catch (error: any) {
			// Webview might be disposed, ignore silently
			const errorMsg = error?.message || String(error);
			if (errorMsg.includes('disposed') || errorMsg.includes('Webview is disposed')) {
				return;
			}
			console.error('Failed to send state to webview:', error);
		}
	}

	private async _sendProjects(): Promise<void> {
		try {
			const projects = await this._timesheet.getProjects();
			this._panel.webview.postMessage({
				command: 'updateProjects',
				projects: projects,
			});
		} catch (error: any) {
			const errorMsg = error?.message || String(error);
			if (errorMsg.includes('disposed') || errorMsg.includes('Webview is disposed')) {
				return;
			}
			try {
				this._panel.webview.postMessage({
					command: 'error',
					message: `Failed to load projects: ${errorMsg}`,
				});
			} catch (postError: any) {
				// Ignore if webview is disposed
				const postErrorMsg = postError?.message || String(postError);
				if (!postErrorMsg.includes('disposed') && !postErrorMsg.includes('Webview is disposed')) {
					console.error('Failed to send error to webview:', postError);
				}
			}
		}
	}

	private async _sendTasks(projectId: number): Promise<void> {
		try {
			const tasks = await this._timesheet.getTasks(projectId);
			this._panel.webview.postMessage({
				command: 'updateTasks',
				tasks: tasks,
			});
		} catch (error: any) {
			const errorMsg = error?.message || String(error);
			if (errorMsg.includes('disposed') || errorMsg.includes('Webview is disposed')) {
				return;
			}
			try {
				this._panel.webview.postMessage({
					command: 'error',
					message: `Failed to load tasks: ${errorMsg}`,
				});
			} catch (postError: any) {
				// Ignore if webview is disposed
				const postErrorMsg = postError?.message || String(postError);
				if (!postErrorMsg.includes('disposed') && !postErrorMsg.includes('Webview is disposed')) {
					console.error('Failed to send error to webview:', postError);
				}
			}
		}
	}

	private async _sendTodayEntries(): Promise<void> {
		try {
			const client = this._timerService.getClient();
			const session = client?.getSession();
			if (!session) {
				this._panel.webview.postMessage({
					command: 'updateEntries',
					entries: [],
				});
				return;
			}

			const entries = await this._timesheet.getTodayTimesheetEntries(session.uid);
			
			// Enrich entries with project and task names
			const enrichedEntries = await this._enrichEntriesWithNames(entries);
			
			this._panel.webview.postMessage({
				command: 'updateEntries',
				entries: enrichedEntries,
			});
		} catch (error: any) {
			const errorMsg = error?.message || String(error);
			if (errorMsg.includes('disposed') || errorMsg.includes('Webview is disposed')) {
				return;
			}
			try {
				this._panel.webview.postMessage({
					command: 'error',
					message: `Failed to load entries: ${errorMsg}`,
				});
			} catch (postError: any) {
				// Ignore if webview is disposed
				const postErrorMsg = postError?.message || String(postError);
				if (!postErrorMsg.includes('disposed') && !postErrorMsg.includes('Webview is disposed')) {
					console.error('Failed to send error to webview:', postError);
				}
			}
		}
	}

	private async _enrichEntriesWithNames(entries: any[]): Promise<any[]> {
		if (entries.length === 0) {
			return entries;
		}

		try {
			// Collect unique project IDs
			const projectIds = [...new Set(entries.map(e => e.project_id).filter((id): id is number => !!id))];
			
			// Load all projects
			const allProjects = await this._timesheet.getProjects();
			const projectMap = new Map(allProjects.map(p => [p.id, p.name]));

			// Load tasks per project
			const taskMap = new Map<number, string>();
			for (const projectId of projectIds) {
				try {
					const tasks = await this._timesheet.getTasks(projectId);
					tasks.forEach(t => taskMap.set(t.id, t.name));
				} catch (error) {
					// Silent fail for individual project tasks
					console.log(`Failed to load tasks for project ${projectId}:`, error);
				}
			}

			// Enrich entries with names
			return entries.map(entry => ({
				...entry,
				project_name: entry.project_id ? projectMap.get(entry.project_id) || null : null,
				task_name: entry.task_id ? taskMap.get(entry.task_id) || null : null,
			}));
		} catch (error) {
			// If enrichment fails, return original entries
			console.error('Failed to enrich entries with names:', error);
			return entries;
		}
	}

	private async refreshPanelState(): Promise<void> {
		// Refresh state from TimerService to ensure sync
		await this._timerService.refreshState();
		// Send updated state to webview immediately
		this._sendState();
		// Also send state after a short delay to ensure webview receives it
		setTimeout(() => {
			this._sendState();
		}, 200);
	}

	public dispose() {
		TimesheetPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _update() {
		const webview = this._panel.webview;
		this._panel.webview.html = this._getHtmlForWebview(webview);

		// Send initial data after a brief delay to ensure webview is loaded
		setTimeout(() => {
			this._sendState();
			this._sendProjects();
			this._sendTodayEntries();
		}, 100);
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get VS Code theme colors
		const vscodeTheme = vscode.window.activeColorTheme;
		const isDark = vscodeTheme.kind === vscode.ColorThemeKind.Dark || vscodeTheme.kind === vscode.ColorThemeKind.HighContrast;

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Odoo Timesheets</title>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			padding: 20px;
			overflow: hidden;
		}

		.timesheet-container {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 24px;
			height: 100vh;
			max-height: calc(100vh - 40px);
		}

		.left-panel, .right-panel {
			display: flex;
			flex-direction: column;
			gap: 20px;
			overflow-y: auto;
		}

		.panel-section {
			background-color: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 20px;
		}

		.timer-status {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 14px 16px;
			background-color: var(--vscode-button-secondaryBackground);
			border-radius: 4px;
			font-weight: 600;
			font-size: 14px;
		}

		.timer-status.running {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		.timer-status.stopped {
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}

		.form-group {
			display: flex;
			flex-direction: column;
			gap: 8px;
			margin-bottom: 16px;
		}

		.form-group:last-of-type {
			margin-bottom: 0;
		}

		label {
			font-size: 13px;
			color: var(--vscode-foreground);
			font-weight: 500;
			margin-bottom: 2px;
		}

		select, input[type="text"] {
			width: 100%;
			padding: 10px 12px;
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}

		select:focus, input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		select:disabled, input:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}

		input[readonly] {
			background-color: var(--vscode-input-background);
			cursor: default;
			opacity: 0.9;
		}

		.button-group {
			display: flex;
			gap: 12px;
			flex-wrap: wrap;
			margin-top: 20px;
		}

		button {
			flex: 1;
			min-width: 100px;
			padding: 10px 16px;
			border: none;
			border-radius: 3px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			cursor: pointer;
			font-weight: 500;
			transition: opacity 0.2s;
		}

		button:hover {
			opacity: 0.8;
		}

		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.btn-primary {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
		}

		.btn-secondary {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}

		.btn-danger {
			background-color: var(--vscode-errorForeground);
			color: var(--vscode-editor-background);
		}

		.entries-header {
			margin-bottom: 12px;
		}

		.entries-header h3 {
			margin: 0;
			font-size: 14px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.entries-footer {
			margin-top: 16px;
		}

		.entries-footer button {
			width: 100%;
		}

		.entries-table {
			width: 100%;
			border-collapse: collapse;
			font-size: var(--vscode-font-size);
		}

		.entries-table thead {
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.entries-table th {
			text-align: left;
			padding: 10px 12px;
			font-weight: 500;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}

		.entries-table td {
			padding: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			color: var(--vscode-foreground);
		}

		.entries-table tbody tr:last-child td {
			border-bottom: none;
		}

		.entries-table tbody tr:hover {
			background-color: var(--vscode-list-hoverBackground);
		}

		.entry-name {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.entry-duration {
			color: var(--vscode-foreground);
			white-space: nowrap;
		}

		.entry-meta {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.error-message {
			padding: 10px;
			background-color: var(--vscode-inputValidation-errorBackground);
			color: var(--vscode-inputValidation-errorForeground);
			border-radius: 4px;
			margin-bottom: 10px;
		}

		.loading {
			text-align: center;
			padding: 20px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
		}

		.entries-table .loading {
			text-align: center;
			padding: 24px;
		}
	</style>
</head>
<body>
	<div class="timesheet-container">
		<div class="left-panel">
			<div class="panel-section">
				<div id="timer-status" class="timer-status stopped">
					<span>Timer: <span id="timer-elapsed">Stopped</span></span>
				</div>
			</div>

			<div class="panel-section">
				<div class="form-group">
					<label for="project-select">Project</label>
					<select id="project-select">
						<option value="">Loading projects...</option>
					</select>
				</div>

				<div class="form-group">
					<label for="task-select">Task (Optional)</label>
					<select id="task-select">
						<option value="">Select a project first</option>
					</select>
				</div>

				<div class="form-group">
					<label for="description-input">Description</label>
					<input type="text" id="description-input" placeholder="Enter timesheet description" />
				</div>

				<div class="button-group">
					<button id="start-button" class="btn-primary">Start Timer</button>
					<button id="stop-button" class="btn-danger" disabled>Stop Timer</button>
					<button id="refresh-button" class="btn-secondary">Refresh</button>
				</div>
			</div>
		</div>

		<div class="right-panel">
			<div class="panel-section">
				<div class="entries-header">
					<h3>Today's Entries</h3>
				</div>
				<div id="entries-container">
					<table id="entries-table" class="entries-table">
						<thead>
							<tr>
								<th>Description</th>
								<th>Duration</th>
								<th>Project</th>
								<th>Task</th>
							</tr>
						</thead>
						<tbody id="entries-list">
							<tr>
								<td colspan="4" class="loading">Loading entries...</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div class="entries-footer">
					<button id="refresh-entries-button" class="btn-secondary">Refresh</button>
				</div>
			</div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		let currentState = {
			isRunning: false,
			elapsed: 'Stopped',
			entry: null
		};

		let projects = [];
		let tasks = [];
		let entries = [];

		// DOM elements
		const timerStatusEl = document.getElementById('timer-status');
		const timerElapsedEl = document.getElementById('timer-elapsed');
		const projectSelect = document.getElementById('project-select');
		const taskSelect = document.getElementById('task-select');
		const descriptionInput = document.getElementById('description-input');
		const startButton = document.getElementById('start-button');
		const stopButton = document.getElementById('stop-button');
		const refreshButton = document.getElementById('refresh-button');
		const refreshEntriesButton = document.getElementById('refresh-entries-button');
		const entriesList = document.getElementById('entries-list');

		// Event listeners
		projectSelect.addEventListener('change', (e) => {
			const projectId = parseInt(e.target.value);
			if (projectId) {
				vscode.postMessage({ command: 'getTasks', projectId: projectId });
			} else {
				taskSelect.innerHTML = '<option value="">Select a project first</option>';
			}
		});

		startButton.addEventListener('click', () => {
			const description = descriptionInput.value.trim();
			const projectId = parseInt(projectSelect.value);
			const taskId = taskSelect.value ? parseInt(taskSelect.value) : undefined;

			if (!description) {
				vscode.postMessage({ command: 'error', message: 'Description is required' });
				return;
			}

			if (!projectId) {
				vscode.postMessage({ command: 'error', message: 'Please select a project' });
				return;
			}

			vscode.postMessage({
				command: 'startTimer',
				description: description,
				projectId: projectId,
				taskId: taskId
			});
		});

		stopButton.addEventListener('click', () => {
			vscode.postMessage({ command: 'stopTimer' });
		});

		refreshButton.addEventListener('click', () => {
			vscode.postMessage({ command: 'refresh' });
		});

		refreshEntriesButton.addEventListener('click', () => {
			vscode.postMessage({ command: 'getTodayEntries' });
		});

		// Handle messages from extension
		window.addEventListener('message', event => {
			const message = event.data;

			switch (message.command) {
				case 'updateState':
					currentState = message.state;
					updateUI();
					break;
				case 'updateProjects':
					projects = message.projects || [];
					updateProjectSelect();
					break;
				case 'updateTasks':
					tasks = message.tasks || [];
					updateTaskSelect();
					break;
				case 'updateEntries':
					entries = message.entries || [];
					updateEntriesList();
					break;
				case 'error':
					showError(message.message);
					break;
			}
		});

		function updateUI() {
			if (currentState.isRunning) {
				timerStatusEl.className = 'timer-status running';
				timerElapsedEl.textContent = currentState.elapsed;
				startButton.disabled = true;
				stopButton.disabled = false;
				
				// Disable and set readonly for fields when timer is running
				projectSelect.disabled = true;
				taskSelect.disabled = true;
				descriptionInput.disabled = true;
				descriptionInput.readOnly = true;

				// Set values from running timer entry
				if (currentState.entry) {
					// Set project value
					if (currentState.entry.project_id) {
						// If projects are already loaded, set the value immediately
						if (projects.length > 0) {
							const projectIdStr = currentState.entry.project_id.toString();
							if (projectSelect.querySelector('option[value="' + projectIdStr + '"]')) {
								projectSelect.value = projectIdStr;
								// Request tasks for this project
								vscode.postMessage({ command: 'getTasks', projectId: currentState.entry.project_id });
							} else {
								// Project not found in list, request projects again
								vscode.postMessage({ command: 'getProjects' });
							}
						} else {
							// Projects not loaded yet, request them first
							vscode.postMessage({ command: 'getProjects' });
						}
					}
					
					// Set task value (will be set after tasks are loaded via updateTaskSelect)
					if (currentState.entry.task_id && tasks.length > 0) {
						const taskIdStr = currentState.entry.task_id.toString();
						if (taskSelect.querySelector('option[value="' + taskIdStr + '"]')) {
							taskSelect.value = taskIdStr;
						}
					}
					
					// Set description value
					if (currentState.entry.name) {
						descriptionInput.value = currentState.entry.name;
					}
				}
			} else {
				timerStatusEl.className = 'timer-status stopped';
				timerElapsedEl.textContent = 'Stopped';
				startButton.disabled = false;
				stopButton.disabled = true;
				
				// Enable fields and remove readonly when timer is stopped
				projectSelect.disabled = false;
				taskSelect.disabled = false;
				descriptionInput.disabled = false;
				descriptionInput.readOnly = false;
			}
		}

		function updateProjectSelect() {
			const currentValue = projectSelect.value;
			projectSelect.innerHTML = '<option value="">Select a project</option>';
			projects.forEach(project => {
				const option = document.createElement('option');
				option.value = project.id.toString();
				option.textContent = project.name;
				projectSelect.appendChild(option);
			});
			
			// Restore selected value if timer is running
			if (currentState.isRunning && currentState.entry && currentState.entry.project_id) {
				projectSelect.value = currentState.entry.project_id.toString();
				// Request tasks for this project
				vscode.postMessage({ command: 'getTasks', projectId: currentState.entry.project_id });
			} else if (currentValue) {
				projectSelect.value = currentValue;
			}
		}

		function updateTaskSelect() {
			taskSelect.innerHTML = '<option value="">No Task</option>';
			tasks.forEach(task => {
				const option = document.createElement('option');
				option.value = task.id.toString();
				option.textContent = task.name;
				taskSelect.appendChild(option);
			});
			
			// Restore selected task value if timer is running
			if (currentState.isRunning && currentState.entry && currentState.entry.task_id) {
				taskSelect.value = currentState.entry.task_id.toString();
			}
		}

		function updateEntriesList() {
			if (entries.length === 0) {
				entriesList.innerHTML = '<tr><td colspan="4" class="loading">No entries for today</td></tr>';
				return;
			}

			entriesList.innerHTML = '';
			entries.forEach(entry => {
				const hours = Math.floor(entry.unit_amount);
				const minutes = Math.round((entry.unit_amount - hours) * 60);
				const duration = hours > 0 
					? \`\${hours}h\${minutes > 0 ? ' ' + minutes + 'm' : ''}\`
					: \`\${minutes}m\`;

				const tr = document.createElement('tr');
				tr.innerHTML = \`
					<td>
						<div class="entry-name">\${entry.name || 'Untitled'}</div>
						<div class="entry-meta">\${entry.date}</div>
					</td>
					<td class="entry-duration">\${duration}</td>
					<td class="entry-meta">\${entry.project_name || entry.project_id || '-'}</td>
					<td class="entry-meta">\${entry.task_name || entry.task_id || '-'}</td>
				\`;
				entriesList.appendChild(tr);
			});
		}

		function showError(message) {
			// Could show a toast notification here
			console.error(message);
		}

		// Request initial data
		vscode.postMessage({ command: 'getState' });
		vscode.postMessage({ command: 'getProjects' });
		vscode.postMessage({ command: 'getTodayEntries' });
	</script>
</body>
</html>`;
	}
}

