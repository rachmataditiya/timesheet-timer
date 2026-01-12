import * as vscode from 'vscode';
import { OdooClient } from './odoo/client';
import { OdooAuth } from './odoo/auth';
import { OdooTimesheet } from './odoo/timesheet';
import { TimerService } from './services/timerService';
import { StorageService } from './services/storageService';
import { StatusBar } from './ui/statusBar';
import { PopupService } from './ui/popupService';
import { TimesheetPanel } from './ui/timesheetPanel';

let odooClient: OdooClient;
let odooAuth: OdooAuth;
let odooTimesheet: OdooTimesheet;
let timerService: TimerService;
let storageService: StorageService;
let statusBar: StatusBar;
let popupService: PopupService;

export function activate(context: vscode.ExtensionContext) {
	console.log('Odoo Timesheet Timer extension is now active');

	// Initialize services
	odooClient = new OdooClient();
	storageService = new StorageService(context);
	odooAuth = new OdooAuth(odooClient, storageService);
	odooTimesheet = new OdooTimesheet(odooClient);
	timerService = new TimerService(odooTimesheet, odooClient, context);
	statusBar = new StatusBar(timerService);
	popupService = new PopupService(timerService, odooTimesheet);

	// Register commands
	const loginCommand = vscode.commands.registerCommand('odoo.login', async () => {
		await odooAuth.login();
	});

	const startTimerCommand = vscode.commands.registerCommand('odoo.startTimer', async () => {
		if (!odooClient.isAuthenticated()) {
			const authenticated = await odooAuth.login();
			if (!authenticated) {
				return;
			}
		}

		// Get projects
		const projects = await odooTimesheet.getProjects();
		if (projects.length === 0) {
			vscode.window.showErrorMessage('No projects available. Please create a project first.');
			return;
		}

		// Select project
		const projectItems = projects.map(p => ({
			label: p.name,
			id: p.id,
		}));
		const selectedProject = await vscode.window.showQuickPick(projectItems, {
			placeHolder: 'Select a project',
		});

		if (!selectedProject) {
			return;
		}

		// Get tasks for selected project
		const tasks = await odooTimesheet.getTasks(selectedProject.id);
		let selectedTaskId: number | undefined;

		if (tasks.length > 0) {
			const taskItems = [
				{ label: 'No Task', id: 0 },
				...tasks.map(t => ({
					label: t.name,
					id: t.id,
				})),
			];
			const selectedTask = await vscode.window.showQuickPick(taskItems, {
				placeHolder: 'Select a task (optional)',
			});
			if (selectedTask && selectedTask.id > 0) {
				selectedTaskId = selectedTask.id;
			}
		}

		// Get description
		const name = await vscode.window.showInputBox({
			prompt: 'Enter timesheet entry description',
			placeHolder: 'Timesheet Entry',
			validateInput: (value) => {
				if (!value || !value.trim()) {
					return 'Description is required';
				}
				return null;
			},
		});

		if (name) {
			await timerService.startTimer(name, selectedProject.id, selectedTaskId);
		}
	});

	const stopTimerCommand = vscode.commands.registerCommand('odoo.stopTimer', async () => {
		await timerService.stopTimer();
	});

	const showTimerPopupCommand = vscode.commands.registerCommand(
		'odoo.showTimerPopup',
		async () => {
			if (!odooClient.isAuthenticated()) {
				const authenticated = await odooAuth.login();
				if (!authenticated) {
					return;
				}
			}

			const extensionUri = context.extensionUri;
			TimesheetPanel.createOrShow(extensionUri, timerService, odooTimesheet, context);
		}
	);

	const refreshTimerCommand = vscode.commands.registerCommand('odoo.refreshTimer', async () => {
		await timerService.refreshState();
		vscode.window.showInformationMessage('Timer status refreshed');
	});

	// Add to subscriptions
	context.subscriptions.push(
		loginCommand,
		startTimerCommand,
		stopTimerCommand,
		showTimerPopupCommand,
		refreshTimerCommand,
		statusBar
	);

	// Try to restore authentication and timer state on startup
	const restoreAuth = async () => {
		try {
			const hasCredentials = await storageService.hasCredentials();
			if (hasCredentials) {
				const credentials = await storageService.getCredentials();
				if (credentials) {
					odooClient.setCredentials(credentials);
					try {
						await odooClient.authenticate();
						// Try to restore timer state from workspace storage first
						const restored = await timerService.loadState();
						if (!restored) {
							// If not restored from storage, check Odoo for running timer
							await timerService.refreshState();
						}
					} catch (error) {
						// Silent fail - user can login manually
						console.log('Failed to restore authentication:', error);
					}
				}
			}
		} catch (error) {
			console.log('Failed to restore authentication:', error);
		}
	};

	// Restore auth after a short delay to avoid blocking startup
	setTimeout(restoreAuth, 1000);

}

export async function deactivate() {
	const state = timerService?.getState();
	if (state?.isRunning) {
		// Check if user wants to stop timer
		const choice = await vscode.window.showWarningMessage(
			'Odoo timer is currently running. Do you want to stop it?',
			{ modal: true },
			'Stop Timer',
			'Keep Running'
		);
		if (choice === 'Stop Timer') {
			await timerService?.stopTimer();
		}
	}

	if (timerService) {
		timerService.dispose();
	}
	if (statusBar) {
		statusBar.dispose();
	}
}

