import * as vscode from 'vscode';
import { TimerService, getClient } from '../services/timerService';
import { OdooTimesheet, Project, Task } from '../odoo/timesheet';

export class PopupService {
	private timerService: TimerService;
	private timesheet: OdooTimesheet;

	constructor(timerService: TimerService, timesheet: OdooTimesheet) {
		this.timerService = timerService;
		this.timesheet = timesheet;
	}

	async showTimerControl(): Promise<void> {
		const state = this.timerService.getState();
		const elapsed = this.timerService.getElapsedTimeFormatted();

		if (state.isRunning) {
			// Timer is running, show stop option
			const items = [
				{
					label: '$(stop) Stop Timer',
					description: `Running: ${elapsed}`,
					action: 'stop',
				},
				{
					label: '$(refresh) Refresh Status',
					description: 'Update timer status',
					action: 'refresh',
				},
				{
					label: '$(list-unordered) View Today\'s Entries',
					description: 'Show timesheet entries for today',
					action: 'viewEntries',
				},
			];

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `Timer Running: ${elapsed} - Choose an action`,
			});

			if (selected) {
				switch (selected.action) {
					case 'stop':
						await this.timerService.stopTimer();
						break;
					case 'refresh':
						await this.timerService.refreshState();
						vscode.window.showInformationMessage('Timer status refreshed');
						break;
					case 'viewEntries':
						await this.showTodayEntries();
						break;
				}
			}
		} else {
			// Timer is stopped, show start option
			const items = [
				{
					label: '$(play) Start New Timer',
					description: 'Start a new timesheet timer',
					action: 'start',
				},
				{
					label: '$(list-unordered) View Today\'s Entries',
					description: 'Show timesheet entries for today',
					action: 'viewEntries',
				},
				{
					label: '$(refresh) Refresh Status',
					description: 'Update timer status',
					action: 'refresh',
				},
			];

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Timer Stopped - Choose an action',
			});

			if (selected) {
				switch (selected.action) {
					case 'start':
						await this.startTimerFlow();
						break;
					case 'viewEntries':
						await this.showTodayEntries();
						break;
					case 'refresh':
						await this.timerService.refreshState();
						vscode.window.showInformationMessage('Timer status refreshed');
						break;
				}
			}
		}
	}

	private async startTimerFlow(): Promise<void> {
		try {
			// Step 1: Select Project
			const project = await this.selectProject();
			if (!project) {
				return; // User cancelled
			}

			// Step 2: Select Task (optional)
			const task = await this.selectTask(project.id);

			// Step 3: Enter Description
			const description = await this.inputDescription();
			if (!description) {
				return; // User cancelled
			}

			// Start the timer
			const success = await this.timerService.startTimer(
				description,
				project.id,
				task?.id
			);

			if (success) {
				vscode.window.showInformationMessage(`Timer started: ${description}`);
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to start timer: ${error.message}`);
		}
	}

	private async selectProject(): Promise<Project | null> {
		try {
			const projects = await this.timesheet.getProjects();
			if (projects.length === 0) {
				vscode.window.showErrorMessage('No projects available. Please create a project first.');
				return null;
			}

			const items = projects.map((p) => ({
				label: p.name,
				description: `Project ID: ${p.id}`,
				project: p,
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a project',
			});

			return selected?.project || null;
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to load projects: ${error.message}`);
			return null;
		}
	}

	private async selectTask(projectId: number): Promise<Task | null> {
		try {
			const tasks = await this.timesheet.getTasks(projectId);
			if (tasks.length === 0) {
				return null; // No tasks available, that's okay
			}

			const items = [
				{
					label: 'No Task',
					description: 'Continue without a task',
					task: null as Task | null,
				},
				...tasks.map((t) => ({
					label: t.name,
					description: `Task ID: ${t.id}`,
					task: t,
				})),
			];

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a task (optional)',
			});

			return selected?.task || null;
		} catch (error: any) {
			vscode.window.showWarningMessage(`Failed to load tasks: ${error.message}`);
			return null;
		}
	}

	private async inputDescription(): Promise<string | null> {
		const description = await vscode.window.showInputBox({
			prompt: 'Enter timesheet entry description',
			placeHolder: 'Timesheet Entry',
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Description is required';
				}
				return null;
			},
		});

		return description || null;
	}

	private async showTodayEntries(): Promise<void> {
		try {
			const client = getClient(this.timerService);
			if (!client) {
				vscode.window.showWarningMessage('Please login first');
				return;
			}

			const session = client.getSession();
			if (!session) {
				vscode.window.showWarningMessage('Please login first');
				return;
			}

			const entries = await this.timesheet.getTodayTimesheetEntries(session.uid);

			if (entries.length === 0) {
				vscode.window.showInformationMessage('No timesheet entries for today');
				return;
			}

			// Format entries for display
			const items = entries.map((entry) => {
				const hours = Math.floor(entry.unit_amount);
				const minutes = Math.round((entry.unit_amount - hours) * 60);
				const duration = hours > 0 ? `${hours}h ${minutes > 0 ? minutes + 'm' : ''}` : `${minutes}m`;
				return {
					label: entry.name || 'Untitled',
					description: duration,
					detail: `Date: ${entry.date}`,
				};
			});

			const totalHours = entries.reduce((sum, entry) => sum + entry.unit_amount, 0);
			const totalH = Math.floor(totalHours);
			const totalM = Math.round((totalHours - totalH) * 60);
			const totalDuration = totalH > 0 ? `${totalH}h ${totalM > 0 ? totalM + 'm' : ''}` : `${totalM}m`;

			await vscode.window.showQuickPick(items, {
				placeHolder: `Today's Entries (Total: ${totalDuration}) - ${entries.length} entries`,
			});
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to load entries: ${error.message}`);
		}
	}
}

