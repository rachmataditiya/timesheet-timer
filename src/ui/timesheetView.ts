import * as vscode from 'vscode';
import { TimerService, TimerState } from '../services/timerService';
import { OdooTimesheet } from '../odoo/timesheet';

export class TimesheetTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly iconPath?: vscode.ThemeIcon | string,
		public readonly tooltip?: string
	) {
		super(label, collapsibleState);
	}
}

export class TimesheetTreeDataProvider implements vscode.TreeDataProvider<TimesheetTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<TimesheetTreeItem | undefined | null | void> = new vscode.EventEmitter<TimesheetTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TimesheetTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private timerService: TimerService;
	private timesheet: OdooTimesheet;
	private projectNames: Map<number, string> = new Map();
	private taskNames: Map<number, string> = new Map();
	private context?: vscode.ExtensionContext;

	constructor(timerService: TimerService, timesheet: OdooTimesheet, context?: vscode.ExtensionContext) {
		this.timerService = timerService;
		this.timesheet = timesheet;
		this.context = context;

		// Subscribe to timer state changes
		this.timerService.onStateUpdate(() => {
			this.refresh();
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TimesheetTreeItem): vscode.TreeItem {
		return element;
	}

	setProjectName(projectId: number, projectName: string): void {
		this.projectNames.set(projectId, projectName);
	}

	setTaskName(taskId: number, taskName: string): void {
		this.taskNames.set(taskId, taskName);
	}

	async loadProjectAndTaskNames(): Promise<void> {
		try {
			const state = this.timerService.getState();
			if (state.entry?.project_id) {
				// Try to load project name if not cached
				if (!this.projectNames.has(state.entry.project_id)) {
					const projects = await this.timesheet.getProjects();
					projects.forEach(p => this.projectNames.set(p.id, p.name));
				}
				// Try to load task name if not cached
				if (state.entry.task_id && !this.taskNames.has(state.entry.task_id)) {
					const tasks = await this.timesheet.getTasks(state.entry.project_id);
					tasks.forEach(t => this.taskNames.set(t.id, t.name));
				}
			}
		} catch (error) {
			// Silent fail
		}
	}

	getChildren(element?: TimesheetTreeItem): Thenable<TimesheetTreeItem[]> {
		if (!element) {
			// Root items
			const state = this.timerService.getState();
			const items: TimesheetTreeItem[] = [];
			
			// Load project/task names in background (don't wait)
			this.loadProjectAndTaskNames();

			// Timer Status
			const elapsed = this.timerService.getElapsedTimeFormatted();
			const statusLabel = state.isRunning 
				? `$(sync~spin) Timer Running: ${elapsed}`
				: `$(clock) Timer Stopped`;
			items.push(new TimesheetTreeItem(
				statusLabel,
				vscode.TreeItemCollapsibleState.None,
				undefined,
				state.isRunning ? new vscode.ThemeIcon('sync~spin') : new vscode.ThemeIcon('clock'),
				state.isRunning ? `Timer is running for ${elapsed}` : 'Timer is stopped'
			));

			// Project Selection - show selected project from workspace state if timer not running
			// If timer is running, show project from timer state
			let displayProjectId = state.entry?.project_id;
			if (!displayProjectId && this.context) {
				displayProjectId = this.context.workspaceState.get<number>('selectedProjectId');
			}
			let projectName = displayProjectId ? this.projectNames.get(displayProjectId) : undefined;
			if (!projectName && this.context && displayProjectId) {
				projectName = this.context.workspaceState.get<string>('selectedProjectName');
			}
			items.push(new TimesheetTreeItem(
				displayProjectId 
					? `$(folder) Project: ${projectName || `ID ${displayProjectId}`}`
					: '$(folder) Select Project',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'odoo.selectProject',
					title: 'Select Project',
					tooltip: 'Click to select a project'
				},
				new vscode.ThemeIcon('folder')
			));

			// Task Selection
			let displayTaskId = state.entry?.task_id;
			if (!displayTaskId && this.context) {
				displayTaskId = this.context.workspaceState.get<number>('selectedTaskId') || undefined;
			}
			let taskName = displayTaskId ? this.taskNames.get(displayTaskId) : undefined;
			if (!taskName && this.context && displayTaskId) {
				taskName = this.context.workspaceState.get<string>('selectedTaskName');
			}
			items.push(new TimesheetTreeItem(
				displayTaskId
					? `$(tasklist) Task: ${taskName || `ID ${displayTaskId}`}`
					: '$(tasklist) Select Task (Optional)',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'odoo.selectTask',
					title: 'Select Task',
					tooltip: 'Click to select a task (optional)'
				},
				new vscode.ThemeIcon('tasklist')
			));

			// Description
			let displayDescription = state.entry?.name;
			if (!displayDescription && this.context) {
				displayDescription = this.context.workspaceState.get<string>('selectedDescription');
			}
			items.push(new TimesheetTreeItem(
				displayDescription
					? `$(note) Description: ${displayDescription.length > 50 ? displayDescription.substring(0, 50) + '...' : displayDescription}`
					: '$(note) Enter Description',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'odoo.enterDescription',
					title: 'Enter Description',
					tooltip: displayDescription || 'Click to enter timer description'
				},
				new vscode.ThemeIcon('note')
			));

			// Action buttons
			if (state.isRunning) {
				items.push(new TimesheetTreeItem(
					'$(stop) Stop Timer',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'odoo.stopTimer',
						title: 'Stop Timer',
						tooltip: 'Stop the running timer'
					},
					new vscode.ThemeIcon('stop')
				));
			} else {
				items.push(new TimesheetTreeItem(
					'$(play) Start Timer',
					vscode.TreeItemCollapsibleState.None,
					{
						command: 'odoo.startTimerFromView',
						title: 'Start Timer',
						tooltip: 'Start the timer'
					},
					new vscode.ThemeIcon('play')
				));
			}

			// Refresh button
			items.push(new TimesheetTreeItem(
				'$(refresh) Refresh Status',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'odoo.refreshTimer',
					title: 'Refresh Timer Status',
					tooltip: 'Refresh timer status from Odoo'
				},
				new vscode.ThemeIcon('refresh')
			));

			// Today's Entries (collapsible)
			items.push(new TimesheetTreeItem(
				"$(list-unordered) Today's Entries",
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				new vscode.ThemeIcon('list-unordered')
			));

			return Promise.resolve(items);
		} else if (element.label.toString().includes("Today's Entries")) {
			// Children of Today's Entries
			return this.getTodayEntries();
		}

		return Promise.resolve([]);
	}

	private async getTodayEntries(): Promise<TimesheetTreeItem[]> {
		try {
			const client = this.timerService.getClient();
			if (!client) {
				return [new TimesheetTreeItem(
					'$(warning) Please login first',
					vscode.TreeItemCollapsibleState.None
				)];
			}

			const session = client.getSession();
			if (!session) {
				return [new TimesheetTreeItem(
					'$(warning) Please login first',
					vscode.TreeItemCollapsibleState.None
				)];
			}

			const entries = await this.timesheet.getTodayTimesheetEntries(session.uid);
			
			if (entries.length === 0) {
				return [new TimesheetTreeItem(
					'$(info) No entries for today',
					vscode.TreeItemCollapsibleState.None
				)];
			}

			return entries.map(entry => {
				const hours = Math.floor(entry.unit_amount);
				const minutes = Math.round((entry.unit_amount - hours) * 60);
				const duration = hours > 0 ? `${hours}h ${minutes > 0 ? minutes + 'm' : ''}` : `${minutes}m`;
				const label = `${entry.name || 'Untitled'}: ${duration}`;
				
				return new TimesheetTreeItem(
					label,
					vscode.TreeItemCollapsibleState.None,
					undefined,
					new vscode.ThemeIcon('clock'),
					`Date: ${entry.date}\nDuration: ${entry.unit_amount.toFixed(2)} hours`
				);
			});
		} catch (error: any) {
			return [new TimesheetTreeItem(
				`$(error) Error: ${error.message}`,
				vscode.TreeItemCollapsibleState.None
			)];
		}
	}
}

